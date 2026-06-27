# Codex Guide

This file is for another Codex instance helping a user run, debug, or extend
this simulator.

## Project Shape

This repository is a standalone XiaoBa conversation simulation harness. It is
not a XiaoBa fork and should not be copied into a XiaoBa checkout.

Important files:

- `run-memory-branch-sim.ts`: the main simulator. It imports XiaoBa source files
  from a target checkout passed by `--xiaoba-root`.
- `run.ps1`: Windows-friendly wrapper with presets and safer defaults.
- `analyze-run.mjs`: post-run analyzer for `sim-summary.jsonl` and XiaoBa logs.
- `director-prompt-*.txt`: system prompts for the external user-simulator LLM.
- `examples/commands.md`: copy-paste command recipes.
- `README.md`: operator quick start.
- `USER_GUIDE.md`: nontechnical explanation for users.

## Core Flow

1. The user points the harness at a target XiaoBa checkout with `-XiaoBaRoot`.
2. The harness loads XiaoBa modules from that checkout:
   - `src/utils/ai-service.ts`
   - `src/core/agent-session.ts`
   - `src/runtime/runtime-factory.ts`
   - `src/runtime/runtime-profile-config.ts`
   - `src/core/session-router.ts`
   - `src/utils/logger.ts`
3. The harness creates one or more local CatsCo-style `AgentSession` instances.
4. It sends an initial simulated user message to XiaoBa.
5. XiaoBa answers normally through its own runtime, tools, memory branches, and
   session logging.
6. A separate director LLM receives only:
   - the test topic,
   - available simulated session names,
   - previous simulated user messages,
   - XiaoBa final assistant replies.
7. The director returns strict JSON with the next user message and optional
   target session.
8. The harness repeats until `--turns` is reached or the director stops.
9. The harness writes:
   - `sim-summary.jsonl`
   - XiaoBa `logs/`
   - XiaoBa `data/sessions/`
   under the run root / runtime root.

## API And Model Configuration

The simulator does not define a separate third-party API key format. It reuses
the target XiaoBa checkout's model configuration.

Resolution order in `run.ps1`:

1. Explicit `-EnvFile`
2. `<xiaoba-root>\.dev-user-data\.env`
3. `<xiaoba-root>\.env`

`-ModelSource` controls which XiaoBa model configuration is activated:

- `env`: use the current GAUZ/XiaoBa environment as-is.
- `custom`: read `CATSCO_CUSTOM_LLM_PROVIDER`, `CATSCO_CUSTOM_LLM_API_BASE`,
  `CATSCO_CUSTOM_LLM_MODEL`, and `CATSCO_CUSTOM_LLM_API_KEY`, then map them to
  XiaoBa's active `GAUZ_LLM_*` variables.
- `relay`: same idea, but with `CATSCO_RELAY_LLM_*`.

Both XiaoBa and the director LLM use XiaoBa's `AIService`. If the target
checkout cannot call its configured model, the harness will run but XiaoBa turns
will fail or retry.

## Presets

`run.ps1` has four presets:

- `long-browser-tools`: long multi-topic Chinese conversation with periodic
  `agent-browser` requests. Good for testing long ReAct turns and memory branch
  injection opportunities.
- `plain-long-chat`: no tool pressure. Good for checking the harness and basic
  conversation behavior.
- `cross-session-phase-a`: builds recoverable decisions in one simulated group.
- `cross-session-phase-b-strict`: starts a different group and asks XiaoBa to
  recover prior decisions using only the project anchor.

If adding a preset, update:

- `run.ps1`
- `README.md`
- `examples/commands.md`

## Safety Boundaries

This harness is core-level and local:

- It does not send messages to CatsCo web.
- It does not modify XiaoBa source files.
- It writes runtime artifacts only under `-RunRoot` / `-RuntimeRoot`.

`-AutoApproveAgentBrowser` is intentionally narrow. It enables a local device
grant and auto-approves only shell commands that match `npx agent-browser ...`
plus simple `echo` separators. The shell guard rejects other shell commands.

Do not broaden this guard casually. If a test needs broader tool execution, add
a separate explicit mode and document the risk.

## Common Debugging

If the user says "it did not run", check whether they used `-DryRun`. Dry run
only prints the resolved command.

If the run stops with a model error, inspect:

- the selected `-ModelSource`,
- the env file path printed by the dry-run command,
- whether the target XiaoBa checkout itself can call the model.

If branch logs are missing, remember that this harness can test any XiaoBa
checkout. Older XiaoBa versions may not implement memory branch logging.

If cross-session memory seems empty, make sure Phase A and Phase B share the
same `-RuntimeRoot`. Different runtime roots mean Phase B cannot see Phase A's
session logs.

## Extension Guidance

Prefer small additions over rewriting the main loop:

- Add new `director-prompt-*.txt` files for new scenarios.
- Add presets to `run.ps1` for common command lines.
- Add counters to `analyze-run.mjs` when a new XiaoBa runtime event becomes
  important.
- Keep `run-memory-branch-sim.ts` focused on the generic execution loop.

When changing output paths, keep run artifacts outside the repository by
default. The repo should stay source-only.
