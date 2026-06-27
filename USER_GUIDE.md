# 用户指南

这份文档给不改 XiaoBa、也不改本项目代码的测试使用者看。

## 这是什么

这是一个用于测试 XiaoBa 的本地对话脚手架。

它会假装成一个用户，连续给 XiaoBa 发消息。XiaoBa 每回复一次，脚手架就让另一个模型扮演“下一轮用户”，根据 XiaoBa 的最终回复继续提问。这样就能自动生成一段较长的测试对话，不需要你手动一轮轮输入。

它适合用来检查：

- XiaoBa 能不能接住长对话。
- XiaoBa 会不会在长任务中正确使用工具。
- XiaoBa 能不能从之前的模拟会话里找回信息。
- 不同 XiaoBa 分支或版本的效果有没有差异。
- memory branch 的搜索、注入、丢弃等日志是否正常。

## 它不会做什么

它不会打开真实的 CatsCo 网页聊天。

它不会往真实群聊里发消息。

它不会修改 XiaoBa 源码。

它不会自带模型 API key。它使用你指定的 XiaoBa 文件夹里的模型配置。

## 最直观的理解

可以把它想成三部分：

1. 被测试的 XiaoBa

   也就是你要测试的 XiaoBa 项目文件夹，例如：

   ```text
   D:\codex_workspace\XiaoBa-CLI
   ```

2. 这个测试脚手架

   也就是本项目，例如：

   ```text
   D:\codex_workspace\xiaoba-memory-branch-sim
   ```

   它负责不断向 XiaoBa 发送模拟用户消息，并记录发生了什么。

3. 每次测试产生的输出目录

   通常在：

   ```text
   D:\codex_workspace\xiaoba-sim-runs
   ```

   每跑一次测试，就会生成一个独立目录，里面有对话摘要、XiaoBa 日志和运行数据。

## 模型 API 配置怎么理解

一般情况下，你不需要在这个脚手架里单独配置 API key。

脚手架会读取你指定的 XiaoBa 文件夹里的模型配置。默认优先顺序是：

1. `D:\...\XiaoBa-CLI\.dev-user-data\.env`
2. `D:\...\XiaoBa-CLI\.env`

如果你是在 XiaoBa Dashboard 里保存了“自定义模型”，运行时通常使用：

```powershell
-ModelSource custom
```

如果你的 XiaoBa 本身就是直接通过环境变量配置模型，可以使用或省略：

```powershell
-ModelSource env
```

如果模型调用失败，优先检查被测试的 XiaoBa 自己能不能正常聊天。这个脚手架无法修复失效的 key、不可访问的 API 服务，或者模型服务本身的网络错误。

## 第一次测试

打开 PowerShell，运行：

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset plain-long-chat `
  -Name first-smoke-test `
  -Turns 3 `
  -ModelSource custom `
  -Verbose
```

含义是：

- 用 `D:\codex_workspace\XiaoBa-CLI` 这个 XiaoBa 版本进行测试。
- 跑一个普通长对话预设。
- 测试名叫 `first-smoke-test`。
- 一共跑 3 轮。
- 使用 XiaoBa 的自定义模型配置。

跑完后看这个目录：

```text
D:\codex_workspace\xiaoba-sim-runs\first-smoke-test
```

最容易看的文件是：

```text
sim-summary.jsonl
```

脚手架也会在命令行最后自动打印一份简短分析。

## 只检查命令，不真正运行

如果你只是想确认路径、参数、模型配置有没有拼对，不想消耗模型调用，可以加 `-DryRun`：

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset plain-long-chat `
  -Name dry-run-test `
  -Turns 3 `
  -ModelSource custom `
  -DryRun `
  -Verbose
```

注意：`-DryRun` 只会打印将要执行的命令，不会真的启动 XiaoBa。

如果你看到它只打印了一大串命令就结束了，这是正常的。

## 选择测试类型

通过 `-Preset` 选择测试类型。

### `plain-long-chat`

普通长对话，不刻意要求使用工具。

第一次测试建议先用这个，确认脚手架和模型配置是否正常。

### `long-browser-tools`

较长的多话题对话，并且会周期性让 XiaoBa 使用 `agent-browser` 做小范围公开信息确认。

适合测试：

- 工具调用是否正常。
- 长 ReAct 任务是否稳定。
- memory branch 是否有机会在主任务执行中注入结果。

### `cross-session-phase-a`

第一阶段：在一个模拟群组里建立一些稳定信息和决策。

### `cross-session-phase-b-strict`

第二阶段：切到另一个模拟群组，只给 XiaoBa 一个项目锚点，测试它能不能从前一个会话的日志里找回信息。

跨会话测试时，Phase A 和 Phase B 必须使用同一个 `-RuntimeRoot`，否则第二阶段看不到第一阶段的历史日志。

## 修改测试话题

用 `-Topic` 控制“模拟用户大概要聊什么”：

```powershell
-Topic "测试一个短对话：围绕周末小型读书会安排，关注语气、记忆承接和简洁输出"
```

用 `-Seed` 控制第一轮用户消息：

```powershell
-Seed "我们做个短测试：我想安排一个周末小型读书会，预算低，气氛安静。你先简单回应。"
```

`Topic` 是给“扮演用户的模型”看的；`Seed` 是真正发给 XiaoBa 的第一句话。

## 临时替换 XiaoBa 的 system prompt

如果你想只在这次测试里换一个 XiaoBa system prompt，可以先创建一个文件：

```powershell
Set-Content D:\codex_workspace\xiaoba-memory-branch-sim\local-test-system-prompt.md @'
你是一个用于本地测试的 XiaoBa 助手。
回答要简洁、自然、中文优先。
'@ -Encoding UTF8
```

然后运行时加上：

```powershell
-XiaoBaSystemPrompt D:\codex_workspace\xiaoba-memory-branch-sim\local-test-system-prompt.md
```

这只影响本次模拟测试，不会改 XiaoBa 项目文件。

## 之后单独分析某次结果

如果测试已经跑完，之后想重新看摘要，可以运行：

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\first-smoke-test
```

如果是跨会话两阶段测试，需要同时传入共享 runtime 目录：

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo\phase-b `
  --runtime-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo\runtime
```

## 常见问题

### 它只打印了一条命令，没有跑起来

你用了 `-DryRun`。

去掉 `-DryRun` 才会真正运行。

### 提示模型服务临时异常

这说明脚手架已经成功调用到 XiaoBa，但 XiaoBa 当前配置的模型没有成功返回。

请检查：

- XiaoBa Dashboard 里的模型配置是否正确。
- `.dev-user-data\.env` 或 `.env` 里是否有正确配置。
- 这个 XiaoBa 版本自己是否能正常聊天。

### 跨会话测试没找回第一阶段的信息

先检查 Phase A 和 Phase B 是否用了同一个 `-RuntimeRoot`。

如果 runtime root 不同，第二阶段就看不到第一阶段产生的 session logs。

### 为什么 CatsCo 网页里看不到这些对话

这是正常的。

这个脚手架是直接调用 XiaoBa core，不是模拟网页输入，因此不会出现在真实 CatsCo 网页聊天里。

### 会不会污染真实对话

正常不会。

它使用模拟 session 名称，并把日志写到你指定的 run 目录。建议测试时给 `-Name`、`-Session` 使用明显的测试名字，例如：

```text
sim_browser_a
sim_memory_a
first-smoke-test
```

## 推荐给别人怎么开始

最简单的顺序是：

1. 先确认目标 XiaoBa 自己能正常聊天。
2. 跑一次 `-DryRun`。
3. 跑一次 `plain-long-chat`，`-Turns 3`。
4. 跑一次 `long-browser-tools`，`-Turns 5`。
5. 如果要测跨会话记忆，再跑 `cross-session-phase-a` + `cross-session-phase-b-strict`。
