/**
 * dsh-BMAD-Method —— BMAD-Method 在 dsh 里的受控桥接层。
 *
 * 包内补丁只挂一个控制面行（id: bmad-method）：注册三个工具 + 注册 skill provider。
 * 模块开关写在 profile 的 cordis.patch.yml（disabled: true），skill provider 每次列清单
 * 都现读它 —— 所以停用一个模块，下一轮对话它的 skill 就不在清单里了，不用重启 dsh。
 *
 * 不重写 BMAD 的任何 agent / 工作流逻辑：模块解析靠 _bmad/ 里的 manifest 与 config，
 * 更新靠 BMAD 官方安装器的非交互接口。
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_LANGUAGE,
  DEFAULT_OUTPUT_FOLDER,
  DEFAULT_TOOLS,
  allRegistryModules,
  buildInstallCommand,
  enabledModuleCodes,
  ensureInstalled,
  ensureOutputDir,
  listModules,
  loadRegistry,
  locateBmad,
  readInstalledModules,
  resolveBmadHome,
  resolveTools,
  runInstaller,
} from './lib/bmad.js'
import {
  editPatch,
  isModuleEnabled,
  moduleRowId,
  moduleRows,
  resolvePatchPath,
  setModuleRow,
} from './lib/patch.js'
import { BmadSkillProvider, bundledSkillsDir } from './lib/skills.js'

export const name = 'dsh-BMAD-Method'
export const inject = ['tools', 'skills', 'webServer']

/**
 * 设置页表单：dsh 读这份 schema 渲染「设置 → 插件配置」里的卡片。
 * 键名与 apply(ctx, config) / 各工具里读的 config.* 一一对应。
 *
 * 每个字段都必须 `.volatile()`：Host 侧 settings.describe() 用 volatileForm()
 * 过滤条目（dsh-settings/lib/index.js:123 —— 没有 volatile 字段的 Config 直接
 * 返回 undefined，条目整个不进 settings 文档），而浏览器端的 configForms
 * 只认 settings 文档里存在的命名空间。不加 volatile 的表现就是插件页那张卡片
 * 永远显示「没有拿到本插件的配置命名空间」。
 */
export const Config = z.object({
  // 只暴露用户真正要填的三项。BMAD 装在 $DSH_HOME/bmad-method 由插件自己管，
  // BMAD 本体由插件的依赖携带，用户不需要知道路径、也不需要下载。
  userName: z.string().default('').description('写进 BMAD 核心配置的用户名（留空用系统用户名）').volatile(),
  language: z.string().default(DEFAULT_LANGUAGE).description('沟通 + 文档输出语言').volatile(),
  outputFolder: z.string().default(DEFAULT_OUTPUT_FOLDER).description('工作区输出目录名').volatile(),
})

const text = (value) => [{ type: 'text', text: value }]

function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/* ------------------------------------------------ 插件页设置卡片的模块开关 API */

/**
 * 插件页那 7 行同名插件行（dsh 只按「包名」取行标题，同一包的多行标题必然相同），
 * 用户没法从列表里分出哪一行是哪个模块。所以模块开关放在本插件自己的设置卡片里：
 * 卡片是浏览器半端，调不了工具，只能走一条同源 HTTP 通道。
 *
 * 通道只做两件事：读模块列表、写某个模块的 disabled —— 写仍然是同一份 profile 补丁，
 * 与 bmad_module_toggle 工具、与 dsh 自己的插件开关共用唯一状态源。
 */
const API_PREFIX = '/api/bmad-method'

/** 只认本机同源：跨站网页拿不到我们的响应，也挡掉 DNS rebinding。 */
function sameOriginOk(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers?.host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        resolve('')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

/** 卡片要的数据：能开关的模块 + 当前状态。 */
function apiModules(config) {
  const patchPath = resolvePatchPath(config)
  if (!patchPath) {
    return { ok: false, error: '找不到 profile 的 cordis.patch.yml（本插件没挂在任何 profile 上？）', modules: [] }
  }
  const patchText = readPatchText(patchPath)
  const located = locateBmad({ cwd: process.cwd(), config })
  const data = listModules({
    projectRoot: located?.projectRoot,
    cwd: process.cwd(),
    enabledOf: (code) => isModuleEnabled(patchText, code),
  })
  return {
    ok: true,
    patchPath,
    bmadHome: located?.bmadHome ?? resolveBmadHome(config),
    global: located?.global ?? false,
    // 已废弃模块（automator / wds）在卡片里没有意义：装不上，也没有开关
    modules: (data.modules ?? [])
      .filter((m) => !m.deprecated)
      .map((m) => ({
        code: m.code,
        name: m.name ?? m.code,
        description: m.description ?? '',
        version: m.version ?? '',
        installed: Boolean(m.installed),
        enabled: m.enabled !== false,
        // core 是地基，不参与开关；没装的没东西可停用
        toggleable: m.code !== 'core' && Boolean(m.installed),
      })),
  }
}

async function handleApi(req, res, config) {
  try {
    if (!sameOriginOk(req)) {
      sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
      return
    }
    const url = String(req.url ?? '')
    const action = url.replace(API_PREFIX, '').split('?')[0].replace(/^\//, '')

    if (req.method === 'GET' && (action === 'modules' || action === '')) {
      sendJson(res, 200, await apiModules(config))
      return
    }
    if (req.method === 'POST' && action === 'toggle') {
      const raw = await readRequestBody(req)
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
        return
      }
      const result = await runToggle(
        { module: body.module, enabled: body.enabled },
        { agent: { session: { header: { cwd: process.cwd() } } } },
        config,
      )
      const ok = result.status === 'ok'
      sendJson(res, ok ? 200 : 409, { ...result, ...(await apiModules(config)), ok, toggleStatus: result.status })
      return
    }
    if (req.method === 'POST' && action === 'install') {
      // 新用户第一件事：把 BMAD 本体装到全局主目录（用插件自带的安装器，不联网下载 bmad-method）
      const boot = await bootstrapBmad(config)
      const payload = await apiModules(config)
      const notes = boot?.error
        ? [`BMAD 自举失败：${boot.error}`]
        : ['BMAD 已就绪：模块文件在插件主目录，skill 由插件直接提供。']
      sendJson(res, boot?.installed ? 200 : 500, { ...payload, ok: Boolean(boot?.installed), notes })
      return
    }
    sendJson(res, 404, { ok: false, error: `未知接口：${req.method} ${url}` })
  } catch (error) {
    try {
      sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
    } catch {
      /* 连接可能已断，忽略 */
    }
  }
}

/** 用户名：工具参数优先，其次设置页配置；都没有就交给安装器用系统用户名。 */
function resolvedUserName(args, config) {
  const fromArgs = typeof args?.userName === 'string' ? args.userName.trim() : ''
  if (fromArgs) return fromArgs
  const fromConfig = typeof config?.userName === 'string' ? config.userName.trim() : ''
  return fromConfig || undefined
}

/** 全局主目录还没有 BMAD，就用插件自带的安装器装一份（幂等；装过直接返回）。 */
async function bootstrapBmad(config) {
  try {
    const home = resolveBmadHome(config)
    const result = await ensureInstalled({
      bmadHome: home,
      userName: resolvedUserName({}, config),
      language: config?.language ?? DEFAULT_LANGUAGE,
      outputFolder: config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER,
    })
    return { ...result, home }
  } catch (error) {
    return { installed: false, fresh: false, error: String(error?.message ?? error) }
  }
}

export function apply(ctx, config = {}) {
  // 只挂一个实例（包内补丁只有 bmad-method 一行）。模块不再单独开行：
  // 同一个包开多行时 dsh 的行标题只能取包名，全都会叫 dsh-BMAD-Method。
  // 模块开关的表现是：该模块名下的 skill 不再出现在 skill 清单里。
  applyController(ctx, config)
}

/* ---------------------------------------------------------------- 控制面行 */

/**
 * skill provider 的 control。模块开关只改变「列不列这批 skill」，
 * 而 dsh 只在自己愿意的时候重扫 —— 拿到 control 就能在开关后主动 invalidate，
 * 让改动当轮生效，不用等下一轮对话。
 */
let skillProviderControl = null

/** 主动让宿主重扫 skill 清单（没有 provider 或宿主已销毁就静默跳过）。 */
function refreshSkills() {
  try {
    skillProviderControl?.invalidate?.()
  } catch {
    /* 忽略 */
  }
}

function applyController(ctx, config = {}) {
  // BMAD 的 90 个 skill 随插件包走，以原生 SkillProvider 的形式交给 dsh，
  // 不往用户机器的 skills 目录写任何文件。目标路径在 get 时按本机主目录现算。
  ctx.effect(() => {
    const skills = ctx.skills
    if (typeof skills?.registerProvider !== 'function') return
    return skills.registerProvider((control) => {
      skillProviderControl = control
      return new BmadSkillProvider(ctx, control, {
        skillDir: bundledSkillsDir(),
        getBmadHome: () => {
          try {
            return resolveBmadHome(config)
          } catch {
            return ''
          }
        },
        // 模块开关 = 它的 skill 还列不列。只读补丁里被标 disabled 的模块；
        // 读不到补丁就返回 null（不做过滤，宁可多给不误杀）
        getDisabledModules: () => {
          try {
            const patchPath = resolvePatchPath(config)
            if (!patchPath || !existsSync(patchPath)) return null
            const text = readFileSync(patchPath, 'utf8')
            return new Set(moduleRows(text).filter((row) => row.disabled).map((row) => row.code))
          } catch {
            return null
          }
        },
      })
    })
  }, 'dsh-BMAD-Method: skill provider')

  // 插件页设置卡片的模块开关通道（浏览器半端调不了工具，只能走同源 HTTP）
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: (req, res) => handleApi(req, res, config) }),
    'dsh-BMAD-Method: module api',
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'bmad_modules_list',
      description:
        '列出 BMAD 模块：已安装模块来自项目 _bmad/（manifest.yaml + 各模块 config.yaml），可安装模块来自官方 bmad-modules.yaml 注册表。每个模块的开关状态来自 profile 的 cordis.patch.yml（没有覆盖条目 = 启用）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', description: '项目根或 _bmad/ 路径；缺省从会话工作目录向上查找 _bmad/' },
          registryPath: { type: 'string', description: '覆盖 bmad-modules.yaml 路径，一般不需要' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            installed: { type: 'boolean' },
            projectRoot: { type: 'string' },
            bmadDir: { type: 'string' },
            coreVersion: { type: 'string' },
            patchPath: { type: 'string' },
            registrySource: { type: 'string' },
            modules: { type: 'array', items: { type: 'object', additionalProperties: true } },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (args, value) => text(renderList(value)),
      },
      execute: async (args, exec) => runList(args, exec, config),
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'bmad_module_toggle',
      description:
        '启用或停用一个 BMAD 模块：在 profile 的 cordis.patch.yml 里写/去 disabled: true。模块文件一个都不动（全部已装好），停用后该模块的 skill 下一轮对话就不在 dsh 的 skill 清单里，不用重启 dsh。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['module', 'enabled'],
        properties: {
          module: { type: 'string', description: 'BMAD 模块 code，如 bmm / bmb / cis / tea / gds' },
          enabled: { type: 'boolean', description: 'true 启用（重新参与 dsh），false 停用（只跳过加载，不删文件）' },
          projectRoot: { type: 'string', description: '安装目标目录；缺省用全局主目录' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            status: { type: 'string' },
            changed: { type: 'boolean' },
            module: { type: 'string' },
            enabled: { type: 'boolean' },
            patchPath: { type: 'string' },
            restartRequired: { type: 'boolean' },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (args, value) => text(renderToggle(value)),
      },
      execute: async (args, exec) => runToggle(args, exec, config),
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'bmad_update',
      description:
        '调用 BMAD 官方安装器更新框架与模块（npx bmad-method install --action update），默认按官方注册表把全部未废弃模块装齐（--modules 全量、--no-shims 不铺 IDE 文件），完成后重新读取模块列表。安装器自己的文件操作不在这里重写。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', description: '安装目标目录；缺省用全局主目录' },
          action: {
            type: 'string',
            enum: ['update', 'quick-update'],
            description: '交给安装器的 --action，默认 update（quick-update 只刷核心文件、保留模块设置）',
          },
          channel: { type: 'string', enum: ['stable', 'next'], description: '安装渠道，默认沿用安装器默认值' },
          userName: {
            type: 'string',
            description: '写进 BMAD 核心配置的用户名（安装器 --user-name）；不传就沿用已存的',
          },
          language: {
            type: 'string',
            description: `沟通 + 文档输出语言（--communication-language / --document-output-language），默认 ${DEFAULT_LANGUAGE}`,
          },
          modules: {
            type: 'string',
            description: '只装这几个模块（逗号分隔）；不传 = 注册表里全部未废弃模块一次装齐',
          },
          dryRun: { type: 'boolean', description: '只返回将要执行的命令，不真正运行' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            status: { type: 'string' },
            executed: { type: 'boolean' },
            via: { type: 'string' },
            command: { type: 'string' },
            exitCode: { type: 'number' },
            projectRoot: { type: 'string' },
            stdoutTail: { type: 'string' },
            stderrTail: { type: 'string' },
            modules: { type: 'array', items: { type: 'string' } },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (args, value) => text(renderUpdate(value)),
      },
      execute: async (args, exec) => runUpdate(args, exec, config),
    }),
  )
}

/* ------------------------------------------------------------------ 工具实现 */

function locate(args, exec, config) {
  return locateBmad({ projectRoot: args?.projectRoot, cwd: sessionCwd(exec), config })
}

function readPatchText(patchPath) {
  if (!patchPath || !existsSync(patchPath)) return ''
  return readFileSync(patchPath, 'utf8')
}

async function runList(args, exec, config) {
  const patchPath = resolvePatchPath(config)
  // 装完插件第一次调用就把 BMAD 装好：用插件自带的安装器，不联网下载。
  const boot = await bootstrapBmad(config)
  const located = locate(args, exec, config)
  const workspace = sessionCwd(exec)

  // 工作区输出目录（_bmad-output）：列一次模块就保证它存在
  let outputDir = null
  try {
    outputDir = ensureOutputDir(workspace, config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER)
  } catch {
    outputDir = null
  }

  const patchText = readPatchText(patchPath)
  const data = listModules({
    projectRoot: located?.projectRoot ?? args?.projectRoot,
    cwd: sessionCwd(exec),
    registryPath: args?.registryPath,
    enabledOf: (code) => isModuleEnabled(patchText, code),
  })

  const notes = [...data.notes]
  if (boot.fresh && boot.installed) {
    notes.push(
      boot.viaTemplate
        ? `首次使用：已把插件包自带的 BMAD 运行时铺到 ${boot.home}（七个模块一次到位，不跑安装器、不联网）。`
        : `首次使用：已用插件自带的安装器把 BMAD 装到 ${boot.home}（不联网下载 bmad-method）。`,
    )
  }
  if (boot.skills?.removed > 0) {
    notes.push(`已清掉安装器铺的 ${boot.skills.removed} 个 .claude/skills（BMAD skill 由插件包自带，不落用户目录）。`)
  }
  if (boot.error) notes.push(`BMAD 自举失败：${boot.error}`)
  if (!patchPath) notes.push('没有解析到 profile 的 cordis.patch.yml（DSH_PROFILE_DIR 未设置），开关会写不进去。')

  return {
    ...data,
    patchPath,
    bmadHome: located?.bmadHome ?? resolveBmadHome(config),
    global: located?.global ?? false,
    workspace,
    outputDir,
    notes,
  }
}

async function runToggle(args, exec, config) {
  const code = typeof args?.module === 'string' ? args.module.trim() : ''
  const wanted = args?.enabled
  const base = {
    status: 'noop',
    changed: false,
    module: code,
    enabled: false,
    patchPath: null,
    restartRequired: false,
    notes: [],
  }
  if (!code) return { ...base, status: 'invalid', notes: ['缺少 module 参数'] }
  await bootstrapBmad(config)
  if (typeof wanted !== 'boolean') return { ...base, status: 'invalid', notes: ['enabled 必须是布尔值'] }
  if (code === 'core') {
    return {
      ...base,
      status: 'not-toggleable',
      notes: ['core 是所有模块的地基（安装器每次都装），不参与启用/停用。'],
    }
  }

  const located = locate(args, exec, config)
  const targetDir = located?.projectRoot ?? resolveBmadHome(config)
  const bmadDir = located?.bmadDir ?? join(targetDir, '_bmad')
  const patchPath = resolvePatchPath(config)
  // 工作区该有的输出目录：任一工具被调用就保证它存在。
  // 从浏览器端（卡片开关）调进来时没有 session，别在宿主进程的 cwd 里乱建目录。
  const workspace = exec?.agent?.session?.header?.cwd
  if (workspace) {
    try {
      ensureOutputDir(workspace, config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER)
    } catch {
      /* 建不了就跳过，安装器/列表里会各自再报 */
    }
  }
  if (!patchPath) {
    return {
      ...base,
      status: 'patch-unresolved',
      notes: ['没有解析到 profile 的 cordis.patch.yml（DSH_PROFILE_DIR / DSH_HOME 都没有设置）。'],
    }
  }

  const current = enabledModuleCodes(bmadDir)
  if (!wanted && !current.includes(code)) {
    return {
      ...base,
      status: 'module-not-installed',
      notes: [
        `已安装集合里没有 ${code}，停用无从谈起。当前启用：${current.join(', ') || '（无）'}`,
        '先跑一次 bmad_update 把全部模块装齐，再开关。',
      ],
    }
  }

  // 只改补丁：模块文件全部保留，开关只决定这个模块的 skill 参不参与 dsh（不装卸、不跑安装器）
  try {
    const result = editPatch(
      patchPath,
      (patched) => setModuleRow(patched, code, wanted),
      (reread) => isModuleEnabled(reread, code) === wanted,
    )
    const effective = isModuleEnabled(result.text, code)
    // 补丁变了就清掉宿主侧的 skill 清单缓存，下一轮对话会重新对比
    refreshSkills()
    const notes = [
      `行 id：${moduleRowId(code)}`,
      result.changed ? '已写入 cordis.patch.yml。' : '补丁里已经是目标状态，未改动补丁文件。',
      wanted
        ? '已恢复：该模块的 skill 下一轮对话会重新出现在 skill 清单里。'
        : '已停用：该模块的 skill 下一轮对话就不再出现在 skill 清单里。',
      '不用重启 dsh：补丁写完已清掉宿主的清单缓存，下一轮对话时 dsh 重新收集并下发新的 catalog；模块文件一个都没删。',
    ]
    return {
      status: effective === wanted ? 'ok' : 'verify-failed',
      changed: result.changed,
      module: code,
      enabled: effective,
      patchPath,
      restartRequired: false,
      notes,
    }
  } catch (error) {
    return {
      ...base,
      status: 'write-failed',
      patchPath,
      notes: [
        String(error?.message ?? error),
        '补丁写入失败已回滚，配置文件与工具报告保持一致。',
      ],
    }
  }
}

async function runUpdate(args, exec, config) {
  const located = locate(args, exec, config)
  const targetDir = located?.projectRoot ?? resolveBmadHome(config)
  const bmadDir = located?.bmadDir ?? join(targetDir, '_bmad')
  const workspace = sessionCwd(exec)
  let outputDir = null
  try {
    outputDir = ensureOutputDir(workspace, config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER)
  } catch {
    outputDir = null
  }

  // 模块集合：默认一次装齐注册表里所有未废弃模块（插件要"全部封装"）；
  // 只有显式传 modules=逗号串 时才按指定的装。
  const explicit = typeof args?.modules === 'string' ? args.modules.trim() : ''
  let modules
  if (explicit) {
    modules = explicit.split(',').map((s) => s.trim()).filter(Boolean)
  } else {
    const { modules: registryModules } = loadRegistry({
      projectRoot: targetDir,
      cwd: workspace,
      registryPath: args?.registryPath,
    })
    modules = allRegistryModules(registryModules)
      .filter((m) => !m.deprecated)
      .map((m) => m.code)
  }
  const language = args?.language ?? config?.language ?? DEFAULT_LANGUAGE
  // 已装过就沿用 manifest.ides；全新安装才需要一个 IDE 值（安装器非交互模式强制要求）
  const tools = resolveTools(bmadDir, DEFAULT_TOOLS)
  const base = {
    executed: false,
    via: '',
    command: '',
    exitCode: null,
    projectRoot: targetDir,
    stdoutTail: '',
    stderrTail: '',
    modules: [],
    notes: [],
  }

  let invocation
  try {
    invocation = buildInstallCommand({
      targetDir,
      action: args?.action ?? 'update',
      channel: args?.channel,
      // 默认 --no-shims：不往磁盘铺任何 IDE 接入文件（这套是给 dsh 用的，不是给别的 IDE）
      shims: args?.shims ?? false,
      modules,
      tools,
      userName: typeof args?.userName === 'string' && args.userName.trim() ? args.userName.trim() : undefined,
      language,
      outputFolder: config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER,
    })
  } catch (error) {
    return { ...base, status: 'invalid', notes: [String(error?.message ?? error)] }
  }

  let commandLine = [invocation.command, ...invocation.args].join(' ')
  const afterModules = () =>
    readInstalledModules(bmadDir).map((m) => `${m.code}${m.version ? `@${m.version}` : ''}`)

  if (args?.dryRun === true) {
    return {
      ...base,
      status: 'dry-run',
      via: invocation.via,
      command: commandLine,
      modules: afterModules(),
      notes: [
        'dryRun：只组装了命令，没有执行。',
        `目标目录：${targetDir}（${located?.global ? '全局安装' : located ? '项目内安装' : '尚未安装，执行即首次安装'}）`,
        `工作区输出目录：${outputDir ?? '（未创建）'}`,
      ],
    }
  }

  let result = await runInstaller({ ...invocation, cwd: targetDir })
  let degradedNote = ''
  // 外部模块要 git clone（访问 GitHub），网络不通会让整次安装失败。
  // 先退到内置模块把 BMAD 装起来，别让用户一个模块都用不上。
  if (!result.ok && !result.timedOut && modules.length > 1) {
    const fallback = buildInstallCommand({
      targetDir,
      action: args?.action ?? 'update',
      channel: args?.channel,
      shims: args?.shims ?? false,
      modules: ['bmm'],
      tools,
      userName:
        typeof args?.userName === 'string' && args.userName.trim() ? args.userName.trim() : undefined,
      language,
      outputFolder: config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER,
    })
    const retry = await runInstaller({ ...fallback, cwd: targetDir })
    if (retry.ok) {
      degradedNote =
        '外部模块没装上（安装器要 git clone 各模块仓库，多半是访问不了 GitHub）；已退到内置模块 bmm 重试成功。网络恢复后再跑一次 bmad_update 就能补齐。'
      result = retry
      invocation = fallback
    }
  }
  commandLine = [invocation.command, ...invocation.args].join(' ')
  const notes = []
  notes.push(`语言：${language}（沟通 + 文档输出）；输出目录：${config?.outputFolder ?? DEFAULT_OUTPUT_FOLDER}。`)
  notes.push(
    typeof args?.userName === 'string' && args.userName.trim()
      ? `用户名按参数写入：${args.userName.trim()}`
      : '没传 userName：安装器沿用核心配置里已存的用户名（首次安装则取系统用户名）。',
  )
  notes.push(`模块集合（--modules）：${modules.join(',') || '（空）'}`)
  if (result.timedOut) notes.push('安装器超时（10 分钟），已终止；输出可能不完整。')
  if (!result.ok && !result.timedOut) notes.push(`安装器退出码 ${result.exitCode}，看 stderr 定位原因。`)
  // 实测：manifest 里没记录过 ides 的项目，非交互更新会被安装器要求补 --tools
  if (!result.ok && /--tools is required/.test(`${result.stderr}${result.stdout}`)) {
    notes.push('安装器要求 --tools：调用时传 tools，或先把 manifest.ides 补上。')
  }
  // 安装器会把 skill 正文铺成 <目标目录>/.claude/skills（--no-shims 拦不住，_bmad/ 里没有正文）。
  // 这些 skill 插件包里已经自带（skills/bmad-*），安装产物直接丢掉，不留 IDE 入口目录。
  const ideDir = join(targetDir, '.claude')
  if (result.ok && existsSync(ideDir)) {
    try {
      rmSync(ideDir, { recursive: true, force: true })
      notes.push('已清掉安装器铺的 .claude/skills（skill 由插件包自带，不需要落任何用户目录）。')
    } catch (error) {
      notes.push(`清 .claude/skills 失败（不影响使用）：${String(error?.message ?? error)}`)
    }
  }
  if (degradedNote) notes.push(degradedNote)
  if (result.ok) {
    notes.push('更新完成，模块列表已重新读取；新增/升级的模块可用 bmad_modules_list 查看。')
    // 装完模块后 skill 归属表可能变了，让宿主重扫一次
    refreshSkills()
  }

  return {
    status: result.timedOut ? 'timeout' : result.ok ? 'ok' : 'failed',
    executed: true,
    via: invocation.via,
    command: commandLine,
    exitCode: result.exitCode,
    projectRoot: targetDir,
    stdoutTail: tail(result.stdout, 4000),
    stderrTail: tail(result.stderr, 2000),
    modules: afterModules(),
    notes,
  }
}

function tail(value, limit) {
  const content = (value ?? '').trim()
  return content.length > limit ? `…${content.slice(-limit)}` : content
}

/* -------------------------------------------------------------------- 渲染 */

function renderList(value) {
  const lines = []
  if (!value.installed) {
    lines.push(`BMAD：未安装（${value.bmadHome ?? '未知目录'} 下没有 _bmad/）`)
    lines.push('首次安装：调一次 bmad_update（可先 dryRun 看命令），会按 --modules 装到全局主目录。')
  } else {
    lines.push(`BMAD ${value.global ? '全局安装' : '项目内安装'}：${value.projectRoot}`)
    lines.push(`核心版本：${value.coreVersion ?? '未知'}    补丁：${value.patchPath ?? '（未解析到）'}`)
    lines.push(`工作区输出目录：${value.outputDir ?? '（未创建）'}`)
  }

  const onList = value.modules.filter((m) => m.installed && m.enabled)
  const offList = value.modules.filter((m) => m.installed && !m.enabled)
  const available = value.modules.filter((m) => !m.installed)

  if (onList.length) {
    lines.push('', `已安装·启用（${onList.length}）：`)
    for (const m of onList) lines.push(`  [x] ${m.code}  ${m.name}${m.version ? ` ${m.version}` : ''}`)
  }
  if (offList.length) {
    lines.push('', `已安装·停用（${offList.length}，其 skill 不参与 dsh）：`)
    for (const m of offList) lines.push(`  [ ] ${m.code}  ${m.name}${m.version ? ` ${m.version}` : ''}`)
  }
  if (available.length) {
    lines.push('', `可安装未安装（${available.length}）：`)
    for (const m of available) {
      lines.push(`  + ${m.code}  ${m.name}${m.deprecated ? '  [已弃用]' : ''}`)
    }
  }
  if (value.patchPath) {
    lines.push('', `开关状态：${value.patchPath}（模块开关也在插件详情页「BMAD 设置」卡片里，同一个状态）`)
  }
  for (const note of value.notes ?? []) lines.push('', `注：${note}`)
  return lines.join('\n')
}

function renderToggle(value) {
  if (value.status !== 'ok' && value.status !== 'noop') {
    return [`模块开关未完成：${value.status}`, ...(value.notes ?? [])].join('\n')
  }
  const state = value.enabled ? '启用' : '停用'
  const lines = [
    `模块 ${value.module} 已${state}${value.changed ? '' : '（补丁本来就是该状态）'}`,
    `补丁文件：${value.patchPath}`,
  ]
  if (value.restartRequired) lines.push('需要重启 dsh 才能生效。')
  else lines.push('不用重启 dsh：下一轮对话时 dsh 会重新收集 skill 清单并下发新的 catalog。')
  for (const n of value.notes ?? []) lines.push(`注：${n}`)
  return lines.join('\n')
}

function renderUpdate(value) {
  const lines = [`更新状态：${value.status}（${value.via || '未执行'}）`, `命令：${value.command}`]
  if (value.projectRoot) lines.push(`项目：${value.projectRoot}`)
  if (value.modules?.length) lines.push(`当前模块：${value.modules.join(', ')}`)
  if (value.stdoutTail) lines.push('', '--- stdout ---', value.stdoutTail)
  if (value.stderrTail) lines.push('', '--- stderr ---', value.stderrTail)
  for (const note of value.notes ?? []) lines.push('', `注：${note}`)
  return lines.join('\n')
}
