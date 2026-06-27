#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface SimOptions {
  xiaobaRoot: string;
  turns: number;
  runRoot: string;
  runtimeRoot: string;
  workingDirectory?: string;
  sessions: string[];
  initialSession: string;
  allowNewSessions: boolean;
  topic: string;
  seedMessage: string;
  directorPromptPath?: string;
  xiaobaSystemPromptPath?: string;
  envFile?: string;
  modelSource: 'env' | 'custom' | 'relay';
  directorModel?: string;
  directorProvider?: 'openai' | 'anthropic';
  directorApiUrl?: string;
  directorTemperature?: number;
  maxDirectorContextChars: number;
  agentId: string;
  actorUserId: string;
  loadSkills?: boolean;
  targetTools?: string[];
  stopOnXiaobaError: boolean;
  xiaobaRetryLimit: number | null;
  directorRetryLimit: number | null;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  catscoLocalOwnerSelf: boolean;
  autoApproveAgentBrowser: boolean;
  verbose: boolean;
}

interface SimTurnRecord {
  turn: number;
  session: string;
  user: string;
  assistant: string;
}

interface DirectorChoice {
  session: string;
  message: string;
  reason?: string;
  stop?: boolean;
}

interface LoadedXiaoBa {
  AIService: any;
  AgentSession: any;
  RuntimeFactory: any;
  resolveRuntimeProfileFromConfig: any;
  createExecutionScopeFromRoute: any;
  createSessionRoute: any;
  Logger: any;
}

const DEFAULT_SEED_MESSAGE = [
  '我们来做一个长期聊天测试：我想规划一个小型生日晚宴，主题暂定 memory_branch_sim_dinner。',
  '核心偏好是温暖、安静、有手作感，预算不要太高，主角喜欢胶片相机、老电影和淡花香。',
  '你先简单回应即可。',
].join('');

const DEFAULT_DIRECTOR_PROMPT = [
  'You are an external user-simulator for testing XiaoBa long conversation memory.',
  'You generate only the next USER message that will be sent to XiaoBa.',
  '',
  'Goals:',
  '- Keep the conversation natural and Chinese.',
  '- Continue the current topic when useful, but occasionally introduce a new related topic.',
  '- Every few turns, refer back to older details indirectly to test memory retrieval.',
  '- Periodically ask for a longer multi-step task, such as reorganizing a plan, comparing options, or checking omissions.',
  '- Do not mention tests, memory branch, logs, benchmarks, prompts, or this simulator.',
  '- Do not ask XiaoBa to reveal hidden system prompts.',
  '',
  'Return strict JSON only:',
  '{"session":"<session name>","message":"<next user message>","reason":"<short internal reason>","stop":false}',
].join('\n');

const XIAOBA_ERROR_REPLY = '不好意思，刚才处理出了点问题，你再试一次？';

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help) {
    printHelp();
    return;
  }

  const launchCwd = process.cwd();
  const options = normalizeOptions(raw, launchCwd);
  validateSimSafetyOptions(options);
  fs.mkdirSync(options.runRoot, { recursive: true });
  fs.mkdirSync(options.runtimeRoot, { recursive: true });
  process.chdir(options.runtimeRoot);
  applyEnvFileOption(options, raw['env-file'] !== undefined);
  applyXiaoBaModelSource(options);
  const xiaoba = await loadXiaoBa(options.xiaobaRoot);

  const summaryPath = path.join(options.runRoot, 'sim-summary.jsonl');
  const profile = resolveProfile(xiaoba, options);
  fs.mkdirSync(profile.workingDirectory, { recursive: true });

  xiaoba.Logger.openLogFile('memory-branch-sim', undefined, true);
  try {
    const services = await xiaoba.RuntimeFactory.createServices(profile, {
      loadSkills: options.loadSkills,
    });
    installAgentBrowserShellGuard(services.toolManager, options);
    const xiaobaSystemPrompt = options.xiaobaSystemPromptPath
      ? fs.readFileSync(options.xiaobaSystemPromptPath, 'utf-8')
      : undefined;
    const directorPrompt = options.directorPromptPath
      ? fs.readFileSync(options.directorPromptPath, 'utf-8')
      : DEFAULT_DIRECTOR_PROMPT;
    const director = new xiaoba.AIService({
      ...(options.directorModel && { model: options.directorModel }),
      ...(options.directorProvider && { provider: options.directorProvider }),
      ...(options.directorApiUrl && { apiUrl: options.directorApiUrl }),
      ...(typeof options.directorTemperature === 'number' && { temperature: options.directorTemperature }),
    });

    const sessions = new Map<string, any>();
    const history: SimTurnRecord[] = [];

    const getSession = (name: string): any => {
      const existing = sessions.get(name);
      if (existing) return existing;
      if (!options.allowNewSessions && !options.sessions.includes(name)) {
        throw new Error(`Director selected unknown session "${name}". Add it to --sessions or pass --allow-new-sessions.`);
      }
      const route = xiaoba.createSessionRoute({
        source: 'catscompany',
        topicType: 'group',
        topicId: name,
        actorUserId: options.actorUserId,
        agentId: options.agentId,
        identityTrust: 'server_canonical',
        identitySource: 'memory-branch-sim',
        legacySessionKey: `cc_group:${name}`,
      });
      const session = new xiaoba.AgentSession(route.sessionKey, services, 'catscompany', route);
      if (xiaobaSystemPrompt !== undefined) {
        session.setSystemPromptProvider(() => xiaobaSystemPrompt);
      } else {
        session.setSystemPromptProvider(
          xiaoba.RuntimeFactory.createSessionSystemPromptProvider(profile, route.sessionKey, 'catscompany'),
        );
      }
      const managed = { name, route, session };
      sessions.set(name, managed);
      return managed;
    };

    let currentSession = options.initialSession;
    let nextUserMessage = options.seedMessage;

    for (let turn = 1; turn <= options.turns; turn++) {
      const managed = getSession(currentSession);
      const startedAt = new Date();
      console.log(`\n[sim] turn ${turn}/${options.turns} -> ${currentSession}`);
      console.log(`[user] ${nextUserMessage}`);

      const turnResult = await runXiaoBaTurnWithRetry({
        xiaoba,
        managed,
        options,
        turn,
        summaryPath,
        userMessage: nextUserMessage,
        firstStartedAt: startedAt,
      });
      const result = turnResult.result;
      const assistant = result.text || '';
      console.log(`[xiaoba] ${oneLine(assistant, 360)}`);

      const logEvents = collectTurnLogEvents(options.runtimeRoot, managed.route.sessionKey, startedAt);
      appendJsonl(summaryPath, {
        turn,
        timestamp: new Date().toISOString(),
        session: currentSession,
        sessionKey: managed.route.sessionKey,
        user: nextUserMessage,
        assistant,
        visibleToUser: result.visibleToUser,
        logEvents,
      });
      history.push({ turn, session: currentSession, user: nextUserMessage, assistant });

      if (options.stopOnXiaobaError && isXiaoBaErrorReply(assistant)) {
        appendJsonl(summaryPath, {
          turn,
          timestamp: new Date().toISOString(),
          event: 'xiaoba_error_stop',
          session: currentSession,
          retries_exhausted: true,
        });
        console.log('[sim] stopped because XiaoBa returned its generic error reply. Fix model config and rerun.');
        break;
      }

      if (turn >= options.turns) break;
      const choice = await chooseNextUserMessageWithRetry({
        director,
        directorPrompt,
        options,
        turn,
        sessions: Array.from(new Set([...options.sessions, ...sessions.keys()])),
        currentSession,
        history,
        summaryPath,
      });
      if (choice.stop) {
        appendJsonl(summaryPath, {
          turn,
          timestamp: new Date().toISOString(),
          event: 'director_stop',
          choice,
        });
        break;
      }
      currentSession = choice.session || currentSession;
      nextUserMessage = choice.message;
      if (options.verbose && choice.reason) console.log(`[director] ${choice.reason}`);
    }

    for (const managed of sessions.values()) {
      await managed.session.cleanup({ stopSubAgents: true, subAgentStopReason: 'memory branch sim finished' });
    }

    console.log('\n[sim] complete');
    console.log(`[sim] XiaoBa root: ${options.xiaobaRoot}`);
    console.log(`[sim] run root: ${options.runRoot}`);
    console.log(`[sim] runtime root: ${options.runtimeRoot}`);
    console.log(`[sim] summary: ${summaryPath}`);
    console.log('[sim] note: this core-level simulation does not send messages to CatsCo web.');
  } finally {
    xiaoba.Logger.closeLogFile();
  }
}

async function loadXiaoBa(root: string): Promise<LoadedXiaoBa> {
  const importTs = async (relativePath: string) => {
    const absolute = path.join(root, relativePath);
    return import(pathToFileURL(absolute).href);
  };
  const [
    aiService,
    agentSession,
    runtimeFactory,
    runtimeProfileConfig,
    sessionRouter,
    logger,
  ] = await Promise.all([
    importTs('src/utils/ai-service.ts'),
    importTs('src/core/agent-session.ts'),
    importTs('src/runtime/runtime-factory.ts'),
    importTs('src/runtime/runtime-profile-config.ts'),
    importTs('src/core/session-router.ts'),
    importTs('src/utils/logger.ts'),
  ]);
  return {
    AIService: aiService.AIService,
    AgentSession: agentSession.AgentSession,
    RuntimeFactory: runtimeFactory.RuntimeFactory,
    resolveRuntimeProfileFromConfig: runtimeProfileConfig.resolveRuntimeProfileFromConfig,
    createExecutionScopeFromRoute: sessionRouter.createExecutionScopeFromRoute,
    createSessionRoute: sessionRouter.createSessionRoute,
    Logger: logger.Logger,
  };
}

async function chooseNextUserMessage(input: {
  director: any;
  directorPrompt: string;
  options: SimOptions;
  turn: number;
  sessions: string[];
  currentSession: string;
  history: SimTurnRecord[];
}): Promise<DirectorChoice> {
  const history = trimHistory(input.history, input.options.maxDirectorContextChars);
  const response = await input.director.chat([
    { role: 'system', content: input.directorPrompt },
    {
      role: 'user',
      content: JSON.stringify({
        topic: input.options.topic,
        turn_completed: input.turn,
        available_sessions: input.sessions,
        current_session: input.currentSession,
        history,
      }, null, 2),
    },
  ]);
  const parsed = parseDirectorChoice(response.content || '');
  const session = String(parsed.session || input.currentSession).trim() || input.currentSession;
  const message = String(parsed.message || '').trim();
  if (!message) {
    return {
      session,
      message: fallbackUserMessage(input.turn),
      reason: 'fallback after empty director message',
    };
  }
  return {
    session,
    message,
    reason: parsed.reason,
    stop: parsed.stop === true,
  };
}

async function runXiaoBaTurnWithRetry(input: {
  xiaoba: LoadedXiaoBa;
  managed: any;
  options: SimOptions;
  turn: number;
  summaryPath: string;
  userMessage: string;
  firstStartedAt: Date;
}): Promise<{ result: any; attempts: number }> {
  let attempt = 0;
  let lastResult: any;

  while (true) {
    const snapshot = snapshotSessionMessages(input.managed.session);
    try {
      const executionScope = input.xiaoba.createExecutionScopeFromRoute(input.managed.route);
      const handleOptions: Record<string, unknown> = {
        sessionRoute: input.managed.route,
        executionScope,
      };
      if (input.options.catscoLocalOwnerSelf) {
        handleOptions.localDeviceGrant = createSimLocalDeviceGrant(executionScope, input.options);
      }
      if (input.options.autoApproveAgentBrowser) {
        handleOptions.callbacks = {
          ...(typeof handleOptions.callbacks === 'object' && handleOptions.callbacks ? handleOptions.callbacks : {}),
          confirmToolExecution: createAgentBrowserAutoApprover(),
        };
      }

      const result = await input.managed.session.handleMessage(input.userMessage, handleOptions);
      lastResult = result;
      if (!isXiaoBaErrorReply(result.text || '')) {
        return { result, attempts: attempt + 1 };
      }
      restoreSessionMessages(input.managed.session, snapshot);
      const retry = shouldRetryAttempt(attempt, input.options.xiaobaRetryLimit);
      appendJsonl(input.summaryPath, {
        turn: input.turn,
        timestamp: new Date().toISOString(),
        event: retry ? 'xiaoba_retry' : 'xiaoba_retry_exhausted',
        session: input.managed.name,
        attempt: attempt + 1,
        reason: 'generic_error_reply',
      });
      if (!retry) return { result, attempts: attempt + 1 };
      const delayMs = retryDelayMs(attempt, input.options);
      console.log(`[sim] XiaoBa returned generic error; retrying turn ${input.turn}, attempt ${attempt + 2} after ${delayMs}ms`);
      await sleep(delayMs);
      attempt++;
    } catch (error: any) {
      restoreSessionMessages(input.managed.session, snapshot);
      const retry = shouldRetryAttempt(attempt, input.options.xiaobaRetryLimit);
      appendJsonl(input.summaryPath, {
        turn: input.turn,
        timestamp: new Date().toISOString(),
        event: retry ? 'xiaoba_retry' : 'xiaoba_retry_exhausted',
        session: input.managed.name,
        attempt: attempt + 1,
        reason: 'exception',
        error: String(error?.message || error || 'unknown error'),
      });
      if (!retry) throw error;
      const delayMs = retryDelayMs(attempt, input.options);
      console.log(`[sim] XiaoBa turn threw; retrying turn ${input.turn}, attempt ${attempt + 2} after ${delayMs}ms: ${oneLine(error?.message || error, 220)}`);
      await sleep(delayMs);
      attempt++;
    }
  }
}

async function chooseNextUserMessageWithRetry(input: {
  director: any;
  directorPrompt: string;
  options: SimOptions;
  turn: number;
  sessions: string[];
  currentSession: string;
  history: SimTurnRecord[];
  summaryPath: string;
}): Promise<DirectorChoice> {
  let attempt = 0;
  while (true) {
    try {
      return await chooseNextUserMessage(input);
    } catch (error: any) {
      const retry = shouldRetryAttempt(attempt, input.options.directorRetryLimit);
      appendJsonl(input.summaryPath, {
        turn: input.turn,
        timestamp: new Date().toISOString(),
        event: retry ? 'director_retry' : 'director_retry_exhausted',
        attempt: attempt + 1,
        error: String(error?.message || error || 'unknown error'),
      });
      if (!retry) throw error;
      const delayMs = retryDelayMs(attempt, input.options);
      console.log(`[sim] director failed; retrying next-message generation, attempt ${attempt + 2} after ${delayMs}ms: ${oneLine(error?.message || error, 220)}`);
      await sleep(delayMs);
      attempt++;
    }
  }
}

function shouldRetryAttempt(attempt: number, limit: number | null): boolean {
  return limit === null || attempt < limit;
}

function retryDelayMs(attempt: number, options: SimOptions): number {
  const base = Math.max(0, options.retryInitialDelayMs);
  const max = Math.max(base, options.retryMaxDelayMs);
  if (base === 0) return 0;
  const exponential = base * Math.pow(2, Math.min(attempt, 8));
  const jitter = Math.floor(Math.random() * Math.min(1000, Math.max(1, base)));
  return Math.min(max, exponential + jitter);
}

function createSimLocalDeviceGrant(executionScope: any, options: SimOptions): Record<string, unknown> {
  const actorUserId = String(executionScope?.actorUserId || options.actorUserId || 'sim_user');
  const agentId = String(executionScope?.agentId || options.agentId || 'sim_agent');
  return {
    kind: 'catscompany_body',
    source: 'catscompany',
    ownerUserId: actorUserId,
    bodyId: String(executionScope?.agentBodyId || `sim-body-${agentId}`),
    installationId: `sim-installation-${agentId}`,
    deviceId: `sim-device-${actorUserId}`,
    capabilities: ['read_file', 'glob', 'grep', 'execute_shell', 'browser_control'],
    createdAt: Date.now(),
  };
}

function createAgentBrowserAutoApprover(): (request: any) => Promise<boolean | { approved: boolean; reason?: string }> {
  return async (request: any) => {
    const toolName = String(request?.toolName || '');
    const command = toolArgString(request?.args, 'command')
      || toolArgString(request?.args, 'cmd')
      || toolArgString(request?.args, 'script');
    if (toolName === 'execute_shell' && isAllowedAgentBrowserShellCommand(command)) {
      return true;
    }
    return {
      approved: false,
      reason: 'Simulation auto-approval is limited to npx agent-browser shell commands, with optional echo separators.',
    };
  };
}

function installAgentBrowserShellGuard(toolManager: any, options: SimOptions): void {
  if (!options.autoApproveAgentBrowser) return;
  if (!toolManager || typeof toolManager.executeTool !== 'function') return;
  const originalExecuteTool = toolManager.executeTool.bind(toolManager);
  toolManager.executeTool = async (toolCall: any, conversationHistory?: any[], contextOverrides?: Record<string, unknown>) => {
    const rawName = String(toolCall?.function?.name || '');
    if (isShellToolName(rawName)) {
      const args = parseToolCallArguments(toolCall);
      const command = toolArgString(args, 'command')
        || toolArgString(args, 'cmd')
        || toolArgString(args, 'script');
      if (!isAllowedAgentBrowserShellCommand(command)) {
        return {
          tool_call_id: toolCall?.id,
          role: 'tool',
          name: rawName,
          content: 'Simulation blocked execute_shell: only npx agent-browser commands with optional echo separators are allowed.',
          ok: false,
          errorCode: 'SIM_SHELL_GUARD',
          retryable: false,
        };
      }
    }
    return originalExecuteTool(toolCall, conversationHistory, contextOverrides);
  };
}

function isShellToolName(name: string): boolean {
  return ['execute_shell', 'Bash', 'bash', 'Shell', 'shell', 'execute_bash'].includes(name);
}

function parseToolCallArguments(toolCall: any): unknown {
  const raw = toolCall?.function?.arguments;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isAllowedAgentBrowserShellCommand(command: string): boolean {
  const text = command.trim();
  if (!text) return false;
  if (/[|`<>]/.test(text)) return false;
  const parts = text.split(/\s*(?:&&|;)\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(part => (
    /^npx(?:\.cmd)?\s+agent-browser(?:\s|$)/i.test(part)
    || /^echo\s+["']?[A-Za-z0-9_.:| -]+["']?$/i.test(part)
  ));
}

function toolArgString(args: unknown, key: string): string {
  if (!args || typeof args !== 'object') return '';
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function snapshotSessionMessages(session: any): any[] {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return deepClone(messages);
}

function restoreSessionMessages(session: any, snapshot: any[]): void {
  if (!session) return;
  session.messages = deepClone(snapshot);
  try {
    session.lifecycleManager?.saveContext?.(session.messages);
  } catch {
    // Best-effort cleanup: retry correctness should not depend on persistence cleanup.
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDirectorChoice(text: string): DirectorChoice {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Director did not return JSON: ${oneLine(text, 300)}`);
  }
}

function trimHistory(history: SimTurnRecord[], maxChars: number): SimTurnRecord[] {
  const selected: SimTurnRecord[] = [];
  let used = 2;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = compactTurn(history[i]);
    const size = JSON.stringify(item).length + 2;
    if (selected.length > 0 && used + size > maxChars) break;
    selected.unshift(item);
    used += size;
  }
  return selected;
}

function compactTurn(turn: SimTurnRecord): SimTurnRecord {
  return {
    ...turn,
    user: truncateText(turn.user, 1800),
    assistant: truncateText(turn.assistant, 2600),
  };
}

function collectTurnLogEvents(runRoot: string, sessionKey: string, startedAt: Date): Record<string, unknown> {
  const logsRoot = path.join(runRoot, 'logs', 'sessions', 'catscompany');
  const since = startedAt.getTime();
  const events = {
    branchRuntimeEvents: 0,
    memorySearchCalls: 0,
    memoryReadCalls: 0,
    memoryNeighborCalls: 0,
    finishCalls: 0,
    injections: 0,
    dropped: 0,
    lifecycleInjected: 0,
    lifecycleDropped: 0,
  };
  if (!fs.existsSync(logsRoot)) return events;
  for (const file of listJsonlFiles(logsRoot)) {
    const content = safeReadFile(file);
    if (!content.includes(sessionKey)) continue;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.session_id !== sessionKey) continue;
      const ts = Date.parse(entry.timestamp || '');
      if (!Number.isFinite(ts) || ts < since) continue;
      if (entry.entry_type !== 'runtime') continue;
      const message = String(entry.message || '');
      if (message.includes('[branch:memory:')) events.branchRuntimeEvents++;
      if (message.includes('执行工具: memory_search')) events.memorySearchCalls++;
      if (message.includes('执行工具: memory_read_turn')) events.memoryReadCalls++;
      if (message.includes('执行工具: memory_neighbors')) events.memoryNeighborCalls++;
      if (message.includes('执行工具: finish_memory_search')) events.finishCalls++;
      if (message.includes('injected') && message.includes('synthetic runtime observation')) events.injections++;
      if (message.includes('dropped') && message.includes('synthetic runtime observation')) events.dropped++;
      if (entry.event?.type === 'synthetic_observation_lifecycle') {
        const outcome = String(entry.event?.payload?.outcome || '');
        if (outcome === 'injected') events.lifecycleInjected++;
        if (outcome === 'dropped') events.lifecycleDropped++;
      }
    }
  }
  return events;
}

function listJsonlFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(full);
    }
  }
  return result;
}

function resolveProfile(xiaoba: LoadedXiaoBa, options: SimOptions): any {
  const resolved = xiaoba.resolveRuntimeProfileFromConfig({
    surface: 'catscompany',
    workingDirectory: options.workingDirectory || options.runtimeRoot,
    tools: options.targetTools,
    skillsEnabled: options.loadSkills,
  }).profile;
  return {
    ...resolved,
    surface: 'catscompany',
    workingDirectory: path.resolve(options.workingDirectory || options.runtimeRoot),
  };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key.startsWith('no-')) {
      result[key.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i++;
  }
  return result;
}

function normalizeOptions(raw: Record<string, string | boolean>, launchCwd: string): SimOptions {
  const resolveFromLaunch = (value: string): string => {
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(launchCwd, value);
  };
  const xiaobaRoot = resolveFromLaunch(String(raw['xiaoba-root'] || process.env.XIAOBA_ROOT || launchCwd));
  if (!fs.existsSync(path.join(xiaobaRoot, 'src', 'core', 'agent-session.ts'))) {
    throw new Error(`--xiaoba-root does not look like a XiaoBa checkout: ${xiaobaRoot}`);
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runRoot = resolveFromLaunch(String(raw['run-root'] || path.join(xiaobaRoot, '.dev-user-data', 'sim-runs', `memory-branch-${runId}`)));
  const runtimeRoot = raw['runtime-root']
    ? resolveFromLaunch(String(raw['runtime-root']))
    : runRoot;
  const sessions = String(raw.sessions || raw.session || 'sim_group_a')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const initialSession = String(raw.session || sessions[0] || 'sim_group_a').trim();
  const autoApproveAgentBrowser = raw['auto-approve-agent-browser'] === true;
  const catscoLocalOwnerSelf = raw['catsco-local-owner-self'] === true || autoApproveAgentBrowser;

  return {
    xiaobaRoot,
    turns: numberOption(raw.turns, 12),
    runRoot,
    runtimeRoot,
    workingDirectory: raw['working-dir'] ? resolveFromLaunch(String(raw['working-dir'])) : undefined,
    sessions: sessions.length > 0 ? sessions : [initialSession],
    initialSession,
    allowNewSessions: raw['allow-new-sessions'] !== false,
    topic: String(raw.topic || 'Long multi-session Chinese conversation for testing XiaoBa memory retrieval.'),
    seedMessage: String(raw.seed || DEFAULT_SEED_MESSAGE),
    directorPromptPath: raw['director-prompt'] ? resolveFromLaunch(String(raw['director-prompt'])) : undefined,
    xiaobaSystemPromptPath: raw['xiaoba-system-prompt'] ? resolveFromLaunch(String(raw['xiaoba-system-prompt'])) : undefined,
    envFile: resolveEnvFile(raw['env-file'], xiaobaRoot, launchCwd),
    modelSource: parseModelSource(raw['model-source']),
    directorModel: raw['director-model'] ? String(raw['director-model']) : undefined,
    directorProvider: raw['director-provider'] === 'anthropic' || raw['director-provider'] === 'openai'
      ? raw['director-provider']
      : undefined,
    directorApiUrl: raw['director-api-url'] ? String(raw['director-api-url']) : undefined,
    directorTemperature: raw['director-temperature'] !== undefined
      ? Number(raw['director-temperature'])
      : 0.8,
    maxDirectorContextChars: numberOption(raw['max-director-context-chars'], 14000),
    agentId: String(raw['agent-id'] || 'sim_agent'),
    actorUserId: String(raw['user-id'] || 'sim_user'),
    loadSkills: raw.skills === undefined ? undefined : raw.skills !== false,
    targetTools: parseTargetTools(raw['target-tools']),
    stopOnXiaobaError: raw['stop-on-xiaoba-error'] !== false,
    xiaobaRetryLimit: parseRetryLimit(raw['xiaoba-retry-limit'], null),
    directorRetryLimit: parseRetryLimit(raw['director-retry-limit'], null),
    retryInitialDelayMs: numberOption(raw['retry-initial-ms'], 2000),
    retryMaxDelayMs: numberOption(raw['retry-max-ms'], 60000),
    catscoLocalOwnerSelf,
    autoApproveAgentBrowser,
    verbose: raw.verbose === true,
  };
}

function validateSimSafetyOptions(options: SimOptions): void {
  if (!options.catscoLocalOwnerSelf) return;
  if (!options.targetTools) {
    throw new Error('--catsco-local-owner-self requires an explicit --target-tools allowlist.');
  }
  const disallowed = new Set([
    'write_file',
    'edit_file',
    'send_file',
    'spawn_subagent',
    'share_skillhub_skill',
  ]);
  const unsafe = options.targetTools.filter(tool => disallowed.has(tool));
  if (unsafe.length > 0) {
    throw new Error(`--catsco-local-owner-self cannot be used with mutating tools: ${unsafe.join(', ')}`);
  }
  if (options.targetTools.includes('execute_shell') && !options.autoApproveAgentBrowser) {
    throw new Error('--catsco-local-owner-self with execute_shell requires --auto-approve-agent-browser.');
  }
}

function parseModelSource(value: string | boolean | undefined): 'env' | 'custom' | 'relay' {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text || text === 'env' || text === 'current') return 'env';
  if (text === 'custom') return 'custom';
  if (text === 'relay') return 'relay';
  throw new Error(`--model-source must be one of: env, custom, relay. Received: ${value}`);
}

function parseRetryLimit(value: string | boolean | undefined, fallback: number | null): number | null {
  if (value === undefined || value === true) return fallback;
  const text = String(value).trim().toLowerCase();
  if (!text || text === 'infinite' || text === 'inf' || text === 'forever') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Retry limit must be a non-negative number or "infinite". Received: ${value}`);
  }
  return Math.floor(parsed);
}

function resolveEnvFile(value: string | boolean | undefined, xiaobaRoot: string, launchCwd: string): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(launchCwd, value);
  }
  const existing = process.env.DOTENV_CONFIG_PATH?.trim();
  if (existing) {
    return path.isAbsolute(existing) ? path.resolve(existing) : path.resolve(launchCwd, existing);
  }
  const targetEnv = path.join(xiaobaRoot, '.env');
  return fs.existsSync(targetEnv) ? targetEnv : undefined;
}

function applyEnvFileOption(options: SimOptions, explicit: boolean): void {
  if (!options.envFile) return;
  if (!fs.existsSync(options.envFile)) {
    if (explicit) {
      throw new Error(`--env-file does not exist: ${options.envFile}`);
    }
    return;
  }
  process.env.DOTENV_CONFIG_PATH = options.envFile;
  const loaded = loadEnvFile(options.envFile);
  for (const [key, value] of Object.entries(loaded)) {
    process.env[key] = value;
  }
}

function applyXiaoBaModelSource(options: SimOptions): void {
  if (options.modelSource === 'env') return;

  const prefix = options.modelSource === 'custom'
    ? 'CATSCO_CUSTOM_LLM'
    : 'CATSCO_RELAY_LLM';
  const provider = readNonEmptyEnv(`${prefix}_PROVIDER`);
  const apiUrl = readNonEmptyEnv(`${prefix}_API_BASE`);
  const model = readNonEmptyEnv(`${prefix}_MODEL`);
  const apiKey = readNonEmptyEnv(`${prefix}_API_KEY`);
  const missing = [
    !provider && `${prefix}_PROVIDER`,
    !apiUrl && `${prefix}_API_BASE`,
    !model && `${prefix}_MODEL`,
    !apiKey && `${prefix}_API_KEY`,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `--model-source ${options.modelSource} is incomplete. Missing: ${missing.join(', ')}. `
      + `Open XiaoBa Dashboard settings and save the ${options.modelSource} model config first.`,
    );
  }
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`${prefix}_PROVIDER must be "anthropic" or "openai"; got "${provider}".`);
  }

  process.env.CATSCO_MODEL_SOURCE = options.modelSource;
  process.env.GAUZ_LLM_PROVIDER = provider;
  process.env.GAUZ_LLM_API_BASE = apiUrl;
  process.env.GAUZ_LLM_MODEL = model;
  process.env.GAUZ_LLM_API_KEY = apiKey;
}

function readNonEmptyEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function loadEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = normalized.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function parseTargetTools(value: string | boolean | undefined): string[] | undefined {
  if (value === undefined || value === true) return undefined;
  const text = String(value).trim();
  if (!text || text === 'default') return undefined;
  if (text === 'none') return [];
  if (text === 'agent-browser') {
    return [
      'read_file',
      'glob',
      'grep',
      'resolve_common_directory',
      'execute_shell',
      'send_text',
      'update_plan',
      'record_decision',
      'skill',
    ];
  }
  if (text === 'safe') {
    return [
      'read_file',
      'glob',
      'grep',
      'resolve_common_directory',
      'execute_shell',
      'send_text',
      'check_subagent',
      'stop_subagent',
      'resume_subagent',
      'update_plan',
      'record_decision',
      'skill',
    ];
  }
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function isXiaoBaErrorReply(text: string): boolean {
  const normalized = String(text || '').trim();
  return normalized === XIAOBA_ERROR_REPLY
    || normalized.includes('刚才处理出了点问题')
    || normalized.includes('服务临时异常')
    || normalized.includes('请求没有完成')
    || normalized.includes('稍后重试')
    || normalized.includes('临时切换到其他模型');
}

function numberOption(value: string | boolean | undefined, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function appendJsonl(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n...[truncated ${text.length - maxChars} chars]\n`;
  return text.slice(0, Math.max(0, maxChars - marker.length)) + marker;
}

function oneLine(text: string, maxChars: number): string {
  return truncateText(String(text || '').replace(/\s+/g, ' ').trim(), maxChars);
}

function fallbackUserMessage(turn: number): string {
  if (turn % 4 === 0) {
    return '基于前面所有已经确定的信息，帮我检查一下有没有遗漏，并整理成下一步执行清单。';
  }
  if (turn % 5 === 0) {
    return '我们先换个相关小话题：如果要把这个方案变得更适合实际执行，你觉得最需要先确认哪三件事？';
  }
  return '继续沿着刚才的方向推进，但请结合前面已经聊过的约束，不要重新开始。';
}

function printHelp(): void {
  console.log(`
Usage:
  <xiaoba-root>\\node_modules\\.bin\\tsx.cmd <sim-root>\\run-memory-branch-sim.ts --xiaoba-root <xiaoba-root> [options]

Standalone core-level XiaoBa memory branch simulation.
It does not send messages to CatsCo web and does not modify the XiaoBa repo.

Options:
  --xiaoba-root <path>                Target XiaoBa checkout. Default: XIAOBA_ROOT or cwd.
  --turns <n>                         Number of XiaoBa turns. Default: 12.
  --run-root <path>                   Isolated output/log root. Default: <xiaoba-root>\\.dev-user-data\\sim-runs\\...
  --runtime-root <path>               XiaoBa runtime/log/data root. Default: run root.
  --working-dir <path>                XiaoBa tool working directory. Default: runtime root.
  --session <name>                    Initial session/group name. Default: sim_group_a.
  --sessions <a,b,c>                  Sessions the director can choose from.
  --allow-new-sessions / --no-allow-new-sessions
  --topic <text>                      Director-level scenario topic.
  --seed <text>                       First user message.
  --env-file <path>                   Env file for XiaoBa model config. Default: <xiaoba-root>\\.env when present.
  --model-source <env|custom|relay>   Model source from XiaoBa env. Default: env/current.
  --director-prompt <path>            Override external user-simulator system prompt.
  --xiaoba-system-prompt <path>       Override XiaoBa system prompt for this run only.
  --director-model <model>            Override director model.
  --director-provider <openai|anthropic>
  --director-api-url <url>
  --director-temperature <n>          Default: 0.8.
  --max-director-context-chars <n>    Final-answer-only context budget. Default: 14000.
  --target-tools <default|safe|agent-browser|none|a,b,c>
  --catsco-local-owner-self           Simulate trusted CatsCo local-owner execution context.
                                      Requires explicit non-mutating --target-tools.
  --auto-approve-agent-browser        Auto-approve npx agent-browser execute_shell commands, with optional echo separators.
                                      Also enables --catsco-local-owner-self for this simulation process.
  --stop-on-xiaoba-error / --no-stop-on-xiaoba-error
  --xiaoba-retry-limit <n|infinite>   Retries for XiaoBa generic-error/throwing turns. Default: infinite.
  --director-retry-limit <n|infinite> Retries for director generation. Default: infinite.
  --retry-initial-ms <n>              Initial retry delay. Default: 2000.
  --retry-max-ms <n>                  Maximum retry delay. Default: 60000.
  --skills / --no-skills
  --verbose

Examples:
  <xiaoba-root>\\node_modules\\.bin\\tsx.cmd <sim-root>\\run-memory-branch-sim.ts --xiaoba-root <xiaoba-root> --turns 20 --sessions sim_a,sim_b
  <xiaoba-root>\\node_modules\\.bin\\tsx.cmd <sim-root>\\run-memory-branch-sim.ts --xiaoba-root <xiaoba-root> --session dinner_test --target-tools safe
`);
}

main().catch(error => {
  console.error('[sim] failed:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
