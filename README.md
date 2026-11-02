# dsh-BMAD-Method

把 [BMAD-Method](https://github.com/bmad-code-org/BMAD-METHOD) 整套装进 dsh 里。装完插件就能用，不用自己跑 `npx bmad-method install`。

![兼容 dsh](https://img.shields.io/badge/dsh-0.2.1--rc.1%20~%200.2.1--rc.5-blue) ![license](https://img.shields.io/badge/license-MIT-green)

---

## 这是什么

BMAD-Method 是一套「先想清楚，再写代码」的开发方法。它把工作拆给不同角色：分析师做调研、产品经理写 PRD、架构师定方案、开发写代码、测试把关，一路产出从需求到实现的文档。

原版要你自己装、自己选模块、自己管一堆散落的文件。这个插件把整套东西打包带进来了：

- **7 个模块全在插件包里**，你机器上不用另外装 BMAD
- **90 个角色和流程**，从「帮我头脑风暴」到「审一遍这段代码」
- **第一次打开就铺好**，46 毫秒，不跑安装器、不联网
- **不用的模块关掉**，它的 skill 就不再出现，文件一个都不删
- **更新插件就是更新 BMAD**，不用再单独管 BMAD 的版本

---

## 装完之后能干什么

直接用中文说你要做什么，对得上就用对应的 skill：

| 你说 | 它做什么 |
| --- | --- |
| 「帮我写个 PRD」 | 走 `bmad-prd`，产出结构化需求文档 |
| 「让 Winston 看看这个架构」 | 切到架构师角色 `bmad-agent-architect` |
| 「跑一遍代码审查」 | 走 `bmad-code-review`，多个视角并行审 |
| 「把需求拆成故事」 | 走 `bmad-create-epics-and-stories` |
| 「这功能怎么做测试」 | 走 `bmad-testarch-test-design` |
| 「我有个想法，帮我掂量掂量」 | 走 `bmad-forge-idea` |

也可以敲 `/bmad-` 看补全，90 个都在。

---

## 安装

```bash
dsh plugin add github:ph1996-cn/dsh-BMAD-Method
```

桌面版更简单：**设置 → 插件 → 从 GitHub 安装**，填 `ph1996-cn/dsh-BMAD-Method`；或者在插件市场里搜 `BMAD`。

装完**重启一次 dsh**，插件才会被加载。

```jsonc
// 想钉住某个版本，防止以后意外更新
"dsh-BMAD-Method": "github:ph1996-cn/dsh-BMAD-Method#v0.1.1"
```

---

## 第一次打开

重启后打开 **设置 → 插件 → dsh-BMAD-Method**，会看到三块。

### 一、设置

| 项 | 说明 |
| --- | --- |
| **用户名** | 写进 BMAD 配置的 `user_name`，它跟你对话时用这个名字 |
| **语言** | 沟通和文档输出用哪种语言，默认「简体中文」 |
| **工作区输出目录** | 产出的文件放哪，默认 `_bmad-output`（相对你的工作区） |

改完点保存，立即生效。

### 二、模块开关

七个模块一行一个，右边一个开关。详见下面「模块开关」那节。

### 三、包含的组件

这里只有一行，就是插件自己。这是 dsh 插件页的固定结构 —— 模块开关在上面那块，不在这里。

> 第一次打开卡片时，插件会自动把 BMAD 运行时铺到 `~/.dsh/bmad-method`（46 毫秒，不联网）。你不用点任何按钮，也不用跑任何命令。

---

## 模块开关

开关只决定**这个模块参不参与**，不动任何文件。

- 关掉 `bmm` → 它的 21 个 skill 立刻从 skill 清单消失，模型再也看不到
- 重新打开 → 又回来
- **模块文件一个都不删**，随时能开回来

状态写在 dsh 的 profile 配置（`cordis.patch.yml`）里，用的就是 dsh 原生插件开关那个 `disabled: true` 字段。所以重启 dsh 后状态还在，也不会有第二份状态表。

`core` 是地基模块，没有开关 —— 关掉它，别的模块的脚本就找不到公共配置了。

> 停用模块后**不用重启 dsh**，skill 清单每次构建都现读补丁。但如果你改的是插件代码本身，还是要重启。

---

## 90 个 skill 都是什么

全部随插件包提供，**不落你的任何目录**（`~/.dsh/skills` 里应该是 0 个 bmad/gds skill）。

| 模块 | skill 数 | 都是些什么 |
| --- | --- | --- |
| `bmm` | 21 | 主力：PRD、架构、故事、代码审查、回顾、头脑风暴 |
| `gds` | 33 | 游戏开发：GDD、游戏架构、试玩计划、游戏测试 |
| `cis` | 10 | 创意：设计思维、创新策略、故事叙述、问题解决 |
| `tea` | 10 | 测试架构：测试设计、ATDD、CI 流水线、可追溯矩阵 |
| `core` | 8 | 公共：帮助、头脑风暴、定制、深度调研、评审 |
| `bmb` | 5 | 造模块用：造 agent、造工作流、造模块 |
| `bmad-loop` | 3 | 无人值守开发循环 |

---

## 更新

**更新插件 = 更新 BMAD**，一条命令：

```bash
dsh plugin --profile desktop update dsh-BMAD-Method
```

`--profile` 换成你实际在用的那个（桌面版是 `desktop`）。更新完重启 dsh。

不用卸载重装 —— dsh 的「安装」对已装插件会直接拒绝（`already-installed`），只能走包管理器更新。

---

## 兼容的 dsh 版本

| 项 | 值 |
| --- | --- |
| **dsh** | `>=0.2.0-rc.1 <0.2.1 \|\| >=0.2.1-rc.1 <0.3.0-0`（整个 0.2.x，含预发布） |
| **实测跑通** | `0.2.1-rc.3`、`0.2.1-rc.5` |
| **Node** | `^22.19.0 \|\| >=24` |

声明在 `package.json` 的 `engines` 里：

```json
"engines": { "node": "^22.19.0 || >=24", "dsh": ">=0.2.0-rc.1 <0.2.1 || >=0.2.1-rc.1 <0.3.0-0" }
```

> **为什么写得这么绕**：node-semver 有个坑 —— 预发布版本（`0.2.1-rc.5`）只有范围里存在一个**元组完全相同且带预发布标签**的比较符时才被放行。看起来更简洁的 `>=0.2.0-rc.1 <0.3.0` 里只有 `0.2.0` 和 `0.3.0` 两个元组，**匹配不到 `0.2.1-rc.5`**。所以必须显式列出 `0.2.1` 这一段。

插件只依赖 dsh 的**公开契约**，不碰私有内部模块，也不 pin 任何 `@deepseek-ai/dsh-*` 依赖：

| 用到的能力 | 怎么用 |
| --- | --- |
| 注册工具 | `ctx.tools.register()` |
| 提供 skill | `ctx.skills.registerProvider()` |
| 设置表单 | `export const Config`（Schemastery schema） |
| 浏览器半端 | `dsh.client` + `ctx.slots.inject()` |
| 卡片接口 | `ctx.webServer.register({ kind: 'prefix' })` |

这五处都在 `0.2.1-rc.5` 的发布包里逐条核对过，签名没变。所以 0.2.x 内的小版本升级不需要跟着改版本号。

---

## 三个工具（模型也能主动调）

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `bmad_modules_list` | `projectRoot?` `registryPath?` | 列出已装 / 可装模块、版本、开关状态 |
| `bmad_module_toggle` | `module` `enabled` | 开关一个模块（只写状态，不装卸文件） |
| `bmad_update` | `userName?` `modules?` `channel?` `language?` | 跑官方安装器更新或补装模块 |

平时用不上 `bmad_update` —— 运行时随插件走。只有两种情况需要它：上游发了新版本，或者要补装被降级跳过的外部模块。

---

## 出问题了

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 插件页看不到 BMAD 设置卡片 | 插件没加载 | 确认 **设置 → 插件** 里它是启用状态，然后重启 dsh |
| 模块全显示「未安装」 | 首次打开还没铺运行时 | 刷新一下卡片（打开即自举），或跑一次 `bmad_modules_list` |
| 模块开关点了没反应 | 找不到 profile 补丁 | 卡片底部会写清原因；确认插件挂在某个 profile 上 |
| 产出文件跑到系统临时目录 | 旧版本 bug | 更新到 `0.1.1` 及以上 |
| skill 里报 `TOML file not found` | 旧版本占位符没展开 | 更新到 `0.1.1` 及以上 |
| 更新完还是旧代码 | `dsh plugin add` 不更新已装包 | 用 `dsh plugin --profile desktop update dsh-BMAD-Method` |
| 外部模块装不上 | 安装器要 `git clone` 各模块仓库 | 确认能访问 GitHub；装不上会自动降级为内置模块，BMAD 仍可用 |

还有个常见误会：BMAD 装在 `~/.dsh/bmad-method`（**全局**），不会在你的项目里建 `_bmad/`。你的项目里只会多出 `_bmad-output/` 这个产物目录。

---

## 给维护者

### 目录

```
index.js              插件入口：三个工具 + 卡片接口
client.js             浏览器半端：设置卡片 + 模块开关
cordis.patch.yml      包内补丁，只挂一行控制面
bmad-home/_bmad/      BMAD 运行时模板（345 KB / 31 文件），首次打开拷出去
skills/               90 个 skill + manifest.json（skill → 模块归属表）
lib/bmad.js           BMAD 发现、安装器调用、运行时铺装
lib/patch.js          profile 补丁的按行读写（不吃掉用户注释）
lib/skills.js         SkillProvider 实现
lib/template.js       模板铺装与配置改写
lib/registry/         bmad-modules.yaml 内置快照（依赖没落地时的离线兜底）
```

### 换 BMAD 版本

1. `npm install bmad-method@<新版本> --save-exact`
2. 跑一次安装器，把新的 `_bmad/` 拷到 `bmad-home/_bmad/`（记得脱敏 `user_name`）
3. 把新的 `.claude/skills`（或 `.agents/skills`）拷到 `skills/`，重新生成 `skills/manifest.json`
4. `npm test`，`npm version patch`，推 tag

模板版本和 `node_modules/bmad-method` 对不上时，插件会自动退回跑安装器，不会把旧结构铺到新版本上。

### 补丁写入的安全性

- `cordis.patch.yml` 一律**按行定点编辑**，不做 YAML 往返序列化 —— 你自己写的注释和条目原样保留（有测试守着）
- 写盘走「临时文件 + rename」，写完立刻回读校验；校验失败把原内容写回并返回 `write-failed`
- 工具**不缓存内存态**，`enabled` 每次从补丁文件现读

### 测试

```bash
npm test     # 16 个用例，0.7 秒
```

用假 ctx 真跑 `apply()`，覆盖：工具注册、模块发现、开关读写、重复停用幂等、用户注释不被破坏、`core` 不可停用、写盘失败回滚、命令组装、全局安装不落工作区、全新环境自举、模板 46ms 铺好 7 个模块、模块停用后 skill 消失、卡片接口（含跨站 403）、`Config` 三个字段全部 `.volatile()`。

> `.volatile()` 是必须的：dsh 的 `volatileForm()` 只把标了 `.volatile()` 的字段放进设置页，一个都没有的话整个条目会被丢掉，界面上就不会出现这张卡片。

---

## License

MIT
