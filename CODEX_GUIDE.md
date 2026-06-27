# Codex 协作指南

这份文档给“对方用户的 Codex”看，用于快速理解、运行、调试和扩展这个仓库。

本文档默认对方已经把本仓库 clone 到任意目录。不要假设仓库位于任何固定工作区。

建议让用户先进入本仓库根目录，再设置目标 XiaoBa 路径：

```powershell
Set-Location <this-repo-clone>
$XIAOBA_ROOT = "<target-XiaoBa-CLI-checkout>"
```

仓库内部路径都应按当前仓库根目录理解，例如：

```text
.\run.ps1
.\run-memory-branch-sim.ts
.\analyze-run.mjs
.\director-prompt-*.txt
.\examples\commands.md
```

## 项目定位

这是一个独立的 XiaoBa 本地对话模拟脚手架。

它不是 XiaoBa fork，也不应该复制进 XiaoBa 仓库。它通过 `-XiaoBaRoot` 指向某个 XiaoBa checkout，然后从那个 checkout 动态加载 XiaoBa core 模块并创建本地模拟 session。

它的目标是帮助测试：

- 长对话承接能力。
- 工具调用和长 ReAct 流程。
- memory branch / branch agent 的搜索、注入、丢弃、取消等行为。
- 跨 session 历史检索效果。
- 不同 XiaoBa 分支之间的行为差异。

## 重要文件

- `run-memory-branch-sim.ts`
  主模拟器。负责加载目标 XiaoBa、创建 session、运行对话循环、调用 director LLM 生成下一轮用户输入。

- `run.ps1`
  Windows 友好的包装入口。提供 preset、默认路径、dry-run、retry 和常用参数封装。大多数用户应该先用它。

- `analyze-run.mjs`
  读取一次 run 的 `sim-summary.jsonl` 和日志目录，输出轮数、session、tool 调用、memory branch 注入/丢弃等摘要。

- `director-prompt-*.txt`
  给 director LLM 的 system prompt。它们控制“模拟用户”如何继续对话。

- `README.md`
  仓库入口说明。

- `USER_GUIDE.md`
  给普通测试使用者看的中文说明。

- `examples/commands.md`
  可复制的命令模板。

## 核心运行流程

1. 用户通过 `-XiaoBaRoot` 指定要测试的 XiaoBa 仓库。

2. 脚手架从 `$XIAOBA_ROOT` 动态 import XiaoBa 模块：

   ```text
   src/utils/ai-service.ts
   src/core/agent-session.ts
   src/runtime/runtime-factory.ts
   src/runtime/runtime-profile-config.ts
   src/core/session-router.ts
   src/utils/logger.ts
   ```

3. 脚手架创建本地 CatsCo 风格的 `AgentSession`。

4. 第一轮使用 `-Seed` 或默认 seed 作为用户输入发给 XiaoBa。

5. XiaoBa 按目标仓库自己的 runtime、tools、skills、memory branch、logs 逻辑正常执行。

6. XiaoBa 返回最终回复后，脚手架把以下信息给 director LLM：

   - 当前测试 topic。
   - 可选 simulated session 名称。
   - 历史用户输入。
   - XiaoBa 的最终回复。

   注意：director 默认看不到 XiaoBa 中间 tool call / tool result。

7. director LLM 返回严格 JSON：

   ```json
   {"session":"sim_group_a","message":"下一轮用户输入","reason":"简短原因","stop":false}
   ```

8. 脚手架继续把下一轮 message 发给对应 session，直到达到 `-Turns` 或 director 要求停止。

9. 输出写到 `-RunRoot` / `-RuntimeRoot`：

   ```text
   sim-summary.jsonl
   logs\
   data\
   ```

## 路径规则

请始终按对方本机的 clone 目录组织命令，不要写死作者或其他人的本机路径。

推荐：

```powershell
Set-Location <this-repo-clone>
$XIAOBA_ROOT = "<target-XiaoBa-CLI-checkout>"
$RUN_ROOT = "..\xiaoba-sim-runs\first-test"
```

然后运行：

```powershell
.\run.ps1 `
  -XiaoBaRoot $XIAOBA_ROOT `
  -Preset plain-long-chat `
  -Name first-test `
  -Turns 3 `
  -ModelSource custom `
  -Verbose
```

`run.ps1` 默认把输出写到本仓库上一级目录下的 `xiaoba-sim-runs\<Name>`。如果用户希望固定输出位置，显式传 `-RunRoot` 和 `-RuntimeRoot`。

## 模型和 API 配置

这个仓库不定义自己的第三方 API key 格式，也不应该提交任何 `.env`。

它复用目标 XiaoBa 仓库的模型配置。

`run.ps1` 的 env 解析顺序：

1. 显式传入的 `-EnvFile`
2. `$XIAOBA_ROOT\.dev-user-data\.env`
3. `$XIAOBA_ROOT\.env`

`-ModelSource` 含义：

- `env`
  不额外改写模型环境变量，直接使用当前环境或目标 XiaoBa 的 env。

- `custom`
  从 `CATSCO_CUSTOM_LLM_*` 读取配置并映射到 XiaoBa 当前使用的 `GAUZ_LLM_*`。

- `relay`
  从 `CATSCO_RELAY_LLM_*` 读取配置并映射到 `GAUZ_LLM_*`。

需要的 custom 变量是：

```text
CATSCO_CUSTOM_LLM_PROVIDER
CATSCO_CUSTOM_LLM_API_BASE
CATSCO_CUSTOM_LLM_MODEL
CATSCO_CUSTOM_LLM_API_KEY
```

如果模型调用失败，优先检查目标 XiaoBa 自己能否正常聊天。脚手架只负责驱动 XiaoBa，不负责修复模型服务、key 或网络问题。

## Preset

`run.ps1` 当前内置：

- `plain-long-chat`
  普通长对话，不刻意要求工具。适合 smoke test。

- `long-browser-tools`
  多话题长对话，周期性要求 `agent-browser` 小范围公开信息核查。适合测试 tool-use 和长 ReAct。

- `cross-session-phase-a`
  在一个模拟 group 里建立稳定历史信息。

- `cross-session-phase-b-strict`
  切到另一个模拟 group，只给项目锚点，测试 XiaoBa 是否能通过历史 logs 找回 Phase A 的信息。

新增 preset 时同步更新：

```text
run.ps1
README.md
USER_GUIDE.md
examples/commands.md
```

## 安全边界

这是 core-level 本地脚手架：

- 不向真实 CatsCo web 发消息。
- 不修改目标 XiaoBa 源码。
- 输出默认写到 run root / runtime root。

`-AutoApproveAgentBrowser` 会启用本地模拟授权，并只自动批准形如 `npx agent-browser ...` 的 `execute_shell` 命令，以及简单 `echo` 分隔符。其他 shell 命令会被 guard 拒绝。

不要随便放宽这个 guard。如果要支持更宽工具权限，新增显式模式，并在文档里写清楚风险。

## 常见调试

用户说“没跑起来”：

- 先看是否传了 `-DryRun`。Dry run 只打印命令，不会调用 XiaoBa。

模型异常：

- 看 dry-run 打印的 `--env-file` 是否正确。
- 看 `-ModelSource` 是否符合目标 XiaoBa 配置。
- 让目标 XiaoBa 自己跑一次普通对话确认模型可用。

跨 session 没找回记忆：

- 检查 Phase A / Phase B 是否共享同一个 `-RuntimeRoot`。
- 检查目标 XiaoBa 是否包含 memory branch 功能和相关日志。
- 看 `analyze-run.mjs` 输出里的 `memory_search`、`memory_read_turn`、`injected`、`dropped`。

branch logs 缺失：

- 可能目标 XiaoBa 版本不支持 branch logs。
- 也可能该 preset 没触发 memory branch 或 branch 被禁用。

## 扩展建议

优先小改，不要急着重构主循环：

- 新场景优先新增 `director-prompt-*.txt`。
- 常用命令优先新增 `run.ps1` preset。
- 新日志统计优先扩展 `analyze-run.mjs`。
- `run-memory-branch-sim.ts` 保持通用执行循环。

仓库应保持 source-only。不要提交 run 输出、logs、data、`.env`、模型 key。
