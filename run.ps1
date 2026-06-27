[CmdletBinding()]
param(
  [string]$XiaoBaRoot = $env:XIAOBA_ROOT,
  [ValidateSet('long-browser-tools', 'plain-long-chat', 'cross-session-phase-a', 'cross-session-phase-b-strict')]
  [string]$Preset = 'long-browser-tools',
  [string]$Name,
  [int]$Turns = 0,
  [string]$RunRoot,
  [string]$RuntimeRoot,
  [string]$WorkingDir,
  [string]$EnvFile,
  [ValidateSet('env', 'custom', 'relay')]
  [string]$ModelSource = 'env',
  [string]$Session,
  [string]$Sessions,
  [string]$Topic,
  [string]$Seed,
  [string]$DirectorPrompt,
  [string]$XiaoBaSystemPrompt,
  [string]$XiaoBaRetryLimit = '3',
  [string]$DirectorRetryLimit = '3',
  [int]$RetryInitialMs = 2000,
  [int]$RetryMaxMs = 60000,
  [switch]$AutoApproveAgentBrowser,
  [switch]$DryRun,
  [switch]$NoAnalyze,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $ScriptRoot

if (-not $XiaoBaRoot) {
  $candidate = Join-Path $WorkspaceRoot 'XiaoBa-CLI'
  if (Test-Path $candidate) {
    $XiaoBaRoot = $candidate
  } else {
    $XiaoBaRoot = (Get-Location).Path
  }
}

$XiaoBaRoot = [System.IO.Path]::GetFullPath($XiaoBaRoot)
$tsx = Join-Path $XiaoBaRoot 'node_modules\.bin\tsx.cmd'
$mainScript = Join-Path $ScriptRoot 'run-memory-branch-sim.ts'
$analyzer = Join-Path $ScriptRoot 'analyze-run.mjs'

if (-not (Test-Path (Join-Path $XiaoBaRoot 'src\core\agent-session.ts'))) {
  throw "XiaoBaRoot does not look like a XiaoBa checkout: $XiaoBaRoot"
}
if (-not (Test-Path $tsx)) {
  throw "Missing tsx at $tsx. Run npm install in the target XiaoBa checkout first."
}

$presetDefaults = @{
  'long-browser-tools' = @{
    Turns = 20
    Session = 'sim_browser_a'
    Sessions = 'sim_browser_a,sim_browser_b'
    Topic = 'Long Chinese multi-topic conversation with periodic small agent-browser checks.'
    DirectorPrompt = 'director-prompt-agent-browser-cross-topic-a.txt'
    TargetTools = 'agent-browser'
    AutoApproveAgentBrowser = $true
  }
  'plain-long-chat' = @{
    Turns = 16
    Session = 'sim_plain_a'
    Sessions = 'sim_plain_a'
    Topic = 'Long natural Chinese conversation without tool pressure.'
    TargetTools = 'none'
    AutoApproveAgentBrowser = $false
  }
  'cross-session-phase-a' = @{
    Turns = 10
    Session = 'sim_memory_a'
    Sessions = 'sim_memory_a'
    Topic = 'Phase A: build stable decisions that should later be recoverable from another session.'
    DirectorPrompt = 'director-prompt-cross-session-phase-a.txt'
    TargetTools = 'agent-browser'
    AutoApproveAgentBrowser = $true
  }
  'cross-session-phase-b-strict' = @{
    Turns = 10
    Session = 'sim_memory_b'
    Sessions = 'sim_memory_b'
    Topic = 'Phase B: recover prior decisions from another session using only the project anchor.'
    DirectorPrompt = 'director-prompt-cross-session-phase-b-strict.txt'
    TargetTools = 'agent-browser'
    AutoApproveAgentBrowser = $true
  }
}

$defaults = $presetDefaults[$Preset]

if ($Turns -le 0) { $Turns = [int]$defaults.Turns }
if (-not $Session) { $Session = [string]$defaults.Session }
if (-not $Sessions) { $Sessions = [string]$defaults.Sessions }
if (-not $Topic) { $Topic = [string]$defaults.Topic }
if (-not $DirectorPrompt -and $defaults.DirectorPrompt) {
  $DirectorPrompt = Join-Path $ScriptRoot ([string]$defaults.DirectorPrompt)
}
if (-not $AutoApproveAgentBrowser -and [bool]$defaults.AutoApproveAgentBrowser) {
  $AutoApproveAgentBrowser = $true
}

if (-not $Name) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Name = "$Preset-$stamp"
}
if (-not $RunRoot) {
  $RunRoot = Join-Path (Join-Path $WorkspaceRoot 'xiaoba-sim-runs') $Name
}
if (-not $RuntimeRoot) {
  $RuntimeRoot = $RunRoot
}
if (-not $WorkingDir) {
  $WorkingDir = $RuntimeRoot
}
if (-not $EnvFile) {
  $devEnv = Join-Path $XiaoBaRoot '.dev-user-data\.env'
  $repoEnv = Join-Path $XiaoBaRoot '.env'
  if (Test-Path $devEnv) {
    $EnvFile = $devEnv
  } elseif (Test-Path $repoEnv) {
    $EnvFile = $repoEnv
  }
}

$argsList = @(
  $mainScript,
  '--xiaoba-root', $XiaoBaRoot,
  '--run-root', $RunRoot,
  '--runtime-root', $RuntimeRoot,
  '--working-dir', $WorkingDir,
  '--turns', [string]$Turns,
  '--session', $Session,
  '--sessions', $Sessions,
  '--topic', $Topic,
  '--model-source', $ModelSource,
  '--target-tools', [string]$defaults.TargetTools,
  '--xiaoba-retry-limit', $XiaoBaRetryLimit,
  '--director-retry-limit', $DirectorRetryLimit,
  '--retry-initial-ms', [string]$RetryInitialMs,
  '--retry-max-ms', [string]$RetryMaxMs
)

if ($EnvFile) { $argsList += @('--env-file', $EnvFile) }
if ($Seed) { $argsList += @('--seed', $Seed) }
if ($DirectorPrompt) { $argsList += @('--director-prompt', $DirectorPrompt) }
if ($XiaoBaSystemPrompt) { $argsList += @('--xiaoba-system-prompt', $XiaoBaSystemPrompt) }
if ($AutoApproveAgentBrowser) { $argsList += '--auto-approve-agent-browser' }
if ($PSBoundParameters.ContainsKey('Verbose')) { $argsList += '--verbose' }
if ($ExtraArgs) { $argsList += $ExtraArgs }

Write-Host "[sim-runner] preset: $Preset"
Write-Host "[sim-runner] xiaoba: $XiaoBaRoot"
Write-Host "[sim-runner] run root: $RunRoot"
Write-Host "[sim-runner] runtime root: $RuntimeRoot"
Write-Host "[sim-runner] sessions: $Sessions"

if ($DryRun) {
  Write-Host '[sim-runner] dry run command:'
  Write-Host "$tsx $($argsList -join ' ')"
  exit 0
}

& $tsx @argsList
$exitCode = $LASTEXITCODE

if (-not $NoAnalyze -and (Test-Path $analyzer)) {
  Write-Host ''
  Write-Host '[sim-runner] analyzing run output...'
  node $analyzer --run-root $RunRoot --runtime-root $RuntimeRoot
}

exit $exitCode
