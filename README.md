# dsh-prompt-craft

给 DeepSeek Harness 输入框加第二个按钮「✦ 锻造」：把一个粗糙的草稿，改写成一份**让会动手的 agent 执行的任务简报**。

它和已装的 `dsh-prompt-enhance` 完全并存：两条独立的 bundle row、两个不同的插槽 id、两套互不影响的设置。卸载本插件，原插件一个字节都不变。

## 为什么另做一个，而不是改原插件

`dsh-prompt-enhance` 0.3.4 的内核是 2023 年的写法：它把"好的提示词"定义成一段结构齐全的角色扮演（角色 / 背景 / 编号步骤 / 输出格式 / 验收 / 边界），于是任何输入都输出同一个形状，还会补进原文没有的 `(待补充：…)` 与虚构约束。对"会自己读代码、会跑测试、会追问"的 agent 来说，真正缺的不是角色扮演，而是**决策完备度**：

| 字段 | 回答的问题 | 为什么模型自己补不了 |
| --- | --- | --- |
| 结果 | 做完之后，什么东西存在？ | 只有你知道你要什么 |
| 约束 | 哪些做法不许、哪些现成的必须复用？ | 只有你知道你的红线 |
| 完成判据 | 别人怎么验证它做对了？ | 可验证性决定它能不能自查 |
| 已定假设 | 你没说的部分，它按什么继续？ | 避免它停下来反问，也避免它瞎猜 |

这四项都是**零信息增量**的结构化：不替模型思考，只把只有你知道的东西摆到台面上。本插件只做这件事。

## 用法

1. 在输入框写下你的粗略想法（一两句话就够）。
2. 点输入框工具行里的「✦ 锻造」（或按 `Ctrl+Alt+K`）。
3. 上方浮条显示改写结果：`N → M 字 · 耗时 · 模型`。
4. 「采用并填入」把结果写回输入框，随后 20 秒内可「撤销」；「再试一次」重跑；「深度重写」换 `high` 档再写一遍（10–15 秒，通常更细）；「放弃」丢弃。

输入框正在发送/等待回复、草稿为空、或上一次还没返回时，按钮自动禁用。
输入框原有内容不会被覆盖：只有你点「采用并填入」才写入，而且能撤销。

## 配置

Host 侧走 bundle config（`cordis.patch.yml` 的 `config`），全部可选：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `provider` / `model` | 空 | 留空则用当前对话路由，其次用默认模型 |
| `temperature` | `0.3` | 改写需要稳定，不需要发散 |
| `maxOutputTokens` | `4096` | 只封顶，不引导长度；撞顶会整次失败 |
| `timeoutMs` | `60000` | 超时返回错误，草稿不动 |
| `reasoningEffort` | `off` | `off` / `low` / `high` / `inherit`。实测同一模型的耗时：`off` 2.6–4.7s、`low` 8–12s、`inherit` 9–15s、`high` 11.9s，所以默认取快的；难写的草稿点「深度重写」或由请求体带 `reasoningEffort: "high"` 单次加码 |
| `systemPrompt` | 空 | 留空用内置策略，填了整段替换 |

请求体除 `text` 外还可带 `sessionId`（路由与计费）与 `reasoningEffort`（单次覆盖配置）。

## 卸载

```powershell
# 在 Harness 里用 plugin_manager remove_bundle，或直接删 profile 的 bundle 记录
```

包本身没有任何依赖、没有构建步骤，删掉即干净。

## 实现

- `lib/index.js` — Host：`POST /prompt-craft/enhance`，一次 `llm.stream` 调用，`<draft>…</draft>` 包裹原文（闭合标签转义），输出去掉整段代码围栏。错误码：`empty` / `too-long` / `no-model` / `no-llm` / `timeout` / `upstream` / `max-tokens` / `empty-output`。
- `lib/client.js` — Browser：`window.__ModuleLoader__` 格式，`conversation.input.right`（按钮，order 61）+ `conversation.input.dock`（浮条，order 91）。只依赖 `react` 与插槽契约的 `useInput` / `inputActions.setDraft` / `sessionId`，不 import 任何 Harness 客户端包。

## 从 GitHub 安装（推荐，多台机器共用一份）

仓库：<https://github.com/JEYOO-YU/dsh-prompt-craft>

```powershell
# 目标机器上执行（profile 名按实际改，本机是 desktop）
dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft

# 想钉住某个提交，避免以后 push 影响已装好的机器：
dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft#<commit>
```

或者直接在那台机器的 DSH 会话里说：安装 bundle，目标 `github:JEYOO-YU/dsh-prompt-craft`（agent 用的是同一个 `plugin_manager install_bundle`）。

**发布 / 更新（在源码目录做）**：

1. 在 github.com 上建一个空仓库 `dsh-prompt-craft`（不要勾 README / .gitignore / license）。
2. 跑 `scripts\publish.cmd`——它自己找 DSH 自带的 PortableGit、提交未提交的改动、设置 remote、push；第一次会弹浏览器登录（Git Credential Manager），之后凭据存在 Windows 凭据管理器里。
3. 以后更新改动：再跑一次 `scripts\publish.cmd`。

这台机器的执行策略是 `Restricted`，直接跑 `.ps1` 会被拦，所以用 `.cmd` 包装（内部 `-ExecutionPolicy Bypass`），或自己执行
`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish.ps1`。

更新：改完 push，目标机重装一次——`dsh plugin --profile desktop remove dsh-prompt-craft` 再 `add …`；代价是几秒，不会动别的插件。

## 分发到其他电脑（其它方式）

打包：在包目录里执行 `npm pack --pack-destination dist`，产物 `dist/dsh-prompt-craft-0.1.0.tgz`，约 16 KB、6 个文件、零依赖。
三种装法（GitHub / 拷 tgz / 整目录 link）的细节与校验步骤见 [INSTALL.md](./INSTALL.md)。

## 开发与自测

```powershell
node --check lib/index.js
node --check lib/client.js
node smoke/client-smoke.mjs   # 用桩 React 跑 5 个场景：注册 / 禁用 / 采用 / 撤销 / 失败 / 深度重写
```

改完 Host 半边（`lib/index.js`）要在插件管理里把本插件禁用再启用一次，才会重新加载；改 Browser 半边（`lib/client.js`）刷新页面即可。

## 已知边界（v0.1）

- 只改写草稿本身，**不读对话上下文**：草稿里出现的「刚才那个方案」这类指代不会被解析。原版插件支持上下文，本插件为保持精简先不做。
- 不做追问式交互：不确定的地方由模型写进简报的「先确认」「假设」里，由你决定要不要改。
- 从 workspace 目录直接安装（pnpm link），**不要删除或移动 `D:\Softwares\workbuddygenerate\云端\dsh-prompt-craft`**，否则插件失效；要移除先 `remove_bundle`。

## 许可

MIT
