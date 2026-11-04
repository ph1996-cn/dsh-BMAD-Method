#!/usr/bin/env node
/**
 * 同步插件内置的 BMAD 快照到上游 bmad-method 最新版。
 *
 * 判定依据三方对齐：package.json 依赖版本 / bmad-home 快照版本（manifest.yaml）/ npm latest。
 * 更新 = 升依赖 + 跑官方安装器重建 bmad-home/_bmad 与 skills/ + 重生成 skills/manifest.json + npm test。
 *
 * 用法：
 *   node scripts/sync-bmad.mjs            # 只检查（退出码 0=已最新，10=有更新）
 *   node scripts/sync-bmad.mjs --apply    # 有更新则重建快照，不发布
 *   node scripts/sync-bmad.mjs --publish  # 重建后发版（npm version patch + tag + push + publish）
 *   node scripts/sync-bmad.mjs --force    # 忽略版本检查强制重建（自检用）
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const REGISTRY = 'https://registry.npmjs.org/'
// 与现有快照一致的 7 模块；外部模块（bmb/cis/tea/gds/bmad-loop）由安装器 clone
const MODULES = 'core,bmm,bmb,cis,tea,gds,bmad-loop'
const TOOL = 'claude-code'

const SNAPSHOT = join(ROOT, 'bmad-home', '_bmad')
const SKILLS = join(ROOT, 'skills')
const PKG = join(ROOT, 'package.json')
const CLI = join(ROOT, 'node_modules', 'bmad-method', 'tools', 'installer', 'bmad-cli.js')

const flags = new Set(process.argv.slice(2))
const FORCE = flags.has('--force')
const APPLY = FORCE || flags.has('--apply') || flags.has('--publish')
const PUBLISH = flags.has('--publish')

/** 可执行文件直接跑（git / node），不经过 shell。 */
function run(file, argv, { quiet = false } = {}) {
  return execFileSync(file, argv, {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
}

/** npm 在 Windows 是 .cmd，只能经 shell 跑；参数全是常量，无注入面。 */
function npm(cmd, { quiet = false } = {}) {
  const out = execFileSync(cmd, {
    cwd: ROOT,
    shell: true,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
  return quiet ? out.trim() : ''
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const localVersion = () => readJson(PKG).dependencies['bmad-method']

function snapshotVersion() {
  const text = readFileSync(join(SNAPSHOT, '_config', 'manifest.yaml'), 'utf8')
  const m = text.match(/^installation:\s*\n\s+version:\s*(\S+)/m)
  return m ? m[1] : null
}

const latestVersion = () => npm(`npm view bmad-method version --registry ${REGISTRY}`, { quiet: true })

/**
 * 旧快照里的项目名 / 语言 / 用户名 —— 安装器只会写进探针值，必须搬回去。
 * 其余模块自定义配置项不在内：那些本来就没有覆盖需求。
 */
const CARRIED_KEYS = ['project_name', 'communication_language', 'document_output_language', 'user_name']

/**
 * 把旧快照同一个文件里的同名 key 值搬进新文件。
 * 每个文件各自取值 —— config.toml 的 [core] 与各模块 config.yaml 本来就可以不同，
 * 不能拿一个文件的值去覆盖另一个文件。
 */
function carryOver(oldFile, newFile) {
  const old = readFileSync(oldFile, 'utf8')
  let neu = readFileSync(newFile, 'utf8')
  for (const k of CARRIED_KEYS) {
    const m = old.match(new RegExp(`^\\s*${k}\\s*[:=]\\s*(.+)$`, 'm'))
    if (!m) continue
    neu = neu.replace(new RegExp(`^(\\s*${k}\\s*[:=]\\s*).*$`, 'gm'), `$1${m[1].trim()}`)
  }
  writeFileSync(newFile, neu)
}

/** skill-manifest.csv → { canonicalId: module }。description 含逗号与 "" 转义，按字段正则解析。 */
function buildManifest(csvPath) {
  const map = {}
  for (const line of readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","[^"]*","(?:[^"]|"")*","([^"]*)","[^"]*"$/)
    if (m) map[m[1]] = m[2]
  }
  return map
}

function rebuild() {
  const tmp = mkdtempSync(join(tmpdir(), 'bmad-sync-'))
  try {
    console.log(`\n[1/4] 安装器铺到临时目录：${tmp}`)
    run('node', [
      CLI,
      'install',
      '--directory',
      tmp,
      '--modules',
      MODULES,
      '--tools',
      TOOL,
      '--yes',
      '--user-name',
      'BMad',
    ])

    const tmpBmad = join(tmp, '_bmad')
    console.log('[2/4] 沿用旧快照的项目名 / 语言 / 用户名')
    const configFiles = [
      'config.toml',
      'config.user.toml',
      ...MODULES.split(',').map((m) => join(m, 'config.yaml')),
    ]
    for (const rel of configFiles) {
      const oldFile = join(SNAPSHOT, rel)
      const newFile = join(tmpBmad, rel)
      // 安装器新版本可能不产出某个文件，缺了就不搬
      if (existsSync(oldFile) && existsSync(newFile)) carryOver(oldFile, newFile)
    }

    console.log('[3/4] 覆盖 bmad-home/_bmad 与 skills/')
    rmSync(SNAPSHOT, { recursive: true, force: true })
    cpSync(tmpBmad, SNAPSHOT, { recursive: true })
    rmSync(SKILLS, { recursive: true, force: true })
    mkdirSync(SKILLS, { recursive: true })
    cpSync(join(tmp, '.claude', 'skills'), SKILLS, { recursive: true })

    const manifest = buildManifest(join(SNAPSHOT, '_config', 'skill-manifest.csv'))
    writeFileSync(join(SKILLS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`       skill 归属表：${Object.keys(manifest).length} 条`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log('[4/4] npm test')
  npm('npm test')
}

function publish(bmadVersion) {
  npm('npm version patch --no-git-tag-version')
  const version = readJson(PKG).version
  const message = `chore: 升级 BMAD-METHOD 到 ${bmadVersion}，发布 v${version}`
  console.log(`\n[发布] v${version}`)
  run('git', ['add', '-A'])
  run('git', ['commit', '-m', message])
  run('git', ['tag', `v${version}`]) // 必须 lightweight，annotated tag 会让市场匹配不到 commit
  run('git', ['push', 'origin', 'main', `v${version}`])
  npm(`npm publish --registry ${REGISTRY}`)
}

// ── main ────────────────────────────────────────────────────────────
const current = localVersion()
const snap = snapshotVersion()
const latest = latestVersion()
console.log(`package.json 依赖 : ${current}`)
console.log(`bmad-home 快照    : ${snap}`)
console.log(`npm 最新版        : ${latest}`)

if (!FORCE && current === latest && snap === latest) {
  console.log('\n✓ 已是最新，无需更新。')
  process.exit(0)
}
if (!APPLY) {
  console.log('\n! 版本不一致，加 --apply 重建快照，或 --publish 重建并发布。')
  process.exit(10)
}

if (current !== latest || FORCE) {
  console.log(`\n[升级依赖] bmad-method ${current} → ${latest}`)
  npm(`npm install bmad-method@${latest} --save-exact --registry ${REGISTRY}`)
}
rebuild()
if (PUBLISH) publish(latest)
console.log('\n✓ 完成。')
