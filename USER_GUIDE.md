# User Guide

This guide explains the simulator in plain language.

## What This Is

This project is a small testing tool for XiaoBa.

It pretends to be a user chatting with XiaoBa many times in a row. After XiaoBa
replies, another model plays the role of the next user and sends a new message.
This creates a long test conversation without you having to type every message
by hand.

It is useful when you want to check things like:

- Can XiaoBa keep track of a long conversation?
- Can XiaoBa use tools during a longer task?
- Can XiaoBa recover information from an earlier simulated session?
- Did a XiaoBa branch behave better or worse than another branch?
- Are memory branch logs and injected memory results working?

## What This Does Not Do

It does not open the real CatsCo web chat.

It does not send messages to a real group.

It does not change XiaoBa source code.

It does not bring its own model API key. It uses the model settings from the
XiaoBa folder you point it at.

## The Mental Model

Think of three pieces:

1. Target XiaoBa

   This is the XiaoBa version you want to test, for example:

   `D:\codex_workspace\XiaoBa-CLI`

2. Simulator

   This project:

   `D:\codex_workspace\xiaoba-memory-branch-sim`

   It sends fake user messages to XiaoBa and records what happened.

3. Run output

   A folder created for one test run, usually under:

   `D:\codex_workspace\xiaoba-sim-runs`

   This contains the conversation summary and XiaoBa logs for that test.

## API And Model Settings

You normally do not configure API keys in this simulator.

The simulator asks the target XiaoBa folder for model settings. By default it
looks for:

1. `D:\...\XiaoBa-CLI\.dev-user-data\.env`
2. `D:\...\XiaoBa-CLI\.env`

If you use XiaoBa Dashboard and saved a custom model there, use:

```powershell
-ModelSource custom
```

If your target XiaoBa folder uses the normal environment variables directly, use
or omit:

```powershell
-ModelSource env
```

If model calls fail, first check whether that XiaoBa folder itself can chat
normally. The simulator cannot fix a broken model key or unreachable API
server.

## First Test

Open PowerShell and run:

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset plain-long-chat `
  -Name first-smoke-test `
  -Turns 3 `
  -ModelSource custom `
  -Verbose
```

This starts a short simulated chat with XiaoBa.

When it finishes, open:

```text
D:\codex_workspace\xiaoba-sim-runs\first-smoke-test
```

The most useful file is:

```text
sim-summary.jsonl
```

The wrapper also prints a readable summary after the run.

## Test Without Spending Model Calls

If you only want to check the command and paths:

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

`-DryRun` only prints the command. It does not run XiaoBa.

## Choose A Test Type

Use `-Preset` to choose what kind of test you want.

### `plain-long-chat`

A normal long chat without tool pressure.

Use this first when you only want to confirm the simulator works.

### `long-browser-tools`

A longer conversation where the fake user sometimes asks XiaoBa to use
`agent-browser`.

Use this when you want to test tool use, long ReAct turns, and memory injection
timing.

### `cross-session-phase-a`

Creates useful history in one simulated group.

### `cross-session-phase-b-strict`

Starts another simulated group and checks whether XiaoBa can recover what was
decided in Phase A.

For this to work, Phase A and Phase B must use the same `-RuntimeRoot`.

## Change The Topic

Pass `-Topic` to tell the fake user what kind of conversation to create:

```powershell
-Topic "测试一个短对话：围绕周末小型读书会安排，关注语气、记忆承接和简洁输出"
```

Pass `-Seed` to control the very first user message:

```powershell
-Seed "我们做个短测试：我想安排一个周末小型读书会，预算低，气氛安静。你先简单回应。"
```

## Temporarily Change XiaoBa's System Prompt

Create a prompt file:

```powershell
Set-Content D:\codex_workspace\xiaoba-memory-branch-sim\local-test-system-prompt.md @'
你是一个用于本地测试的 XiaoBa 助手。
回答要简洁、自然、中文优先。
'@ -Encoding UTF8
```

Then pass:

```powershell
-XiaoBaSystemPrompt D:\codex_workspace\xiaoba-memory-branch-sim\local-test-system-prompt.md
```

This only affects this simulation run.

## Analyze A Run Later

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\first-smoke-test
```

For a two-phase cross-session test:

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo\phase-b `
  --runtime-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo\runtime
```

## Common Problems

### It only printed a command and did not run

You used `-DryRun`. Remove it to actually run XiaoBa.

### It says the model has a temporary error

The simulator reached XiaoBa, but XiaoBa could not call the configured model.
Check the target XiaoBa model settings.

### Phase B cannot recover Phase A memory

Make sure both phases use the same `-RuntimeRoot`.

### I do not see anything in CatsCo web

That is expected. This tool talks to XiaoBa core directly and writes local logs.
