# dsh-prompt-craft

给 DeepSeek Harness 输入框加第二个按钮「✦ 锻造」：把一个粗糙的草稿，改写成一份**让会动手的 agent 执行的任务简报**。

它和已装的 `dsh-prompt-enhance` 并存、互不影响：卸载本插件，原插件一个字节都不变。

## 用法

1. 在输入框写下你的粗略想法（一两句话就够）。
2. 点输入框工具行里的「✦ 锻造」（或按 `Ctrl+Alt+K`）。
3. 结果显示在屏幕中央的浮层里，标题行是 `N → M 字 · 耗时 · 模型`。
4. 「采用并填入」把结果写回输入框，随后 20 秒内可「撤销」；「再试一次」重跑；「深度重写」换 `high` 档再写一遍（10–15 秒，通常更细）；「放弃」丢弃。
5. 浮层可以拖顶部的灰条调高度，`⤢` 切满屏高度，`Esc` 或点背景关闭。

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
- `lib/client.js` — Browser：`window.__ModuleLoader__` 格式，`conversation.input.right`（按钮，order 61）+ `conversation.input.dock`（加载/错误/撤销条，order 91）；结果用 `react-dom` portal 渲染成 `position: fixed` 浮层，滚动容器归浮层自己所有。只依赖 `react` / `react-dom` 与插槽契约的 `useInput` / `inputActions.setDraft` / `sessionId`，不 import 任何 Harness 客户端包。

## 装到其他电脑

```powershell
dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft
```

也可以 `npm pack` 出 tgz 拷过去；详细步骤与校验见 [INSTALL.md](./INSTALL.md)。

## 许可

MIT
