# XiaoBa Memory Branch Sim

Standalone core-level conversation simulator for testing XiaoBa. It is kept
outside any XiaoBa checkout so the same harness can be used against different
branches or local builds.

The simulator does not send messages to CatsCo web and does not modify the
target XiaoBa source tree.

## What It Does

- Loads `AgentSession` and runtime services from a target XiaoBa checkout.
- Sends simulated user messages to XiaoBa.
- Uses a separate director LLM to generate the next user message from XiaoBa's
  final reply only.
- Supports one or more simulated CatsCo group sessions.
- Can pressure XiaoBa into long tool-using turns, including controlled
  `agent-browser` shell calls.
- Writes isolated logs under a run root.
- Produces a small post-run summary with memory branch and injection counters.

## Requirements

- A target XiaoBa checkout with dependencies installed.
- Node.js available on PATH.
- A model configuration available through the target checkout's `.env` or
  `.dev-user-data\.env`.

The wrapper prefers `<xiaoba-root>\.dev-user-data\.env` when present, then
falls back to `<xiaoba-root>\.env`.

For nontechnical usage notes, see [USER_GUIDE.md](USER_GUIDE.md).
For Codex-based maintenance and extension notes, see
[CODEX_GUIDE.md](CODEX_GUIDE.md).

## Quick Start

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset long-browser-tools `
  -Name browser-smoke-a `
  -ModelSource custom `
  -Verbose
```

Output will be under:

```text
D:\codex_workspace\xiaoba-sim-runs\browser-smoke-a
```

The wrapper runs the simulator and then calls `analyze-run.mjs` automatically.
Add `-DryRun` to print the resolved command without running XiaoBa.
The wrapper retries XiaoBa and director failures 3 times by default; pass
`-XiaoBaRetryLimit infinite -DirectorRetryLimit infinite` for long unattended
runs.

## Presets

`run.ps1` currently includes these presets:

- `long-browser-tools`: long multi-topic Chinese conversation with periodic
  `agent-browser` requests.
- `plain-long-chat`: long conversation without tools.
- `cross-session-phase-a`: build stable decisions in one simulated session.
- `cross-session-phase-b-strict`: continue in another simulated session while
  revealing only the project anchor, useful for memory retrieval tests.

More copy-paste commands are in [examples/commands.md](examples/commands.md).

## Cross-Session Test

Use one shared runtime root so Phase B can search the logs produced by Phase A.

```powershell
$base = 'D:\codex_workspace\xiaoba-sim-runs\cross-session-demo-a'

D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset cross-session-phase-a `
  -RunRoot "$base\phase-a" `
  -RuntimeRoot "$base\runtime" `
  -ModelSource custom `
  -Verbose

D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset cross-session-phase-b-strict `
  -RunRoot "$base\phase-b" `
  -RuntimeRoot "$base\runtime" `
  -ModelSource custom `
  -Verbose
```

## Analyze Existing Output

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\browser-smoke-a
```

For two-phase runs, also pass the shared runtime root:

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo-a\phase-b `
  --runtime-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo-a\runtime
```

## Direct Script Options

The underlying script is still available when you need full control:

```powershell
D:\codex_workspace\XiaoBa-CLI\node_modules\.bin\tsx.cmd `
  D:\codex_workspace\xiaoba-memory-branch-sim\run-memory-branch-sim.ts `
  --xiaoba-root D:\codex_workspace\XiaoBa-CLI `
  --turns 12
```

Useful options:

```text
--xiaoba-root <path>                Target XiaoBa checkout.
--turns <n>                         Number of XiaoBa turns. Default: 12.
--run-root <path>                   Isolated output/log root.
--runtime-root <path>               Runtime/log/data root. Default: run root.
--working-dir <path>                XiaoBa tool working directory.
--session <name>                    Initial simulated group/session.
--sessions <a,b,c>                  Sessions the director can choose from.
--target-tools <default|safe|agent-browser|none|a,b,c>
--env-file <path>                   Model/runtime .env file.
--model-source <env|custom|relay>
--director-prompt <path>            Override director system prompt.
--xiaoba-system-prompt <path>       Override XiaoBa system prompt for this run only.
--auto-approve-agent-browser        Auto-approve controlled npx agent-browser shell commands.
--xiaoba-retry-limit <n|infinite>   Default: infinite.
--director-retry-limit <n|infinite> Default: infinite.
--verbose
```

## Output

- `sim-summary.jsonl`: per-turn summary and compact counters.
- `logs/sessions/...`: XiaoBa session logs for simulated sessions.
- `logs/branches/...`: memory branch logs when the target XiaoBa version writes
  them.
- `data/sessions/...`: target XiaoBa session persistence for this run.

## Notes

- This is a core-level harness, not a web UI driver. The conversation will not
  appear in CatsCo web.
- The director sees only prior user messages and XiaoBa final answers, not
  intermediate tool calls.
- `--auto-approve-agent-browser` is intentionally narrow: it only allows
  `execute_shell` commands that look like `npx agent-browser ...` plus simple
  echo separators.
