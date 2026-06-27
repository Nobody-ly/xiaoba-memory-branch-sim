# XiaoBa Sim Command Examples

These examples assume:

- The target XiaoBa checkout is `D:\codex_workspace\XiaoBa-CLI`.
- Dependencies are installed in that checkout.
- The simulator lives at `D:\codex_workspace\xiaoba-memory-branch-sim`.
- Run outputs are written under `D:\codex_workspace\xiaoba-sim-runs`.

## Quick Long Tool-Use Run

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset long-browser-tools `
  -Name browser-smoke-a `
  -ModelSource custom `
  -Verbose
```

## Plain Long Chat, No Tools

```powershell
D:\codex_workspace\xiaoba-memory-branch-sim\run.ps1 `
  -XiaoBaRoot D:\codex_workspace\XiaoBa-CLI `
  -Preset plain-long-chat `
  -Name plain-chat-a `
  -Turns 16 `
  -ModelSource custom
```

## Cross-Session Memory Test

Use the same runtime root for both phases. Phase A creates the history. Phase B
starts a different simulated group and checks whether XiaoBa can recover the
prior decisions.

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

## Analyze An Existing Run

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\browser-smoke-a
```

For two-phase runs:

```powershell
node D:\codex_workspace\xiaoba-memory-branch-sim\analyze-run.mjs `
  --run-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo-a\phase-b `
  --runtime-root D:\codex_workspace\xiaoba-sim-runs\cross-session-demo-a\runtime
```
