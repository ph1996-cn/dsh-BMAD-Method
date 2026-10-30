/**
 * BMAD-Method 的只读发现层 + 安装器调用层。
 *
 * 原则：模块清单不硬编码。已安装模块来自项目 _bmad/ 目录（manifest.yaml / 各模块
 * config.yaml），可安装模块来自 BMAD 官方注册表 bmad-modules.yaml（优先用项目里
 * node_modules/bmad-method 自带的那份，找不到就用插件包内的快照）。
 * 更新动作也不自己改文件，一律交给 BMAD 官方安装器的非交互接口。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const requireFromHere = createRequire(import.meta.url)

const HERE = dirname(fileURLToPath(import.meta.url))
export const BUNDLED_REGISTRY = join(HERE, 'registry', 'bmad-modules.yaml')

/**
 * BMAD 的内置模块不在官方注册表里（注册表只管外部模块，注释见包内 bmad-modules.yaml 开头），
 * 这里补齐，保证「全部模块」的清单不缺 core / bmm 两块。
 */
const BUILTIN_MODULES = [
  {
    code: 'core',
    name: 'BMAD Core',
    description: '所有模块共用的核心工作流与技能（每次安装都会带上）',
    type: 'builtin',
    npmPackage: 'bmad-method',
    deprecated: false,
    aliases: [],
  },
  {
    code: 'bmm',
    name: 'BMad Method',
    description: '敏捷规划与交付主模块：分析 / 规划 / 方案 / 实施全流程',
    type: 'builtin',
    npmPackage: 'bmad-method',
    deprecated: false,
    aliases: [],
  },
]

/** 注册表 + 内置模块，按 code/别名去重。 */
export function allRegistryModules(registryModules) {
  const known = new Set()
  for (const entry of registryModules) {
    known.add(entry.code)
    for (const alias of entry.aliases) known.add(alias)
  }
  return [...registryModules, ...BUILTIN_MODULES.filter((m) => !known.has(m.code))]
}

/** 从 startDir 逐级向上找含有 _bmad/ 的目录，返回项目根与 _bmad 路径。 */
export function locateProject(startDir = process.cwd()) {
  let dir = resolve(startDir)
  for (;;) {
    const bmadDir = join(dir, '_bmad')
    if (existsSync(bmadDir) && safeIsDir(bmadDir)) return { projectRoot: dir, bmadDir }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** 默认输出目录名：安装器 --output-folder 的默认值，插件负责在工作区把它建出来。 */
export const DEFAULT_OUTPUT_FOLDER = '_bmad-output'

/** 默认语言（简体中文），但允许调用方覆盖 —— 用户可自定义语言。 */
export const DEFAULT_LANGUAGE = '简体中文'

/** 首次非交互安装必须给 --tools；没有可用记录时用它。 */
export const DEFAULT_TOOLS = 'claude-code'

/**
 * BMAD 的全局主目录：插件侧一份，所有工作区共用。用户不需要配。
 * 工作区里不落 _bmad/，模块文件全在这里。
 */
export function resolveBmadHome(config = {}) {
  if (typeof config?.bmadHome === 'string' && config.bmadHome.trim()) return resolve(config.bmadHome.trim())
  if (process.env.DSH_BMAD_HOME) return resolve(process.env.DSH_BMAD_HOME)
  const base = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  return join(base, 'bmad-method')
}

/**
 * 安装器会把 skill 正文铺成 <home>/.claude/skills（--no-shims 拦不住，installer.js:141
 * 注释写明 skills 只在 IDE 目录里）。这些 skill 插件包已经自带（skills/bmad-*，
 * 见 lib/skills.js），安装产物直接丢掉 —— 用户机器上不该多出任何 IDE 目录，
 * 也不该往 $DSH_HOME/skills 塞东西。
 *
 * 返回清掉的 skill 目录数，只用于给用户一句说明。
 */
function dropIdeSkills(home) {
  const ideDir = join(home, '.claude')
  if (!existsSync(ideDir)) return { removed: 0 }
  let removed = 0
  try {
    const skillsDir = join(ideDir, 'skills')
    if (existsSync(skillsDir)) {
      removed = readdirSync(skillsDir).filter((entry) => entry.startsWith('bmad-')).length
    }
    rmSync(ideDir, { recursive: true, force: true })
  } catch {
    // 删不掉不影响 BMAD 本体
  }
  return { removed }
}

/** 在工作区建出输出目录（装完插件后工作区就该有 _bmad-output）。 */
export function ensureOutputDir(workspace, folder = DEFAULT_OUTPUT_FOLDER) {
  if (!workspace) return null
  const dir = join(resolve(workspace), folder || DEFAULT_OUTPUT_FOLDER)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 首次自举 + 版本对齐：全局主目录没有 _bmad/ 就用插件自带安装器装一份；
 * 插件升级带来的 bmad-method 版本变了，就顺带刷新一次 —— 用户更新插件即完成 BMAD 更新。
 * 装 bmad-method 依赖时就落地了，这里不联网、不下载。
 *
 * 装「全部未废弃模块」而不是只装 core+bmm：包内 90 个 skill 覆盖 7 个模块，
 * 模块自己的 _bmad/<code>/config.yaml 缺了，skill 运行时会读不到配置。
 * 外部模块靠 git clone，网络不通就降级成内置的 core+bmm（skill 仍在包里，功能不受影响）。
 */
export async function ensureInstalled({ bmadHome, userName, language, outputFolder }) {
  const home = bmadHome || resolveBmadHome()
  const manifest = join(home, '_bmad', '_config', 'manifest.yaml')
  const bundledVersion = readBundledVersion()
  // 测试要离线、要快：DSH_BMAD_MINIMAL=1 时只装内置模块
  const minimal = process.env.DSH_BMAD_MINIMAL === '1'
  const wanted = minimal
    ? ['core', 'bmm']
    : allRegistryModules(loadRegistry({ cwd: home })?.modules ?? [])
        .filter((m) => !m.deprecated)
        .map((m) => m.code)

  if (existsSync(manifest)) {
    const installedVersion = readCoreVersion(join(home, '_bmad'))
    const have = new Set(readInstalledModules(join(home, '_bmad')).map((m) => m.code))
    // 包内 skill 覆盖的模块都得有一份 _bmad/<code>，否则那些 skill 读不到模块配置
    const missing = wanted.filter((code) => !have.has(code))
    const versionOk = !bundledVersion || !installedVersion || installedVersion === bundledVersion
    if (versionOk && missing.length === 0) {
      return { installed: true, fresh: false, installedVersion, bundledVersion }
    }
  }
  mkdirSync(home, { recursive: true })

  const attempt = async (modules) => {
    const invocation = buildInstallCommand({
      targetDir: home,
      action: 'update',
      shims: false,
      modules,
      tools: DEFAULT_TOOLS,
      userName,
      language,
      outputFolder,
    })
    return { invocation, result: await runInstaller({ ...invocation, cwd: home }) }
  }

  let { result } = await attempt(wanted)
  let degraded = false
  if (!result.ok && wanted.length > 2) {
    // 外部模块要 git clone，网络不通会整次失败 —— 退回内置模块，保证 BMAD 至少能用
    degraded = true
    ;({ result } = await attempt(['core', 'bmm']))
  }
  // 安装器铺的 .claude/skills 一律丢掉：skill 由插件包自带，不落用户目录
  let skills = { removed: 0 }
  if (result.ok) skills = dropIdeSkills(home)
  if (!result.ok) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(-3).join(' ')
    return { installed: false, fresh: true, result, skills, error: detail || `安装器退出码 ${result.exitCode ?? '未知'}` }
  }
  return { installed: result.ok, fresh: true, result, skills, degraded, modules: degraded ? ['core', 'bmm'] : wanted }
}

/** 目前启用的已安装模块 code（core 是地基，不算开关项）。 */
export function enabledModuleCodes(bmadDir) {
  return readInstalledModules(bmadDir)
    .map((m) => m.code)
    .filter((code) => code !== 'core')
}

/** 从 manifest 取安装时用过的 IDE（首次非交互安装必须给 --tools）。 */
export function resolveTools(bmadDir, fallback = DEFAULT_TOOLS) {
  const manifest = readManifest(bmadDir)
  const ides = Array.isArray(manifest?.ides) ? manifest.ides.filter((x) => typeof x === 'string' && x) : []
  return ides.length ? ides.join(',') : fallback
}

/**
 * 定位 BMAD 的实际安装位置。
 * 顺序：显式 projectRoot（老项目，其下有 _bmad）> 全局主目录 > 从 cwd 向上找 _bmad。
 */
export function locateBmad({ projectRoot, cwd = process.cwd(), config = {} } = {}) {
  const explicit = projectRoot ? findExplicitProject(projectRoot) : null
  if (explicit) return { ...explicit, global: false, bmadHome: resolveBmadHome(config) }

  const home = resolveBmadHome(config)
  const homeBmad = join(home, '_bmad')
  if (existsSync(homeBmad) && safeIsDir(homeBmad)) {
    return { projectRoot: home, bmadDir: homeBmad, global: true, bmadHome: home }
  }

  const inProject = locateProject(cwd)
  if (inProject) return { ...inProject, global: false, bmadHome: home }

  return null
}

function safeIsDir(path) {  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function tryYaml(path) {
  try {
    if (!existsSync(path)) return null
    return parseYaml(readFileSync(path, 'utf8')) ?? null
  } catch {
    return null
  }
}

/** _bmad/_config/manifest.yaml */
function readManifest(bmadDir) {
  return tryYaml(join(bmadDir, '_config', 'manifest.yaml'))
}

/** _bmad/core/config.yaml（BMAD 核心版本，独立于各模块） */
export function readCore(bmadDir) {
  const config = tryYaml(join(bmadDir, 'core', 'config.yaml'))
  const manifest = readManifest(bmadDir)
  return {
    version: config?.version ?? manifest?.installation?.version ?? null,
    name: config?.name ?? 'BMAD Core',
  }
}

/** 插件自带 bmad-method 的版本（依赖没落地时返回 null）。 */
function readBundledVersion() {
  try {
    const pkg = requireFromHere.resolve('bmad-method/package.json')
    return JSON.parse(readFileSync(pkg, 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** 已安装的那份 BMAD 的版本。 */
function readCoreVersion(bmadDir) {
  try {
    return readCore(bmadDir)?.version ?? null
  } catch {
    return null
  }
}

/** 扫描 _bmad/ 下各模块目录（含 config.yaml 且不以 _ 开头）。 */
function scanModuleDirs(bmadDir) {
  let entries = []
  try {
    entries = readdirSync(bmadDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(bmadDir, name, 'config.yaml')))
}

/**
 * 读取项目里已安装的模块。
 * manifest 与目录扫描互为兜底：manifest 提供版本/来源，目录扫描保证「文件在就算在」。
 */
export function readInstalledModules(bmadDir) {
  const manifest = readManifest(bmadDir)
  const fromManifest = new Map()
  for (const item of Array.isArray(manifest?.modules) ? manifest.modules : []) {
    const code = item?.name ?? item?.code
    if (typeof code === 'string' && code) fromManifest.set(code, item)
  }

  const codes = [...new Set([...fromManifest.keys(), ...scanModuleDirs(bmadDir)])].sort()
  return codes.map((code) => {
    const config = tryYaml(join(bmadDir, code, 'config.yaml')) ?? {}
    const meta = fromManifest.get(code) ?? {}
    return {
      code,
      name: typeof config.name === 'string' && config.name ? config.name : code,
      description: typeof config.description === 'string' ? config.description : '',
      version: config.version ?? meta.version ?? null,
      installed: existsSync(join(bmadDir, code)),
      lastUpdated: meta.lastUpdated ?? meta.installDate ?? null,
      source: meta.source ?? 'unknown',
      dir: join(bmadDir, code),
    }
  })
}

/** 官方模块注册表：优先项目内 node_modules/bmad-method 自带，其次插件包内快照。 */
export function loadRegistry({ projectRoot, cwd = process.cwd(), registryPath } = {}) {
  const candidates = []
  if (registryPath) candidates.push({ path: registryPath, source: 'configured' })
  if (!registryPath) {
    // 插件依赖里的 bmad-method 自带注册表 —— 跟着插件版本走，优先用它。
    try {
      const pkg = requireFromHere.resolve('bmad-method/package.json')
      candidates.push({ path: join(dirname(pkg), 'bmad-modules.yaml'), source: 'bundled-package' })
    } catch {
      // 依赖没落地，靠下面的项目内查找与快照
    }
    for (const base of [projectRoot, cwd]) {
      if (!base) continue
      let dir = resolve(base)
      for (let depth = 0; depth < 4; depth++) {
        candidates.push({
          path: join(dir, 'node_modules', 'bmad-method', 'bmad-modules.yaml'),
          source: 'local-package',
        })
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }
    candidates.push({ path: BUNDLED_REGISTRY, source: 'bundled-snapshot' })
  }

  for (const candidate of candidates) {
    const parsed = tryYaml(candidate.path)
    if (!parsed?.modules) continue
    const modules = Object.entries(parsed.modules).map(([key, value]) => ({
      code: value?.code ?? key,
      key,
      name: value?.name ?? value?.code ?? key,
      description: value?.description ?? '',
      type: value?.type ?? 'module',
      npmPackage: value?.npmPackage ?? null,
      deprecated: value?.deprecated === true,
      aliases: Array.isArray(value?.aliases) ? value.aliases : [],
    }))
    return { modules, source: candidate.source, path: candidate.path }
  }
  return { modules: [], source: 'unavailable', path: null }
}

/** 把注册表与安装状态合并成工具输出用的清单。 */
export function listModules({ projectRoot, cwd, registryPath, enabledOf }) {
  const located = projectRoot ? findExplicitProject(projectRoot) : locateProject(cwd ?? process.cwd())
  const registry = loadRegistry({ projectRoot: located?.projectRoot ?? projectRoot, cwd, registryPath })
  const registryModules = allRegistryModules(registry.modules)

  if (!located) {
    return {
      installed: false,
      projectRoot: null,
      bmadDir: null,
      coreVersion: null,
      registrySource: registry.source,
      registryPath: registry.path,
      modules: registryModules.map((m) => ({ ...pickRegistry(m), installed: false, enabled: false })),
      notes: [
        '当前目录树里没有找到 _bmad/：BMAD 未安装或不在本工作区。',
        '安装：npx bmad-method install --directory <项目根> --tools <ide> --yes',
      ],
    }
  }

  const core = readCore(located.bmadDir)
  const installed = readInstalledModules(located.bmadDir)
  const installedByCode = new Map(installed.map((m) => [m.code, m]))
  const registryByCode = new Map()
  for (const entry of registryModules) {
    registryByCode.set(entry.code, entry)
    for (const alias of entry.aliases) registryByCode.set(alias, entry)
  }

  const modules = installed.map((m) => {
    const reg = registryByCode.get(m.code)
    return {
      code: m.code,
      name: reg?.name || m.name || m.code,
      description: reg?.description || m.description || '',
      installed: true,
      enabled: enabledOf ? enabledOf(m.code) : true,
      version: m.version,
      type: reg?.type ?? (BUILTIN_MODULES.some((b) => b.code === m.code) ? 'builtin' : 'external'),
      deprecated: reg?.deprecated === true,
      path: m.dir,
    }
  })

  for (const entry of registryModules) {
    if (installedByCode.has(entry.code)) continue
    if (entry.aliases.some((alias) => installedByCode.has(alias))) continue
    modules.push({ ...pickRegistry(entry), installed: false, enabled: false, version: null, path: null })
  }

  modules.sort((a, b) => Number(b.installed) - Number(a.installed) || a.code.localeCompare(b.code))

  const notes = []
  if (registry.source === 'bundled-snapshot') {
    notes.push('可安装模块来自插件包内的注册表快照（未找到本地 bmad-method 包）。')
  }
  if (registry.source === 'unavailable') {
    notes.push('没有读到 BMAD 模块注册表，只列出已安装模块。')
  }
  return {
    installed: true,
    projectRoot: located.projectRoot,
    bmadDir: located.bmadDir,
    coreVersion: core.version,
    registrySource: registry.source,
    registryPath: registry.path,
    modules,
    notes,
  }
}

function pickRegistry(entry) {
  return {
    code: entry.code,
    name: entry.name,
    description: entry.description,
    type: entry.type ?? 'module',
    deprecated: entry.deprecated,
  }
}

/** projectRoot 显式给出时，既允许指向项目根，也允许直接指向 _bmad/。 */
export function findExplicitProject(projectRoot) {
  const abs = isAbsolute(projectRoot) ? projectRoot : resolve(projectRoot)
  if (abs.endsWith('_bmad') && safeIsDir(abs)) {
    return { projectRoot: dirname(abs), bmadDir: abs }
  }
  const located = locateProject(abs)
  return located
}

/** 单模块的一句话描述，供 systemPrompt 上下文使用；读不到就返回空串（不吵人）。 */
export function describeInstalledModule(code, bmadDir) {
  try {
    const config = tryYaml(join(bmadDir, code, 'config.yaml'))
    const manifest = readManifest(bmadDir)
    const meta = (Array.isArray(manifest?.modules) ? manifest.modules : []).find(
      (m) => (m?.name ?? m?.code) === code,
    )
    const name = config?.name ?? code
    const version = config?.version ?? meta?.version ?? null
    const description = config?.description ?? ''
    // 版本号原样显示：外部模块自带 v 前缀（v0.13.2），内置的是 6.12.4
    const tag = version ? ` ${version}` : ''
    const line = [`- BMAD 模块 ${name}（${code}${tag}）`]
    if (description) line.push(`  ${description}`)
    line.push(`  模块目录：${join(bmadDir, code)}`)
    return line.join('\n')
  } catch {
    return ''
  }
}

/** 找 BMAD 安装器的启动方式：插件自带依赖 > 项目内包 > 全局包 > npx 兜底。 */
export function resolveInstaller({ projectRoot, cwd = process.cwd() }) {
  const cliRelative = join('bmad-method', 'tools', 'installer', 'bmad-cli.js')
  // 插件自己依赖 bmad-method：装插件时就落地了，直接跑它的 CLI。
  // 不再 npx 联网拉 bmad-method@latest —— 更新 BMAD 等于更新插件版本。
  try {
    const bundled = requireFromHere.resolve('bmad-method/tools/installer/bmad-cli.js')
    if (existsSync(bundled)) return { command: process.execPath, args: [bundled], via: 'bundled-package' }
  } catch {
    // 依赖没落地（裁剪安装等），继续往下找
  }
  const bases = []
  for (const base of [projectRoot, cwd]) {
    if (base) bases.push(resolve(base))
  }
  for (const base of bases) {
    let dir = base
    for (let depth = 0; depth < 6; depth++) {
      const candidate = join(dir, 'node_modules', cliRelative)
      if (existsSync(candidate)) return { command: process.execPath, args: [candidate], via: 'local-package' }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  const globalCandidates = [
    process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', cliRelative),
    '/usr/local/lib/node_modules/' + cliRelative,
    '/usr/lib/node_modules/' + cliRelative,
  ].filter(Boolean)
  for (const candidate of globalCandidates) {
    if (existsSync(candidate)) return { command: process.execPath, args: [candidate], via: 'global-package' }
  }
  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['bmad-method@latest'],
    via: 'npx',
    shell: process.platform === 'win32',
  }
}

/** 组装安装/更新命令（不执行），便于测试与 dryRun。 */
export function buildInstallCommand({
  targetDir,
  action = 'update',
  channel,
  shims,
  modules,
  tools,
  userName,
  language = DEFAULT_LANGUAGE,
  outputFolder = DEFAULT_OUTPUT_FOLDER,
}) {
  if (!targetDir) throw new Error('缺少安装目标目录（--directory）')
  // 实测 6.12.4：安装器只接受 update / quick-update，传 install 会直接报 Invalid action
  if (!['update', 'quick-update'].includes(action)) {
    throw new Error(`不支持的更新动作：${action}（可选 update / quick-update）`)
  }
  if (channel && !['stable', 'next'].includes(channel)) {
    throw new Error(`不支持的渠道：${channel}（可选 stable / next）`)
  }
  const installer = resolveInstaller({ projectRoot: targetDir })
  const args = [...installer.args, 'install', '--directory', targetDir, '--action', action, '--yes']
  // --modules 是权威集合：不在列表里的模块会被卸载（实测），所以开关直接换算成这个参数
  const list = Array.isArray(modules) ? modules.filter((x) => typeof x === 'string' && x.trim()) : []
  if (list.length) args.push('--modules', list.join(','))
  if (tools) args.push('--tools', tools)
  if (channel) args.push('--channel', channel)
  if (typeof shims === 'boolean') args.push(shims ? '--shims' : '--no-shims')
  // 用户名由调用方给；不给就沿用安装器里已存的（实测不传时不会覆盖旧值）
  if (userName) args.push('--user-name', userName)
  if (outputFolder) args.push('--output-folder', outputFolder)
  args.push('--communication-language', language, '--document-output-language', language)
  return { command: installer.command, args, via: installer.via, shell: installer.shell === true }
}

/** 执行安装器，抓取输出（有界），返回结构化结果。 */
export function runInstaller(invocation, { timeoutMs = 600000, maxBytes = 40000 } = {}) {
  return new Promise((done) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd ?? undefined,
      shell: invocation.shell === true,
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGTERM')
      } catch {
        /* 进程已退出 */
      }
      done({ ok: false, timedOut: true, exitCode: null, stdout, stderr })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < maxBytes) stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < maxBytes) stderr += String(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done({ ok: false, timedOut: false, exitCode: null, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done({ ok: code === 0, timedOut: false, exitCode: code, stdout, stderr })
    })
  })
}
