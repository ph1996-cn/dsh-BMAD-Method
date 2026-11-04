/**
 * 包内自带的 BMAD 运行时模板。
 *
 * BMAD 的安装器会把「本机配置」和「用户个人答案」一起写进 `_bmad/`：core 与各模块的
 * config.yaml 底部都有一段 Core Configuration Values（user_name / 语言 / output_folder）。
 * 所以模板不能只是原样拷贝，落盘后要按设置页填的那几项改写一遍。
 *
 * 这样装完插件就能直接用 —— 不必等安装器跑 60 秒、也不必联网拉外部模块。
 * 模板版本与本包 bmad-method 依赖不一致时不用模板（见 lib/bmad.js 的 ensureInstalled），
 * 免得把旧版本文件铺到一个新版本安装器预期的目录结构上。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包内 `bmad-home/_bmad` 的绝对路径。 */
export const TEMPLATE_ROOT = fileURLToPath(new URL('../bmad-home', import.meta.url))

/** 只读、不需要改写的大件：落盘时用 junction 指回包内，不复制。 */
const LINKED_DIRS = ['scripts', '_config']

/** 会被写入用户答案的配置文件：必须落盘成真文件。 */
const MUTABLE_FILES = ['config.toml', 'config.user.toml']

/** 模板在不在（发布包里一定有；源码里被人删了就走安装器）。 */
export function hasTemplate() {
  return existsSync(join(TEMPLATE_ROOT, '_bmad', 'core', 'config.yaml'))
}

/** 模板里记录的 BMAD 版本（读模板自己的 manifest）。 */
export function templateVersion() {
  try {
    const text = readFileSync(join(TEMPLATE_ROOT, '_bmad', '_config', 'manifest.yaml'), 'utf8')
    const block = text.split(/^installation:/m)[1] ?? ''
    return block.match(/^\s+version:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null
  } catch {
    return null
  }
}

/**
 * 把模板铺到 home，并把用户设置写进配置。
 * @param {string} home BMAD 主目录（`<home>/_bmad` 会被创建）
 * @param {{ userName?: string, language?: string, outputFolder?: string }} options
 */
export function materializeBmadHome(home, options = {}) {
  const source = join(TEMPLATE_ROOT, '_bmad')
  const target = join(home, '_bmad')
  mkdirSync(home, { recursive: true })
  // custom/ 是用户自己的定制（团队共享 + 个人覆盖），模板里只有空壳 —— 重铺前先保住它，
  // 否则补装模块时会把人家改过的 config.toml 一起抹掉。
  const customDir = join(target, 'custom')
  const stash = join(home, '.bmad-custom-stash')
  const hadCustom = existsSync(customDir)
  if (hadCustom) {
    cpSync(customDir, stash, { recursive: true, force: true })
  }

  // 整棵树重建。rmSync 遇到 junction 只删链接本身、不会顺着删进包内（已实测），
  // 所以这里不必先区分「链接还是真目录」。
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })

  // 只读的大件（scripts 36K、_config 273K）不复制，直接链回包内：升级插件时
  // node_modules 被整体换掉，链接自动跟着指向新版，用户目录里不留这 309K 的副本。
  const linked = []
  for (const dir of LINKED_DIRS) {
    const from = join(source, dir)
    if (!existsSync(from)) continue
    try {
      symlinkSync(from, join(target, dir), 'junction')
      linked.push(dir)
    } catch {
      // 跨卷（插件装在别的盘）/ 非 NTFS / 组策略禁用重解析点 —— 退回复制，功能不受影响。
      cpSync(from, join(target, dir), { recursive: true, force: true })
    }
  }

  // 真正要落盘的只有「会被改写」的配置：顶层两个 toml + 各模块目录里的 config.yaml 与 module-help.csv。
  for (const file of MUTABLE_FILES) {
    const from = join(source, file)
    if (existsSync(from)) cpSync(from, join(target, file), { force: true })
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || LINKED_DIRS.includes(entry.name)) continue
    const fromDir = join(source, entry.name)
    const toDir = join(target, entry.name)
    mkdirSync(toDir, { recursive: true })
    for (const file of readdirSync(fromDir, { withFileTypes: true })) {
      if (file.isDirectory()) continue
      cpSync(join(fromDir, file.name), join(toDir, file.name), { force: true })
    }
  }

  if (hadCustom) {
    cpSync(stash, customDir, { recursive: true, force: true })
    rmSync(stash, { recursive: true, force: true })
  } else {
    mkdirSync(customDir, { recursive: true })
  }

  const values = [
    ['user_name', (options.userName || '').trim() || 'BMad'],
    ['communication_language', (options.language || '').trim() || '简体中文'],
    ['document_output_language', (options.language || '').trim() || '简体中文'],
    ['output_folder', (options.outputFolder || '').trim() || '_bmad-output'],
  ]

  // core/config.yaml + 每个已装模块的 config.yaml 都带同一段 Core Configuration Values，
  // 外加顶层两个 toml（[core] 段）。
  const files = ['config.toml', 'config.user.toml']
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (existsSync(join(target, entry.name, 'config.yaml'))) files.push(join(entry.name, 'config.yaml'))
  }

  const touched = []
  for (const relative of files) {
    const file = join(target, relative)
    if (!existsSync(file)) continue
    if (patchConfigFile(file, values)) touched.push(relative)
  }
  const deduped = dedupeModuleKeys(join(target, 'config.toml'))
  return { materialized: true, files: touched.length, deduped, linked }
}

/**
 * 按行改写 `key: value`（yaml）或 `key = "value"`（toml）。
 * 不用 `.*` 收尾：模板在 Windows 上可能是 CRLF，`.*` 会把行尾的 \r 一起吃掉再写回去。
 */
function patchConfigFile(file, values) {
  const isToml = file.endsWith('.toml')
  const original = readFileSync(file, 'utf8')
  let text = original
  for (const [key, value] of values) {
    const pattern = isToml
      ? new RegExp(`^(\\s*${key}\\s*=\\s*)"[^"\\r\\n]*"`, 'gm')
      : new RegExp(`^(\\s*${key}\\s*:\\s*)[^\\r\\n]*`, 'gm')
    const replacement = isToml ? `$1"${value}"` : `$1${value}`
    text = text.replace(pattern, replacement)
  }
  if (text === original) return false
  writeFileSync(file, text, 'utf8')
  return true
}

/**
 * BMAD 的渲染器（`_bmad/scripts/render_skill.py`）用 `_resolve_short_config` 在整个
 * config.toml 里递归找同名键，找到两个就报
 *   ambiguous config value 'implementation_artifacts' found at:
 *     modules.gds.implementation_artifacts, modules.bmm.implementation_artifacts
 * 装了多个模块时（gds 与 bmm 都定义 planning_artifacts / implementation_artifacts /
 * project_knowledge）必然触发，skill 第一步就 HALT。
 *
 * 这里按「bmm 优先」消歧：同名键保留 bmm 那份，其它模块的那行注释掉。
 * 只动我们铺出去的数据，不动 BMAD 代码。
 */
function dedupeModuleKeys(file) {
  if (!existsSync(file)) return 0
  const raw = readFileSync(file, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)

  const sections = []
  lines.forEach((line, index) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) sections.push({ name: header[1].trim(), start: index })
  })
  if (sections.length === 0) return 0
  sections.forEach((section, index) => {
    section.end = index + 1 < sections.length ? sections[index + 1].start : lines.length
  })

  const occurrences = new Map()
  for (const section of sections) {
    if (!section.name.startsWith('modules.')) continue
    for (let i = section.start + 1; i < section.end; i += 1) {
      const match = lines[i].match(/^\s*([A-Za-z_][\w-]*)\s*=\s*\S/)
      if (match === null) continue
      const list = occurrences.get(match[1]) ?? []
      list.push({ section, line: i })
      occurrences.set(match[1], list)
    }
  }

  let changed = 0
  for (const [key, list] of occurrences) {
    if (list.length < 2) continue
    const keep = list.find((item) => item.section.name === 'modules.bmm') ?? list[0]
    for (const item of list) {
      if (item === keep) continue
      if (/^\s*#/.test(lines[item.line])) continue
      const original = lines[item.line].trim()
      lines[item.line] = `# ${original}  # 与 ${keep.section.name} 的 ${key} 重名，渲染器会报歧义，只保留后者`
      changed += 1
    }
  }
  if (changed > 0) writeFileSync(file, lines.join(eol), 'utf8')
  return changed
}
