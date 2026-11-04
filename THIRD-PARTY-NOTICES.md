# 第三方声明

本仓库（`dsh-bmad-method`）随包分发 BMAD-Method 的运行时与 skill 内容。这些内容不属于本仓库的著作权，版权归原作者所有，按 MIT 许可证分发。

## 版权归属

以下内容均来自 [bmad-code-org](https://github.com/bmad-code-org)，版权归 **BMad Code, LLC** 所有：

| 内容 | 上游仓库 |
| --- | --- |
| BMAD-Method 本体（`bmad-home/_bmad/`，以及 `skills/` 里 `bmm` 与 `core` 的 skill） | https://github.com/bmad-code-org/BMAD-METHOD |
| BMad Builder（`bmb`） | https://github.com/bmad-code-org/bmad-builder |
| Creative Intelligence Suite（`cis`） | https://github.com/bmad-code-org/bmad-module-creative-intelligence-suite |
| Test Architect（`tea`） | https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise |
| Game Dev Studio（`gds`） | https://github.com/bmad-code-org/bmad-module-game-dev-studio |
| BMAD Loop（`bmad-loop`） | https://github.com/bmad-code-org/bmad-loop |

## 我们对上游内容做的修改

1. **skill 正文的路径重写（运行时）**：`skills/` 下的 `SKILL.md` 在磁盘上保持上游原样，读取时才重写——`{project-root}/_bmad/` 换成安装目录的绝对路径，`{skill-root}` 换成该 skill 的包内绝对路径，其余 `{project-root}` 换成用户工作区。这样 skill 正文里的脚本调用才能在 dsh 里正确解析。
2. **运行时快照**：`bmad-home/_bmad/` 是从上游安装产物复制来的快照，把 `user_name` 脱敏成 `BMad`。
3. **跨模块同名键**：`config.toml` 里 `[modules.gds]` 与 `[modules.bmm]` 定义了同名的三个键，上游渲染器遇到会报 ambiguous，铺装时把 gds 那三条注释掉（只改本机副本，不动上游代码）。

以上修改均在 MIT 允许范围内，不改变上游内容的许可证。

## MIT 许可证全文

以下声明适用于本仓库包含的上游 BMAD 内容：

```text
MIT License

Copyright (c) 2025 BMad Code, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

本仓库自身的代码（`index.js` / `client.js` / `lib/` / `test/` / `scripts/`）同样以 MIT 发布，见 [LICENSE](./LICENSE)。

## 商标

「BMAD」「BMAD-Method」是 BMad Code, LLC 的项目名。本插件是**非官方**的社区封装，与 BMad Code, LLC 无隶属或背书关系；包名与描述中的 BMAD 仅用于说明封装对象。
