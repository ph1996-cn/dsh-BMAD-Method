# dsh-BMAD-Method

把 [BMAD-Method](https://github.com/bmad-code-org/BMAD-METHOD) 的**模块清单、模块开关、更新**收进 dsh 的一个 bundle 插件里。

插件不重写 BMAD 的任何 agent / workflow 逻辑，只做安装器的受控桥接层：dsh 侧负责交互、状态与开关持久化，模块文件仍由官方 `bmad-method` 安装器落盘。

**BMAD 本体随插件携带**：`bmad-method` 是本插件的普通依赖。装上插件，安装器就在 `node_modules/bmad-method` 里，首次调用工具时自动把模块铺到 `$DSH_HOME/bmad-method` —— 不联网下载、不需要用户配任何路径。要换 BMAD 版本，在本仓库 `npm run update-bmad` 后发新版本，用户更新插件即完成更新。

## 五条设计约定

| 要求 | 实现 |
| --- | --- |
| 封装全部模块 | 清单 = 官方注册表（`bmad-modules.yaml`）**+ 内置 `core` / `bmm`**；`bmad_update()` 默认一次装齐未废弃的全部模块 |
| 工作区自动有 `_bmad-output` | 任一工具调用都会在工作区建 `_bmad-output`（安装器 `--output-folder` 的默认值） |
| 插件内开关模块 | `bmad_module_toggle` 在 profile 补丁里写 / 去 `disabled: true`，模块文件一个都不动 |
| 自定义用户名与语言 | `userName` / `language` 两个设置项（也可作工具参数传）；语言默认简体中文 |
| 工作区不落 `_bmad` / `.agent` | 模块装在全局主目录 `$DSH_HOME/bmad-method`，所有工作区共用；工作区只多一个 `_bmad-output` |

## 安装

从 GitHub 装（把 `ph1996-cn` 换成你的 GitHub 用户名 / 组织名）：

```bash
dsh plugin add github:ph1996-cn/dsh-BMAD-Method
```

> 仓库里**没有任何本机绝对路径**：BMAD 主目录从 `$DSH_HOME`（缺省 `~/.dsh`）推导，profile 补丁靠扫 `~/.dsh/profiles/*/` 里 `dsh.profile.bundles` 认领本插件的那个，补丁路径可用 `patchPath` 配置覆盖。发布前只需把下面几处的 `ph1996-cn` 换成自己的账号。

或在 dsh 里让 agent 调 `plugin_manager`：

```
plugin_manager({ action: "install_bundle", target: "github:ph1996-cn/dsh-BMAD-Method" })
```

也可以钉到某个 tag / commit（可复现）：

```
plugin_manager({ action: "install_bundle", target: "github:ph1996-cn/dsh-BMAD-Method#v0.1.0" })
```

开发调试用本地目录：

```bash
git clone https://github.com/ph1996-cn/dsh-BMAD-Method.git
dsh plugin add ./dsh-BMAD-Method
```

装完会把 bundle 记进当前 profile 的 `package.json`：

```jsonc
"dsh-BMAD-Method": "github:ph1996-cn/dsh-BMAD-Method",   // dependencies
"dsh": { "profile": { "bundles": [ ..., "dsh-BMAD-Method" ] } }
```

控制面行由包自带的 `cordis.patch.yml` 提供，不需要手写进 profile 补丁。**装完重启 dsh**，三个工具才会出现。

> 包名带大写字母，因此**不能发到 npm registry**（npm 只收小写名）；GitHub 安装不受此限制。要同时发 npm 就把 `package.json` 的 `name` 改成小写 `dsh-bmad-method`，`index.js` 的 `export const name` 与 `cordis.patch.yml` 里的 `name:` 跟着改。

## 设置界面

插件导出 `Config`（Schemastery），dsh 会把它投影成 JSON Schema 并渲染成插件详情页里的「BMAD 设置」卡片 —— 不需要写客户端代码。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `userName` | 空 | 写进 BMAD 核心配置的用户名（留空用系统用户名） |
| `language` | `简体中文` | 沟通 + 文档输出语言 |
| `outputFolder` | `_bmad-output` | 工作区输出目录名 |

只有这三项。BMAD 装在哪、补丁文件在哪，都由插件自己管，不需要你填。

### 卡片下半部分是模块开关

同一张卡片里，三个输入框下面就是**每个模块一行 + 一个开关**：显示模块名（`BMAD Test Architect`）、版本、描述、当前状态。勾上 = 参与 dsh，关掉 = 不参与。

它写的是和工具、和 dsh 插件开关**同一份** profile 补丁（`disabled: true`），不是第二份状态。

> 为什么不直接点插件页「包含的组件」里的开关？因为 dsh 的行标题取自**包名**（`resolveText(row.meta.title)`，而 `row.meta` 来自 `packages.metaOf(row.name)`），同一个包的多行标题必然一样，7 行全叫 `dsh-BMAD-Method`，分不出谁是谁。那 7 行开关照样能用（状态是同一份），只是没法认人。

浏览器半端调不了工具，所以插件自己开了一条同源接口：

```
GET  /api/bmad-method/modules          → 模块列表 + 当前 enabled
POST /api/bmad-method/toggle           → { module, enabled }，写补丁后立即回读返回新状态
```

只接受本机同源请求（校验 `Origin` 与 `Host` 一致），跨站来源返回 403。

改完保存后**重启 dsh** 生效（插件配置与补丁都在 profile 启动时读取）。工具参数优先级高于这里的配置（例如 `bmad_update` 传了 `userName` 就用参数值）。

设置页看不到这张卡片时，按顺序查：① profile 的 `package.json` 里 `dsh.profile.bundles` 有 `dsh-BMAD-Method`；② 插件是启用状态（`plugin_manager` 列表里非 disabled）；③ 全新加载过插件（改过 `index.js` 后 `set_bundle(false)` → `set_bundle(true)`）；④ 刷新浏览器页面。

## 三个工具

| 工具 | 必填参数 | 作用 |
| --- | --- | --- |
| `bmad_modules_list` | 无 | 列出全部模块：已装（读 `_bmad/`）+ 可装（读官方 `bmad-modules.yaml`），含 `installed` / `enabled` / `version` / `type` |
| `bmad_module_toggle` | `module`、`enabled` | 开关某模块：在 profile 补丁里写 / 去 `disabled: true`。**不动文件、不装卸** |
| `bmad_update` | 无 | 调用 BMAD 安装器把模块装齐 / 更新，完成后自动刷新列表 |

可选参数：

- `projectRoot`：覆盖自动探测的安装位置
- `registryPath`：覆盖模块注册表
- `bmad_update`：`userName` / `language` / `modules` / `action` / `channel` / `dryRun`

```jsonc
// 列出全部模块与状态
{}
// 停用 tea（只让它不参与 dsh，文件一个不删）
{ "module": "tea", "enabled": false }
// 装齐全部模块，用户名与语言一起写进去
{ "userName": "张伟", "language": "简体中文" }
// 先看命令，不执行
{ "userName": "张伟", "dryRun": true }
```

`bmad_update` 实际执行的命令（实测 6.12.4 通过）：

```
node <插件目录>/node_modules/bmad-method/tools/installer/bmad-cli.js install \
  --directory <全局主目录> --action update --yes \
  --modules bmb,cis,tea,bmad-loop,gds,core,bmm --tools claude-code --no-shims \
  --user-name 张伟 --output-folder _bmad-output \
  --communication-language 简体中文 --document-output-language 简体中文
```

安装器用的是**插件依赖里自带的那份**（不联网拉 `bmad-method@latest`），所以能离线跑。
`action` 只接受 `update` / `quick-update`（安装器不接受 `install`：`Invalid action: install. Valid actions: quick-update, update`）。

关于 `--tools claude-code`：安装器的非交互模式（`--yes`）**强制**要求至少一个 IDE 标识，取值表里没有 dsh。它决定安装器把 skill 铺到哪个目录（这里是 `.claude/skills`）。

两个容易误会的点：

- `--no-shims` 管的是「**已弃用模块的兼容 shim skill**」，跟铺不铺 IDE 文件无关（`commands/install.js:37-38` 原文）。加了它照样会铺 `.claude/skills`。
- 安装器把 skill 正文**只**写进 IDE 目录，`_bmad/` 里只有 config 和脚本（`installer.js:141` 注释：*Skills are now in IDE directories — remove redundant copies from `_bmad/`*）。

本插件的做法：这 90 个 skill 直接**随插件包发行**（`skills/`，见下一节），安装器铺出来的 `.claude/skills` 是重复品，装完就删掉——用户机器上不会多出任何 IDE 目录。

## BMAD 的 90 个 skill 在哪

```
<插件安装目录>/skills/        ← 随包发行，不进用户目录
├─ manifest.json                    ← 归属表：skill 名 → 所属模块（90 条）
├─ bmad-agent-analyst/SKILL.md       ← 57 个 bmad-*：core 8 / bmm 21 / bmb 5 / cis 10 / tea 10 / bmad-loop 3
├─ gds-agent-game-architect/SKILL.md ← 33 个 gds-*：gds 模块（Game Dev Studio 用自己的前缀）
└─ …（brainstorming / prd / spec / review / retrospective / ux / party-mode / testarch / cis-* 等）
```

这些 skill 就是 BMAD 的全部能力（agent 人格 + 工作流正文）。插件通过 dsh 原生的 **SkillProvider**（`ctx.skills.registerProvider`）把它们注册给 dsh，做法和 `@wenaixi/dsh-ponytail` 一样：

- 用户装完插件就自带 90 个 skill，**不需要联网、不需要预装 BMAD、也不往 `$DSH_HOME/skills` 写任何东西**；
- 插件升级 → skill 跟着升级（更新插件即更新 BMAD）；
- 读取时把正文里的 `{project-root}/_bmad/` 动态替换成全局主目录的绝对路径（`{project-root}/_bmad-output` 保持不变，仍指向你的工作区），所以 skill 里的脚本调用能命中真实的 `_bmad/scripts`。

验证：

```powershell
# 包内自带（发布后用户机器上就是这样）
(Get-ChildItem "<插件安装目录>\skills" -Directory | Where-Object { $_.Name -match '^(bmad|gds)-' }).Count   # 90

# 用户目录应当是 0 —— skill 不该落在这里
Get-ChildItem "$env:USERPROFILE\.dsh\skills" -Directory -Filter 'bmad*' | Measure-Object
```

用法举例（描述匹配就会触发）：

| 你说 | 触发 |
| --- | --- |
| 「用 Mary 帮我做需求分析」 | `bmad-agent-analyst` |
| 「帮我 brainstorm 一下」 | `bmad-brainstorming` |
| 「写个 PRD」 | `bmad-prd` |
| 「跑一下 code review」 | `bmad-code-review` |
| 「跑一次回顾」 | `bmad-retrospective` |

模块开关管一件事：**这个模块的 skill 参不参与 dsh**。停用某模块后（立即生效）：它的 skill 不再出现在 skill 清单里——归属优先读包内的 `skills/manifest.json`，本机装了模块再用 `_bmad/_config/skill-manifest.csv` 覆盖，`core` 的 8 个永远可用。skill 本身随插件包携带，不会被删。

## 模块清单：全部模块

官方注册表只登记外部模块，`core`（BMAD Core）与 `bmm`（BMad Method 本体）是安装器内置的，代码里补齐后一并列出，`type: builtin`。

`core` 是地基：`bmad_module_toggle` 对它返回 `not-toggleable`，包内补丁也不给它开行（跟着 `bmm` 一起加载）。`deprecated: true` 的模块（`automator`、`wds`）仍会列出，但安装时会被跳过。

**外部模块需要能访问 GitHub**（安装器用 `git clone` 拉各模块仓库）。网络不通时整次安装会失败，此时插件自动退到内置模块 `bmm` 重试一次，保证 BMAD 至少能用；网络恢复后再跑一次 `bmad_update` 即可补齐。

## 模块开关是怎么生效的

**一个 bundle 只挂一个实例**（包内 `cordis.patch.yml` 只有控制面一行），所以插件页「包含的组件」里只有它一个。模块开关在插件详情页的「BMAD 设置」卡片里，每个模块一行：

```
BMad Method          bmm · 6.12.4      启用  [●]
BMad Test Architect  tea · v1.27.2     启用  [●]
BMAD Core            core · 6.12.4     地基  [──]   ← 不参与开关
```

开关状态**只存在 profile 的 `cordis.patch.yml`** 里，形状和 dsh 自己的开关完全一样（顶格覆盖条目）：

```yaml
- id: bmad-module-tea
  disabled: true
```

没有这一条 = 启用。卡片里的开关、`bmad_module_toggle` 工具写的是**同一份**状态：

- 卡片点开关 → `POST /api/bmad-method/toggle` → 插件按行写/删这条覆盖条目（启用时整条删掉，回到默认）。
- 调 `bmad_module_toggle` → 同一个函数，行为一致。
- **停用后真正发生的事**：该模块名下的 skill 立刻不再出现在 dsh 的 skill 清单里（归属来自包内 `skills/manifest.json`，本机装了再用 `_bmad/_config/skill-manifest.csv` 覆盖）。停用 `bmm`，21 个 `bmad-*` skill 一起消失；`core` 的 8 个永远在。这就是"模块没参与加载"的可观测证据，比提示词里的一句说明更硬。
- **模块文件一个都不删**：`_bmad/bmm/` 原样躺在磁盘上，重新打开开关就恢复。
- **不用重启**：skill 清单每次构建都是现读补丁算出来的；写完补丁插件还会调一次 provider 的 `control.invalidate()` 让宿主立刻重扫，所以当轮就能看到变化。

### 写入安全

- `cordis.patch.yml` 一律**按行定点编辑**，不做 YAML 往返序列化 —— 你自己写的注释和条目原样保留（有测试守着）。
- 写盘走「临时文件 + rename」，写完立刻回读校验；校验失败把原内容写回并返回 `write-failed`，不会出现"界面说已停用、文件没变"。
- 工具**不缓存内存态**，`enabled` 每次从补丁文件现读。

## 路径与全局安装

BMAD 装在**全局主目录**，工作区不落 `_bmad/`。这些路径都由插件自己推断，不暴露成设置项：

| 位置 | 取值顺序 |
| --- | --- |
| 全局主目录 | 环境变量 `DSH_BMAD_HOME` → `$DSH_HOME/bmad-method`（无 `DSH_HOME` 时 `~/.dsh/bmad-method`） |
| 实际安装位置 | 显式 `projectRoot`（其下有 `_bmad/`）→ 全局主目录有 `_bmad/` → 从会话工作目录向上找 `_bmad/` |
| profile 补丁 | `DSH_BMAD_PATCH_PATH` → `DSH_PROFILE_DIR/cordis.patch.yml` → `DSH_HOME/profiles/<DSH_PROFILE>/cordis.patch.yml` |
| 安装器 | 插件依赖 `node_modules/bmad-method` → 项目内 / 全局 `bmad-method` → `npx` 兜底 |
| 注册表 | 插件依赖里的 `bmad-modules.yaml` → 项目内 `bmad-method` → 插件内置快照 |
| 工作区输出目录 | `<工作区>/_bmad-output`，每次调用自动创建 |

老项目里已经有 `_bmad/` 也照用（`projectRoot` 或自动探测命中即按项目内安装处理，返回里 `global: false`）。

## 零配置自举

**装完插件什么都不用做**。第一次调用任一 BMAD 工具时，插件会检查 `$DSH_HOME/bmad-method/_bmad/`：

- 不存在 → 用插件**自带的**安装器把**全部 7 个未废弃模块**（`core` `bmm` `bmb` `cis` `tea` `gds` `bmad-loop`）装齐，首次约 66 秒（外部模块要 `git clone`）。
- 已存在但版本与本插件携带的 `bmad-method` 不一致 → 自动刷新到同版本（等于"更新插件就更新了 BMAD"）。
- 已存在但缺了某个模块的 `_bmad/<code>/` → 补装一次（包内 skill 覆盖全部 7 个模块，缺配置会让对应 skill 读不到模块级配置）。
- 全齐且版本一致 → 直接跳过，零开销（实测 0.1 秒）。

外部模块的 `git clone` 失败（没网 / GitHub 不通）时自动降级为内置的 `core + bmm` 重试，`_bmad` 里少几个模块目录，但 **90 个 skill 仍在插件包里、照常可用**；网络恢复后跑一次 `bmad_update` 就补齐。

```jsonc
// 单独再跑一次全量安装（已齐时也可用来刷新）
{ "dryRun": true, "userName": "张伟" }   // 先看命令
{ "userName": "张伟", "language": "简体中文" }

实测（v6.12.4，空目录 + 全局 `--directory`）：

- 工作区**完全干净**，只多出 `_bmad-output`；没有 `_bmad/`、`.agent/`。安装器会铺 `.claude/skills`，插件把它清掉——skill 由插件包内的 provider 提供，不落任何用户目录。
- 模块文件落在 `--directory` 下，`_bmad-output` 也落在 `--directory` 下（工作区那个是插件建的）。
- 非交互首次安装必须给 `--tools`，插件默认 `claude-code`（或沿用 `manifest.ides`）；取值表里没有 dsh，它只决定安装器往哪个目录铺 skill，铺完即迁走并清理。
- 外部模块靠 `git clone`，网络不通时整次安装失败 → 自动退到内置 `bmm` 重试，保证能用。
- 不传 `userName` / `language` 时，安装器**保留已存配置**，不会覆盖。

## 怎么验证开关写对了

```bash
# 看模块覆盖条目（Windows PowerShell）
Get-Content "$env:DSH_PROFILE_DIR\cordis.patch.yml" | Select-String -Context 0,2 "bmad-module-tea"
```

判据：

1. 停用后文件里有 `- id: bmad-module-tea` 且下一行是 `  disabled: true`；
2. 启用后**整条消失**（回到 bundle 默认值），文件里不再出现 `bmad-module-tea`；
3. `bmad_modules_list` 返回里 `modules[].enabled` 与文件一致，`patchPath` 就是你改的那个文件；
4. 不用重启：点完开关，下一次会话的 skill 清单里对应模块的 skill 就已经不见了，`_bmad/` 里的文件一个不少。

## 更新

**更新 BMAD = 更新插件。** 在插件仓库里：

```bash
npm run update-bmad     # = npm install bmad-method@latest --save-exact
npm test                # 顺手验一遍
```

发新版本后，用户更新插件，下次调用工具时 `ensureInstalled` 发现版本不一致，自动把全局那份刷到同版本（`_bmad/core/config.yaml` 里的用户名/语言保留，安装器不覆盖已存配置）。

需要手动强制刷新时，跑 `bmad_update`（先 `dryRun: true` 看命令）即可。

插件自身走 dsh bundle 常规路径（`plugin_manager` 升级或 `npm update dsh-BMAD-Method`）。`package.json` 声明 `engines.dsh`（`>=0.2.0-rc.1 <0.3.0`）与 `engines.node`，装到不兼容的 dsh 上会被版本闸门拦下。

### 更新插件本身：一条命令，不用卸载重装

dsh 的 `install_bundle` 对已装的包会直接返回 `already-installed` 拒绝掉，**没有"更新"这个动作**。改代码后要么卸载重装，要么绕过去直接更新依赖 —— 后者一条命令：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm update dsh-BMAD-Method      # 重新解析 github: 依赖，拿最新 commit
```

然后重启 dsh。（`pnpm add dsh-BMAD-Method@github:...` 不行 —— spec 没变，pnpm 按 lockfile 里的旧 commit 装，会静默什么都不干。）

如果只是想边改边试，用开发模式更省事：

```powershell
# 装本地目录而不是 GitHub 版本
dsh plugin add D:\path\to\dsh-BMAD-Method     # 或 plugin_manager install_bundle(target=<目录>)
```

link 安装下改完代码只需重启 dsh，不用重新装包。

## 目录结构

```
cordis.patch.yml         # bundle 补丁：只插控制面行
index.js                 # apply(ctx, config)：注册三个工具 / 注入模块上下文 / 注册 skill provider
lib/patch.js             # cordis.patch.yml 按行编辑 + 原子写 + 回读校验 + 回滚
lib/bmad.js              # _bmad/ 发现、全局主目录、自举、注册表、命令组装、安装器调用
lib/skills.js            # SkillProvider：从包内 skills/ 提供 90 个 skill
skills/                  # 90 个 skill（57 bmad-* + 33 gds-*）+ manifest.json 归属表
lib/registry/            # bmad-modules.yaml 内置快照（依赖没落地时的离线兜底）
fixtures/                # 冒烟测试用的 _bmad/ 项目与补丁文件
test/                    # node --test
```

## 测试

```bash
npm test        # node --test，12 个用例
```

覆盖：工具注册、模块发现（已安装 + 可安装 + 内置 `core`/`bmm` + `deprecated`）、停用写 `disabled: true`、重复停用幂等、列表反映状态、重新启用移除该键、用户注释与既有条目不被破坏、`core` 不可停用、未装模块拒绝停用、写盘失败返回 `write-failed` 且原文件不变、更新命令组装（`--user-name` / 两个「简体中文」/`--output-folder _bmad-output`/`--no-shims`/`--modules` 含全部未废弃模块）、全局安装时工作区只有 `_bmad-output` 而无 `_bmad`/`.agent`、模块行的提示词注入、**全新环境自动自举**（用自带安装器装好、不留 `.claude`）、**模块停用后它的 skill 不再列出而 `core` 的仍在**、Config 三个字段全部 `.volatile()`。

端到端实测通过：全新 `DSH_HOME` 下第一次调 `bmad_modules_list` 自动把 7 个模块装齐（实测 66 秒）、`.claude/skills` 被清掉、`core/config.yaml` 写入 `user_name: 张伟` 与 `简体中文`、工作区只有 `["_bmad-output"]`、provider 列出 90 个 skill；第二次调用版本一致直接跳过（0.1 秒）。测试里用 `DSH_BMAD_MINIMAL=1` 只装内置模块，保持离线可跑。

## 已知边界

- 模块文件由插件依赖里的 `bmad-method` 安装器铺到全局主目录，**不需要联网下载 bmad-method 本体**；但外部模块（bmb/cis/tea/gds/bmad-loop）仍要 `git clone`，需要能访问 GitHub，装过一次后就在本地（失败会自动降级为内置模块，skill 仍可用）。
- **模块开关是热生效的**：只改 profile 补丁 + 调一次 provider `invalidate()`，不重启、不重装。它唯一影响的是「这个模块的 skill 参不参与 dsh」——`_bmad/` 里的模块文件、包内的 skill 文件都不动，随时可以开回来。也不影响安装器行为：`bmad_update` 仍会按注册表把全部模块装齐（装齐 ≠ 全启用）。
- 唯一要重启的场景是**插件自身代码或包内补丁变了**（装新版本、改 `cordis.patch.yml`）——那属于 profile 启动时读取的部分。
- 注册表跟着 `bmad-method` 依赖走；上游新增模块时 `npm run update-bmad` 升级依赖即可，内置快照只是兜底。
- 包内 90 个 skill 是安装时的快照：上游模块出新版 skill 时，`npm run update-bmad` 只会刷新安装器，**skill 正文要重新从安装产物里拷一遍**（`_bmad-full/.claude/skills` → `skills/`，并重生成 `skills/manifest.json`）。
- **模块开关的边界**：开关只控制「这个模块的 skill 参不参与 dsh」——停用后立即生效，该模块名下的 skill 从清单里消失（归属优先包内 `skills/manifest.json`，本机装了再用 `_bmad/_config/skill-manifest.csv` 覆盖；`core` 的 8 个永远可用）。`_bmad/` 里的模块文件、包内的 skill 文件都不动，随时可以开回来。它不影响安装器行为：`bmad_update` 仍会按注册表把全部模块装齐（装齐 ≠ 全启用）。
- **插件页「包含的组件」只有一行**：一个 bundle 挂一个实例。早期版本给每个模块开一行想让插件页带开关，但 dsh 的行标题只能取包名，7 行会全叫 `dsh-BMAD-Method`，反而更乱——现在开关在设置卡片里。
