/**
 * BMAD skill 提供者：把插件包内 skills/bmad-* 作为 dsh 原生 skill 暴露。
 *
 * 为什么不写进 $DSH_HOME/skills：那是**用户本机**的目录，插件一旦发布，
 * 别人的机器上不会有这些文件。skill 正文必须随插件包走（npm 包里的 skills/）。
 *
 * 唯一的运行时改写：BMAD 的 SKILL.md 里用 {project-root}/_bmad/... 指自己的
 * 安装目录，而这套东西在 dsh 里装在全局主目录，所以下发正文时把这一串换成
 * 本机绝对路径 —— 模型拿到就能直接执行，不用猜。
 * {project-root}/_bmad-output 是另一回事（用户的输出目录），原样保留。
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

/** 插件包自带的 skill 目录（29 个 bmad-*）。 */
export function bundledSkillsDir() {
  return fileURLToPath(new URL('../skills', import.meta.url))
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RANK = 500
/** provider 标识：宿主按它认领候选，candidate.provider 必须与之一字不差。 */
export const DEFAULT_PROVIDER = 'bmad'

/** 拆 frontmatter 与正文；格式不对返回 undefined（当作不可加载）。 */
function splitFrontmatter(raw) {
  const clean = raw.replace(/^\uFEFF/, '')
  const lines = clean.split('\n')
  if (lines[0]?.replace(/\r$/, '').trimEnd() !== '---') return undefined
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '').trimEnd() !== '---') continue
    try {
      // 行尾的 \r 必须去掉：yaml 会把 CRLF 文件里行末的 \r 当成标量内容，长 description 直接解析失败
      const header = lines.slice(1, i).map((line) => line.replace(/\r$/, '')).join('\n')
      const data = parse(header)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
      return { data, body: lines.slice(i + 1).join('\n') }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 把正文里的 {project-root}/_bmad/ 换成本机绝对路径（_bmad-output 不受影响）。 */
export function rewriteBody(body, bmadHome) {
  if (!bmadHome) return body
  const prefix = String(bmadHome).replace(/\\/g, '/').replace(/\/+$/, '')
  if (!prefix) return body
  return body.split('{project-root}/_bmad/').join(`${prefix}/_bmad/`)
}

export class BmadSkillProvider {
  constructor(ctx, control, options) {
    this.ctx = ctx
    this.control = control
    // 宿主按 provider.name 认领候选，candidate.provider 必须与它一字不差
    this.name = options.providerName ?? DEFAULT_PROVIDER
    this.skillDir = options.skillDir
    this.getBmadHome = options.getBmadHome
    this.getDisabledModules = options.getDisabledModules
  }

  /** 通知宿主重扫（配置变了、BMAD 刚装好时用）。 */
  invalidate() {
    try {
      this.control?.invalidate()
    } catch {
      // 宿主没有该能力时静默
    }
  }

  /**
   * skill → 模块归属。取自安装产物的 _bmad/_config/skill-manifest.csv
   * （列：canonicalId,name,description,module,path）。
   * 拿不到就返回空表 —— 此时不做模块过滤，宁可多给也不误杀。
   */
  async #moduleOf() {
    const table = new Map()
    // ① 包内自带归属表（skills/manifest.json，随 skill 一起发行）：
    //    用户机器上只装了 core+bmm 时，gds-* 这些没有 CSV 登记的 skill 也能正确归属。
    try {
      const raw = await readFile(join(this.skillDir, 'manifest.json'), 'utf8')
      for (const [name, module] of Object.entries(JSON.parse(raw))) table.set(name, module)
    } catch {
      /* 没有自带表就靠下面的安装清单 */
    }
    // ② 用户环境的安装清单覆盖它（装了别的版本模块时以本机的为准）
    const home = this.getBmadHome?.() ?? ''
    if (!home) return table
    try {
      const csv = await readFile(join(home, '_bmad', '_config', 'skill-manifest.csv'), 'utf8')
      const rows = csv.split('\n').slice(1)
      for (const row of rows) {
        if (!row.trim()) continue
        // 字段里带逗号（description），只能按字段边界 `","` 拆
        const cols = row.trim().split('","')
        const name = cols[1]?.replace(/^"|"$/g, '').trim()
        const module = cols[3]?.replace(/^"|"$/g, '').trim()
        if (name && module) table.set(name, module)
      }
    } catch {
      /* 没装清单就只用包内的 */
    }
    return table
  }

  async list(options = {}) {
    options.signal?.throwIfAborted()
    let entries
    try {
      entries = await readdir(this.skillDir, { withFileTypes: true })
    } catch (error) {
      // 包内目录缺失说明打包漏了 skills/：明确报「不完整」，别缓存成空目录
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        this.ctx?.logger?.warn?.(`[bmad] 未找到 skill 目录：${this.skillDir}`)
        return { candidates: [], complete: false }
      }
      throw error
    }

    const moduleOf = await this.#moduleOf()
    const disabled = this.getDisabledModules?.() ?? null
    const candidates = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      options.signal?.throwIfAborted()
      if (!entry.isDirectory()) continue
      const owner = moduleOf.get(entry.name)
      // 归属表（skill-manifest.csv）是权威清单：gds 的 33 个 skill 用 gds-* 前缀，只认 bmad- 会漏。
      // 表拿不到时才退回「bmad-* 前缀扫描」。
      if (moduleOf.size > 0 ? owner === undefined : !entry.name.startsWith('bmad-')) continue
      // 补丁里标了 disabled: true 的模块 → 它的 skill 不再列出（没登记 = 启用，core 永远可用）
      if (disabled && owner && owner !== 'core' && disabled.has(owner)) continue
      const skillPath = join(this.skillDir, entry.name, 'SKILL.md')
      const parsed = await this.#read(skillPath, options.signal)
      if (!parsed) continue
      const name = typeof parsed.data.name === 'string' ? parsed.data.name : entry.name
      const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
      if (!description || !SKILL_NAME_RE.test(name)) {
        this.ctx?.logger?.warn?.(`[bmad] 跳过 ${skillPath}：frontmatter 缺 name/description`)
        continue
      }
      candidates.push({
        name,
        description,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: this.name,
        resourceBase: { kind: 'directory', path: dirname(skillPath) },
        path: skillPath,
        rank: RANK,
        locator: { path: skillPath, directory: dirname(skillPath) },
      })
    }
    return { candidates, complete: true }
  }

  async get(candidate, options = {}) {
    options.signal?.throwIfAborted()
    const skillPath = candidate?.locator?.path ?? candidate?.path
    if (!skillPath) return undefined
    const parsed = await this.#read(skillPath, options.signal)
    if (!parsed) return undefined
    return {
      ...candidate,
      content: rewriteBody(parsed.body.trim(), this.getBmadHome?.() ?? ''),
    }
  }

  async #read(skillPath, signal) {
    try {
      return splitFrontmatter(await readFile(skillPath, { encoding: 'utf8', signal }))
    } catch (error) {
      if (signal?.aborted) throw error
      return undefined
    }
  }
}
