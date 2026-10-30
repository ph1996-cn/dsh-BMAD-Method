/**
 * 冒烟测试：用假的 Cordis ctx 真实跑一遍 apply() 注册的三个工具。
 * 覆盖：模块发现（已安装 + 可安装）、开关写盘与回滚、模块行的提示词注入、更新命令组装。
 *
 * 运行：npm test   （node --test test/）
 */

import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply, Config } from '../index.js'
import { isModuleEnabled, moduleRows, resolvePatchPath } from '../lib/patch.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PROJECT = join(HERE, '..', 'fixtures', 'project')
const FIXTURE_PATCH = join(HERE, '..', 'fixtures', 'cordis.patch.yml')
const FIXTURE_COMMENT = '# 这一行是用户自己的注释，必须原样保留'

/** 最小 Cordis ctx：effect 立即执行，tools/systemPrompt/skills/webServer 只做登记。 */
function makeCtx() {
  const tools = new Map()
  const contexts = []
  const providers = []
  const routes = []
  return {
    tools,
    contexts,
    providers,
    routes,
    ctx: {
      effect: (fn) => fn(),
      webServer: {
        register: (route) => {
          routes.push(route)
          return () => {}
        },
      },
      tools: {
        register: (definition) => {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
      systemPrompt: {
        context: (entry) => {
          contexts.push(entry)
          return () => {}
        },
      },
      skills: {
        registerProvider: (factory) => {
          providers.push(factory({ invalidate: () => {} }))
          return () => {}
        },
      },
    },
  }
}

/** 每个用例一份独立补丁文件，避免互相污染。 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-BMAD-Method-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  const patchBefore = readFileSync(FIXTURE_PATCH, 'utf8')
  writeFileSync(patchPath, patchBefore, 'utf8')
  return { patchPath, patchBefore, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const EXEC = { agent: { session: { header: { cwd: FIXTURE_PROJECT } } } }

function controller(patchPath, extra = {}) {
  const box = makeCtx()
  // bmadHome 指到 fixture 的父目录：避免命中本机真实的全局安装，让用例结果可重现
  apply(box.ctx, { patchPath, bmadHome: FIXTURE_PROJECT, ...extra })
  // 工具表上挂登记结果，用例仍是 tools.get(...) 的老写法
  box.tools.contexts = box.contexts
  box.tools.providers = box.providers
  box.tools.routes = box.routes
  return box.tools
}

test('控制面注册了三个工具', () => {
  const tools = controller(join(tmpdir(), 'unused-patch.yml'))
  assert.deepEqual([...tools.keys()].sort(), ['bmad_module_toggle', 'bmad_modules_list', 'bmad_update'])
})

test('bmad_modules_list：已安装模块来自 _bmad/，可安装模块来自注册表', async () => {
  const box = sandbox()
  try {
    const list = controller(box.patchPath).get('bmad_modules_list')
    const data = await list.execute({}, EXEC)
    const result = data

    assert.equal(result.installed, true)
    assert.equal(result.projectRoot, FIXTURE_PROJECT)
    assert.equal(result.bmadDir, join(FIXTURE_PROJECT, '_bmad'))
    assert.equal(result.coreVersion, '6.12.4')
    // 注册表优先用插件依赖里 bmad-method 自带的那份（bundled-package），
    // 依赖没落地才退回项目内包或内置快照。
    assert.ok(
      ['bundled-package', 'local-package', 'bundled-snapshot'].includes(result.registrySource),
      `注册表来源异常：${result.registrySource}`,
    )

    const byCode = new Map(result.modules.map((m) => [m.code, m]))
    assert.equal(byCode.get('bmm').installed, true)
    assert.equal(byCode.get('bmm').version, '6.12.4')
    assert.equal(byCode.get('bmm').enabled, true)
    assert.equal(byCode.get('bmm').type, 'builtin')
    assert.equal(byCode.get('core').installed, true, 'core 也要出现在清单里')
    assert.equal(byCode.get('tea').installed, true)
    assert.equal(byCode.get('tea').name, 'BMad Test Architect')
    // 七个未废弃模块 fixture 全装了
    for (const code of ['bmb', 'gds', 'cis', 'bmad-loop']) {
      assert.equal(byCode.get(code)?.installed, true, `${code} 应已安装`)
    }
    // 只剩已废弃的两个没装
    for (const code of ['automator', 'wds']) {
      assert.equal(byCode.get(code)?.installed, false, `${code} 应列为可安装未安装`)
      assert.equal(byCode.get(code)?.deprecated, true)
    }

    // list 只读取、不写 profile
    assert.equal(readFileSync(box.patchPath, 'utf8'), box.patchBefore, 'list 不该改动 profile 补丁')
    assert.equal(isModuleEnabled(readFileSync(box.patchPath, 'utf8'), 'bmm'), true)
  } finally {
    box.cleanup()
  }
})

test('冒烟：停用写入 disabled: true，再启用把它去掉，且不破坏既有注释', async () => {
  const box = sandbox()
  try {
    const tools = controller(box.patchPath)
    const toggle = tools.get('bmad_module_toggle')
    await tools.get('bmad_modules_list').execute({}, EXEC)

    // --- 停用 tea ---
    const off = await toggle.execute({ module: 'tea', enabled: false }, EXEC)
    assert.equal(off.status, 'ok')
    assert.equal(off.changed, true)
    assert.equal(off.enabled, false)

    let text = readFileSync(box.patchPath, 'utf8')
    assert.ok(text.includes('- id: bmad-module-tea'), '应写出 bmad-module-tea 条目')
    assert.match(text, /- id: bmad-module-tea\n {2}disabled: true/, '应是顶格条目 + 2 空格 disabled: true')
    assert.equal(isModuleEnabled(text, 'tea'), false)
    assert.equal(isModuleEnabled(text, 'bmm'), true, '停用 tea 不该影响 bmm')
    assert.ok(text.includes(FIXTURE_COMMENT), '用户注释必须保留')
    assert.match(text, /- id: mcp-panel\n {2}disabled: true/, '既有条目必须保留')

    // 重复停用：幂等，不改文件
    const again = await toggle.execute({ module: 'tea', enabled: false }, EXEC)
    assert.equal(again.status, 'ok')
    assert.equal(again.changed, false)

    // 列表要反映停用状态
    const listed = await tools.get('bmad_modules_list').execute({}, EXEC)
    assert.equal(listed.modules.find((m) => m.code === 'tea').enabled, false)

    // --- 重新启用 ---
    const on = await toggle.execute({ module: 'tea', enabled: true }, EXEC)
    assert.equal(on.status, 'ok')
    assert.equal(on.enabled, true)

    text = readFileSync(box.patchPath, 'utf8')
    assert.equal(isModuleEnabled(text, 'tea'), true)
    assert.ok(!text.includes('- id: bmad-module-tea'), '启用 = 覆盖条目整个删掉（回到 bundle 默认）')
    assert.equal(moduleRows(text).find((r) => r.code === 'tea'), undefined)
    assert.ok(text.includes(FIXTURE_COMMENT))
  } finally {
    box.cleanup()
  }
})

test('全新环境：第一次调 list 就用自带安装器把 BMAD 装好，不联网下载', async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'dsh-bmad-none-'))
  const prevDshHome = process.env.DSH_HOME
  const prevMinimal = process.env.DSH_BMAD_MINIMAL
  // skill 会被迁进 DSH_HOME/skills，指到临时目录，别碰用户真实的全局 skills
  process.env.DSH_HOME = join(emptyDir, 'dsh-home')
  // 生产环境装全部模块；测试只要内置的 core+bmm（外部模块要 git clone，测试不该联网）
  process.env.DSH_BMAD_MINIMAL = '1'
  try {
    const home = join(emptyDir, 'bmad-home')
    const tools = controller(join(emptyDir, 'cordis.patch.yml'), { bmadHome: home })
    const exec = { agent: { session: { header: { cwd: emptyDir } } } }

    const listed = await tools.get('bmad_modules_list').execute({}, exec)
    // 自举：插件依赖里就有 bmad-method，这里只是把它铺到全局主目录
    assert.equal(listed.installed, true)
    assert.ok(existsSync(join(home, '_bmad', '_config', 'manifest.yaml')), '应自动装出 _bmad/')
    assert.equal(existsSync(join(home, '.claude')), false, '不该留 IDE 入口目录')
    // skill 随插件包携带，走 SkillProvider 注册，不落用户目录
    assert.equal(tools.providers.length, 1, '应注册一个 skill provider')
    assert.equal(existsSync(join(emptyDir, 'dsh-home', 'skills')), false, '不往 $DSH_HOME/skills 写东西')
    const provider = tools.providers[0]
    const listed2 = await provider.list({})
    assert.equal(listed2.complete, true)
    assert.equal(listed2.candidates.length, 90, '包里带着 90 个 BMAD skill')
    assert.ok(
      listed2.candidates.every((c) => /^(bmad|gds)-/.test(c.name)),
      'candidate 名都是 bmad- / gds- 前缀',
    )
    assert.ok(
      listed2.candidates.every((c) => c.provider && c.locator?.directory && c.invocation?.modelInvocable),
      'candidate 形状要齐',
    )
    const sample = await provider.get(listed2.candidates[0], {})
    assert.equal(sample.name, listed2.candidates[0].name)
    assert.ok(sample.content.length > 0, '应取到 skill 正文')
    assert.ok(!sample.content.includes('{project-root}/_bmad/'), '正文里的 _bmad 引用应改成本机绝对路径')
    assert.ok(sample.content.includes(`${home.replace(/\\/g, '/')}/_bmad/`), '应指向全局主目录的 _bmad')
    assert.ok(
      listed.notes.some((n) => n.includes('首次使用') && n.includes('不联网下载')),
      listed.notes.join(' | '),
    )
    assert.equal(existsSync(join(emptyDir, '_bmad')), false, '工作区不能落 _bmad/')
    assert.equal(existsSync(join(emptyDir, '_bmad-output')), true, '工作区应有输出目录')

    const toggled = await tools.get('bmad_module_toggle').execute({ module: 'bmm', enabled: false }, exec)
    assert.equal(toggled.status, 'ok')
  } finally {
    if (prevDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevDshHome
    if (prevMinimal === undefined) delete process.env.DSH_BMAD_MINIMAL
    else process.env.DSH_BMAD_MINIMAL = prevMinimal
    rmSync(emptyDir, { recursive: true, force: true })
  }
})

test('补丁写不进去时报告 write-failed，且不留半截状态', async () => {
  const box = sandbox()
  try {
    // 把补丁路径指向一个目录：读/写都会失败
    const tools = controller(box.patchPath + '/nope')
    const result = await tools.get('bmad_module_toggle').execute({ module: 'tea', enabled: false }, EXEC)
    assert.equal(result.status, 'write-failed')
    assert.equal(result.changed, false)
    assert.ok(result.notes.length > 0)
    // 原补丁文件保持原样
    assert.equal(readFileSync(box.patchPath, 'utf8'), readFileSync(FIXTURE_PATCH, 'utf8'))
  } finally {
    box.cleanup()
  }
})

test('bmad_update dryRun 只组装命令：带用户名、语言固定简体中文、输出目录默认', async () => {
  const box = sandbox()
  try {
    const tools = controller(box.patchPath)
    const result = await tools.get('bmad_update').execute({ dryRun: true, userName: '张伟' }, EXEC)
    assert.equal(result.status, 'dry-run')
    assert.equal(result.executed, false)
    assert.ok(result.command.includes('install'))
    assert.ok(result.command.includes('--action update'))
    assert.ok(result.command.includes(FIXTURE_PROJECT))
    assert.ok(result.command.includes('--user-name 张伟'), '用户自己设置的用户名要传给安装器')
    assert.ok(result.command.includes('--communication-language 简体中文'), '沟通语言固定简体中文')
    assert.ok(result.command.includes('--document-output-language 简体中文'), '文档语言固定简体中文')
    assert.ok(result.command.includes('--output-folder _bmad-output'), '输出目录按默认 _bmad-output')
    assert.ok(result.command.includes('--no-shims'), '默认不铺任何 IDE 接入文件')
    // 默认把注册表里未废弃的模块一次装齐（插件要"全部封装"）
    const all = result.command.match(/--modules (\S+)/)?.[1] ?? ''
    for (const code of ['core', 'bmm', 'bmb', 'cis', 'tea', 'gds', 'bmad-loop']) {
      assert.ok(all.split(',').includes(code), `--modules 应包含 ${code}，实际 ${all}`)
    }
    assert.ok(!all.includes('automator'), '已废弃模块不装')
    assert.deepEqual(
      result.modules.sort(),
      [['bmad-loop','0.13.1'],['bmb','2.2.2'],['bmm','6.12.4'],['cis','0.3.2'],['core','6.12.4'],['gds','0.7.2'],['tea','1.27.2']].map(([c,v]) => c + '@' + v),
      '报告的模块清单应反映已装 + 本次要装的全部模块',
    )
  } finally {
    box.cleanup()
  }
})

test('core 是地基模块，不参与开关', async () => {
  const box = sandbox()
  try {
    const result = await controller(box.patchPath)
      .get('bmad_module_toggle')
      .execute({ module: 'core', enabled: false }, EXEC)
    assert.equal(result.status, 'not-toggleable')
    assert.equal(result.changed, false)
    assert.equal(readFileSync(box.patchPath, 'utf8'), readFileSync(FIXTURE_PATCH, 'utf8'))
  } finally {
    box.cleanup()
  }
})

test('只挂一个实例：包内补丁不再为每个模块开行（否则插件页会有一堆同名组件）', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(moduleRows(patch).length, 0, '包内补丁不该声明模块行')
  assert.equal((patch.match(/- id: bmad-method\b/g) ?? []).length, 1, '只挂控制面一行')

  const { ctx, tools } = makeCtx()
  apply(ctx, { projectRoot: FIXTURE_PROJECT })
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['bmad_module_toggle', 'bmad_modules_list', 'bmad_update'],
    '一个实例就把三个工具都注册好',
  )
})

test('默认一次装齐：不传模块集合也装全部未废弃模块', async () => {
  const box = sandbox()
  try {
    const result = await controller(box.patchPath).get('bmad_update').execute({ dryRun: true }, EXEC)
    assert.equal(result.status, 'dry-run')
    const line = result.command.match(/--modules (\S+)/)?.[1] ?? ''
    const codes = line.split(',')
    for (const code of ['core', 'bmm', 'bmb', 'cis', 'tea', 'gds', 'bmad-loop']) {
      assert.ok(codes.includes(code), `--modules 应包含 ${code}，实际 ${line}`)
    }
    for (const code of ['automator', 'wds']) {
      assert.ok(!codes.includes(code), `已废弃的 ${code} 不该装`)
    }
  } finally {
    box.cleanup()
  }
})

test('全局安装：工作区只多出 _bmad-output，不出现 _bmad / .agent', async () => {
  const box = sandbox()
  const ws = mkdtempSync(join(tmpdir(), 'dsh-bmad-ws-'))
  const globalHome = mkdtempSync(join(tmpdir(), 'dsh-bmad-home-'))
  try {
    cpSync(join(FIXTURE_PROJECT, '_bmad'), join(globalHome, '_bmad'), { recursive: true })
    const exec = { agent: { session: { header: { cwd: ws } } } }
    const listed = await controller(box.patchPath, { bmadHome: globalHome })
      .get('bmad_modules_list')
      .execute({}, exec)

    assert.equal(listed.installed, true)
    assert.equal(listed.global, true)
    assert.equal(listed.projectRoot, globalHome, '模块来自全局主目录')
    assert.equal(listed.outputDir, join(ws, '_bmad-output'))
    assert.ok(existsSync(join(ws, '_bmad-output')), '装好插件后工作区应自动有 _bmad-output')
    assert.ok(!existsSync(join(ws, '_bmad')), '工作区不应出现 _bmad')
    assert.ok(!existsSync(join(ws, '.agent')), '工作区不应出现 .agent')
  } finally {
    box.cleanup()
    rmSync(ws, { recursive: true, force: true })
    rmSync(globalHome, { recursive: true, force: true })
  }
})

test('设置页：导出 Config schema，三个设置项都在、全部 volatile 且语言默认简体中文', () => {
  assert.ok(Config, '缺少 export const Config，设置页就没有表单可渲染')
  const json = JSON.parse(JSON.stringify(Config))
  const fields = Object.values(json.refs ?? {}).filter(
    (item) => item && item.type === 'string' && item.meta?.description,
  )
  assert.equal(fields.length, 3, `应投影出 3 个设置项（用户名/语言/输出目录），实际 ${fields.length}`)
  // 少了 volatile，Host 的 settings.describe() 会把整个条目丢掉（dsh-settings/lib/index.js volatileForm）。
  assert.ok(
    fields.every((item) => item.meta.volatile === true),
    '每个设置项都必须 .volatile()，否则不进 settings 文档、插件页拿不到命名空间',
  )
  assert.ok(
    fields.some((item) => item.meta.default === '简体中文'),
    '语言默认值应为简体中文',
  )
})

test('模块停用后，它的 skill 不再列出；core 的始终可用', async () => {
  const box = sandbox()
  try {
    const tools = controller(box.patchPath)
    const provider = tools.providers[0]
    // 宿主按 provider.name 注册、并要求 candidate.provider 与它一字不差
    assert.equal(provider.name, 'bmad', 'provider 必须有 name 属性，否则宿主把它注册成 undefined')
    const before = await provider.list({})
    assert.equal(before.candidates.length, 90, '默认把包里 90 个 skill 全列出来')
    assert.ok(
      before.candidates.every((c) => c.provider === 'bmad'),
      'candidate.provider 必须等于 provider.name，否则宿主拒绝整份清单',
    )
    assert.ok(before.candidates.some((c) => c.name === 'bmad-agent-analyst'), 'bmm 的 skill 在')

    const off = await tools.get('bmad_module_toggle').execute({ module: 'bmm', enabled: false }, EXEC)
    assert.equal(off.status, 'ok')

    const after = await provider.list({})
    // skills/manifest.json：core 8 / bmm 21 / bmb 5 / cis 10 / tea 10 / gds 33 / bmad-loop 3 = 90
    assert.equal(after.candidates.length, 69, 'bmm 的 21 个 skill 应被收走，剩 69 个')
    assert.ok(!after.candidates.some((c) => c.name === 'bmad-agent-analyst'), 'bmm 的 skill 不该再出现')
    assert.ok(after.candidates.some((c) => c.name === 'bmad-tea'), '没停用的 tea 模块 skill 仍在')
    assert.ok(after.candidates.some((c) => c.name === 'bmad-help'), 'core 的 skill 永远可用')
  } finally {
    box.cleanup()
  }
})

/** 打一次插件自带的 HTTP 接口：GET/POST 都走同一个 handler。 */
function callApi(route, { method = 'GET', url = '/api/bmad-method/modules', body, headers = {} } = {}) {
  return new Promise((resolve) => {
    let status = 0
    const req = {
      method,
      url,
      headers,
      on: (event, cb) => {
        if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)))
        if (event === 'end') cb()
        return req
      },
    }
    const res = {
      writeHead: (code) => {
        status = code
      },
      end: (chunk) => {
        const payload = String(chunk ?? '')
        resolve({ status, body: payload ? JSON.parse(payload) : null })
      },
    }
    route.handler(req, res)
  })
}

test('运行期没有 DSH_PROFILE_DIR：从 ~/.dsh/profiles 里扫出挂着本插件的那个补丁', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-bmad-home-'))
  const profileDir = join(home, 'profiles', 'work') // 故意不叫默认的 desktop
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'cordis.patch.yml'), readFileSync(FIXTURE_PATCH, 'utf8'))
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['dsh-BMAD-Method'] } } }),
  )
  const saved = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR,
    DSH_PROFILE: process.env.DSH_PROFILE,
    DSH_BMAD_PATCH_PATH: process.env.DSH_BMAD_PATCH_PATH,
  }
  try {
    // dsh 宿主进程不继承 shell 的这几个变量，这里原样模拟
    delete process.env.DSH_PROFILE_DIR
    delete process.env.DSH_PROFILE
    delete process.env.DSH_BMAD_PATCH_PATH
    process.env.DSH_HOME = home
    assert.equal(
      resolvePatchPath({}),
      join(profileDir, 'cordis.patch.yml'),
      '要靠 profile 的 bundles 认领，而不是靠环境变量猜 desktop',
    )

    // 没有 profile 挂本插件时返回 null，调用方要报错而不是写错文件
    rmSync(join(profileDir, 'package.json'))
    assert.equal(resolvePatchPath({}), null)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(home, { recursive: true, force: true })
  }
})

test('插件页模块开关接口：GET 列模块，POST 写 disabled: true 并可读回', async () => {
  const box = sandbox()
  try {
    const tools = controller(box.patchPath)
    const route = tools.routes.find((r) => r.path === '/api/bmad-method')
    assert.ok(route, '应注册 /api/bmad-method 接口（插件页卡片靠它读写模块开关）')

    const list = await callApi(route)
    assert.equal(list.status, 200)
    assert.equal(list.body.ok, true)
    const byCode = (data) => Object.fromEntries((data.modules ?? []).map((m) => [m.code, m]))
    assert.equal(byCode(list.body).tea.enabled, true, '默认是启用')
    assert.equal(byCode(list.body).tea.toggleable, true, '已安装且有插件行的模块可以开关')
    assert.equal(byCode(list.body).core.toggleable, false, 'core 是地基，不给开关')

    const off = await callApi(route, {
      method: 'POST',
      url: '/api/bmad-method/toggle',
      body: { module: 'tea', enabled: false },
    })
    assert.equal(off.status, 200)
    assert.equal(off.body.ok, true)
    assert.equal(byCode(off.body).tea.enabled, false, '接口返回的新状态要立刻反映停用')
    assert.match(readFileSync(box.patchPath, 'utf8'), /- id: bmad-module-tea\n {2}disabled: true/)

    const back = await callApi(route, {
      method: 'POST',
      url: '/api/bmad-method/toggle',
      body: { module: 'tea', enabled: true },
    })
    assert.equal(back.body.ok, true)
    assert.equal(byCode(back.body).tea.enabled, true)
    assert.ok(!readFileSync(box.patchPath, 'utf8').includes('- id: bmad-module-tea'), '启用后整条消失')

    const crossSite = await callApi(route, { headers: { origin: 'https://evil.example', host: '127.0.0.1:1' } })
    assert.equal(crossSite.status, 403, '跨站来源必须被拒绝')
  } finally {
    box.cleanup()
  }
})
