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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包内 `bmad-home/_bmad` 的绝对路径。 */
export const TEMPLATE_ROOT = fileURLToPath(new URL('../bmad-home', import.meta.url))

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
  // custom/ 是用户自己的定制（团队共享 + 个人覆盖），模板里只有空壳 —— 拷贝前先保住它，
  // 否则补装模块时会把人家改过的 config.toml 一起抹掉。
  const customDir = join(target, 'custom')
  const stash = join(home, '.bmad-custom-stash')
  const hadCustom = existsSync(customDir)
  if (hadCustom) {
    cpSync(customDir, stash, { recursive: true, force: true })
  }
  cpSync(source, target, { recursive: true, force: true })
  if (hadCustom) {
    cpSync(stash, customDir, { recursive: true, force: true })
    rmSync(stash, { recursive: true, force: true })
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
  return { materialized: true, files: touched.length }
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
