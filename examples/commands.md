# XiaoBa Sim Command Examples

These examples assume the simulator and XiaoBa checkout have both been cloned
somewhere on the user's machine. Run from this repository root:

```powershell
Set-Location <this-repo-clone>
$XIAOBA_ROOT = "<target-XiaoBa-CLI-checkout>"
$RUNS_ROOT = "..\xiaoba-sim-runs"
```

## Quick Long Tool-Use Run

```powershell
.\run.ps1 `
  -XiaoBaRoot $XIAOBA_ROOT `
  -Preset long-browser-tools `
  -Name browser-smoke-a `
  -RunRoot "$RUNS_ROOT\browser-smoke-a" `
  -ModelSource custom `
  -Verbose
```

## Plain Long Chat, No Tools

```powershell
.\run.ps1 `
  -XiaoBaRoot $XIAOBA_ROOT `
  -Preset plain-long-chat `
  -Name plain-chat-a `
  -RunRoot "$RUNS_ROOT\plain-chat-a" `
  -Turns 16 `
  -ModelSource custom
```

## Cross-Session Memory Test

Use the same runtime root for both phases. Phase A creates the history. Phase B
starts a different simulated group and checks whether XiaoBa can recover the
prior decisions.

```powershell
$BASE = "$RUNS_ROOT\cross-session-demo-a"

.\run.ps1 `
  -XiaoBaRoot $XIAOBA_ROOT `
  -Preset cross-session-phase-a `
  -RunRoot "$BASE\phase-a" `
  -RuntimeRoot "$BASE\runtime" `
  -ModelSource custom `
  -Verbose

.\run.ps1 `
  -XiaoBaRoot $XIAOBA_ROOT `
  -Preset cross-session-phase-b-strict `
  -RunRoot "$BASE\phase-b" `
  -RuntimeRoot "$BASE\runtime" `
  -ModelSource custom `
  -Verbose
```

## Analyze An Existing Run

```powershell
node .\analyze-run.mjs `
  --run-root "$RUNS_ROOT\browser-smoke-a"
```

For two-phase runs:

```powershell
node .\analyze-run.mjs `
  --run-root "$BASE\phase-b" `
  --runtime-root "$BASE\runtime"
```
