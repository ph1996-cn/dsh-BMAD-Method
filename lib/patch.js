/**
 * profile 的 cordis.patch.yml 编辑器。
 *
 * 为什么是「按行编辑」而不是 YAML 往返序列化：
 * 用户的 profile 补丁里全是手写注释与自定义缩进，整文件重写会把它们全部丢掉。
 * 这里只做一件事——给某个模块行写/删 `disabled`，其余字节原样保留。
 *
 * 状态形状与 dsh 插件管理器的开关完全一致（顶格覆盖条目，2 空格缩进）：
 *
 *   - id: bmad-module-bmm
 *     disabled: true
 *
 * 没有这一条 = 用 bundle 默认值（启用）。模块行本身写在包内 cordis.patch.yml 里，
 * 所以「包含的组件」列表里每个模块都有一行、各带一个 dsh 原生开关。
 */

import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MODULE_ID_PREFIX = 'bmad-module-'
/** 受管行的插件名，必须等于本包 package.json 的 name。 */
export const SELF_NAME = 'dsh-BMAD-Method'

/** 模块 code 会被写进 YAML，严格校验，避免拼出非法文档。 */
export function assertSafeCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new Error(`非法的 BMAD 模块 code：${JSON.stringify(code)}（只允许字母数字与 . _ -）`)
  }
  return code
}

export function moduleRowId(code) {
  return MODULE_ID_PREFIX + assertSafeCode(code)
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * 在 ~/.dsh/profiles/* 里找真正挂着本插件的那个 profile。
 *
 * 为什么需要这一步：dsh 宿主进程不继承 shell 里的 DSH_PROFILE_DIR / DSH_HOME，
 * 只靠环境变量会在运行期解析成 null（卡片上就会显示"没有解析到 profile 的 cordis.patch.yml"）。
 * 判据是 profile package.json 的 dsh.profile.bundles 里有本包名；多个命中取最近修改的。
 */
function findOwnProfile() {
  const root = join(dshHome(), 'profiles')
  if (!existsSync(root)) return null
  const hits = []
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    const patch = join(dir, 'cordis.patch.yml')
    if (!existsSync(patch)) continue
    let owns = false
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      owns = (pkg?.dsh?.profile?.bundles ?? []).includes(SELF_NAME)
    } catch {
      owns = false
    }
    if (owns) hits.push({ patch, mtime: statSync(patch).mtimeMs })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.mtime - a.mtime)
  return hits[0].patch
}

/** 解析 profile 补丁路径：显式配置 > 环境变量 > 扫 profiles 找挂着本插件的那个。 */
export function resolvePatchPath(config = {}) {
  const configured = typeof config.patchPath === 'string' ? config.patchPath.trim() : ''
  if (configured) return configured
  if (process.env.DSH_BMAD_PATCH_PATH) return process.env.DSH_BMAD_PATCH_PATH
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir && existsSync(join(profileDir, 'cordis.patch.yml'))) {
    return join(profileDir, 'cordis.patch.yml')
  }
  const guessed = join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop', 'cordis.patch.yml')
  if (existsSync(guessed)) return guessed
  return findOwnProfile()
}

const EMPTY_PATCH = [
  '# Your patch layer for this dsh profile, applied after every bundle layer.',
  '',
  '',
].join('\n')

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n')
}

// 两种形状都要认：dsh 开关写的顶格覆盖条目，和 bundle 补丁 insert 组里的 4 空格行。
const HEADER = /^\s*- id:\s*(\S+)\s*$/
const DISABLED = /^\s+disabled:\s*(true|false)\s*$/
const OTHER_KEY = /^\s{2,}(?!disabled:)[A-Za-z_][\w-]*:/

/**
 * 补丁里的模块条目：[{ id, code, disabled, start, end }]（end 为行区间右开边界）。
 * 顶格覆盖条目（dsh 开关写的）与 insert 组里缩进的行都算。
 */
export function moduleRows(text) {
  const lines = normalizeNewlines(text ?? '').split('\n')
  const rows = []
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i])
    if (!m || !m[1].startsWith(MODULE_ID_PREFIX)) continue
    let end = i + 1
    while (end < lines.length && !HEADER.test(lines[end])) end++
    // 去掉条目尾部的空行，让 end 停在最后一行有内容的下一行
    while (end - 1 > i && lines[end - 1].trim() === '') end--
    rows.push({ id: m[1], code: m[1].slice(MODULE_ID_PREFIX.length), disabled: false, start: i, end })
  }
  for (const row of rows) {
    for (let i = row.start; i < row.end; i++) {
      const d = DISABLED.exec(lines[i])
      if (d) row.disabled = d[1] === 'true'
    }
  }
  return rows
}

/** 模块当前是否启用：没有覆盖条目 = 启用（用 bundle 默认值）。 */
export function isModuleEnabled(text, code) {
  const row = moduleRows(text).find((r) => r.code === code)
  return row ? !row.disabled : true
}

/**
 * 纯函数：把某个模块置为 enabled/disabled。
 * 启用 = 删掉覆盖条目（回到 bundle 默认）；停用 = 写一条 `- id: …\n  disabled: true`。
 * 条目里还有别的字段（用户自己加的 config 之类）时，不删整条，只把 disabled 改成 false。
 */
export function setModuleRow(text, code, enabled) {
  const id = moduleRowId(code)
  const lines = normalizeNewlines(text ?? EMPTY_PATCH).split('\n')
  const row = moduleRows(lines.join('\n')).find((r) => r.code === code)

  if (!row) {
    if (enabled) return lines.join('\n')
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push(`- id: ${id}`, '  disabled: true', '')
    return lines.join('\n')
  }

  if (row.disabled === !enabled) return lines.join('\n')

  if (enabled) {
    // 只有 id / disabled 两个键 → 整条删掉；否则只改值，保留用户自己的字段
    let ownKeys = false
    for (let i = row.start + 1; i < row.end; i++) if (OTHER_KEY.test(lines[i])) ownKeys = true
    if (ownKeys) {
      for (let i = row.start + 1; i < row.end; i++) {
        if (DISABLED.test(lines[i])) {
          lines[i] = '  disabled: false'
          break
        }
      }
    } else {
      lines.splice(row.start, row.end - row.start)
    }
    return lines.join('\n')
  }

  // 停用：已有 disabled 行就改值，没有就补一行
  for (let i = row.start + 1; i < row.end; i++) {
    if (DISABLED.test(lines[i])) {
      lines[i] = '  disabled: true'
      return lines.join('\n')
    }
  }
  lines.splice(row.end, 0, '  disabled: true')
  return lines.join('\n')
}

function readOrEmpty(path) {
  if (!existsSync(path)) return EMPTY_PATCH
  return readFileSync(path, 'utf8')
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, path)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件清理失败不影响主错误 */
    }
    throw error
  }
}

/**
 * 读改写 + 校验 + 失败回滚。
 * mutate(text) 返回新文本；写盘后重新读回校验 verify(text) 为真，否则恢复原文件并抛错。
 * 任何异常都不会留下「界面说改了、文件没改」的中间态。
 */
export function editPatch(patchPath, mutate, verify) {
  const before = readOrEmpty(patchPath)
  const after = mutate(before)
  if (after === before) return { text: after, changed: false }

  let wrote = false
  try {
    writeAtomic(patchPath, after)
    wrote = true
    const reread = readFileSync(patchPath, 'utf8')
    if (verify && !verify(reread)) {
      throw new Error('写入后校验不通过（文件内容与预期不符）')
    }
    return { text: reread, changed: true }
  } catch (error) {
    if (wrote) {
      try {
        writeAtomic(patchPath, before)
      } catch {
        /* 回滚也失败时，错误信息里带出路径让用户手动修 */
      }
    }
    const hint = `无法更新 profile 补丁：${patchPath}（${error?.message ?? error}）`
    throw new Error(hint)
  }
}
