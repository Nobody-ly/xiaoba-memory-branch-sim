#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runRoot = path.resolve(String(args['run-root'] || args._?.[0] || process.cwd()));
const runtimeRoot = args['runtime-root'] ? path.resolve(String(args['runtime-root'])) : runRoot;

if (!fs.existsSync(runRoot)) {
  console.error(`[analyze] run root does not exist: ${runRoot}`);
  process.exit(1);
}

const summaryFiles = listFiles(runRoot, file => path.basename(file) === 'sim-summary.jsonl');
const summaryRecords = summaryFiles.flatMap(file => readJsonl(file).map(record => ({ file, record })));
const completedTurns = summaryRecords.filter(({ record }) => record && typeof record.turn === 'number' && !record.event && typeof record.assistant === 'string');
const eventRecords = summaryRecords.filter(({ record }) => record?.event);
const sessions = new Set(completedTurns.map(({ record }) => record.session).filter(Boolean));
const latest = completedTurns[completedTurns.length - 1]?.record;

const totals = {
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

for (const { record } of completedTurns) {
  const logEvents = record.logEvents || {};
  for (const key of Object.keys(totals)) {
    totals[key] += Number(logEvents[key] || 0);
  }
}

const logRoots = uniquePaths([
  path.join(runRoot, 'logs'),
  path.join(runRoot, 'runtime', 'logs'),
  path.join(runtimeRoot, 'logs'),
].filter(p => fs.existsSync(p)));

const lifecycle = {
  published: 0,
  injected: 0,
  dropped: 0,
  cancelled: 0,
  suppressed: 0,
};
const branchToolCalls = {
  memory_search: 0,
  memory_read_turn: 0,
  memory_neighbors: 0,
  finish_memory_search: 0,
};
let runtimeErrors = 0;
let branchLogFiles = 0;

for (const root of logRoots) {
  const files = listFiles(root, file => file.endsWith('.jsonl') || file.endsWith('.log'));
  branchLogFiles += files.filter(file => file.includes(`${path.sep}branches${path.sep}memory${path.sep}`)).length;
  for (const file of files) {
    const content = safeRead(file);
    if (!content) continue;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const entry = tryJson(line);
      const message = entry ? String(entry.message || '') : line;
      for (const key of Object.keys(branchToolCalls)) {
        if (message.includes(`执行工具: ${key}`) || message.includes(`tool: ${key}`)) {
          branchToolCalls[key] += 1;
        }
      }
      if (/ERROR|failed|失败|异常/i.test(message)) runtimeErrors += 1;
      if (entry?.event?.type === 'synthetic_observation_lifecycle') {
        const outcome = String(entry.event?.payload?.outcome || '');
        if (Object.prototype.hasOwnProperty.call(lifecycle, outcome)) lifecycle[outcome] += 1;
      }
    }
  }
}

console.log('XiaoBa sim run summary');
console.log('======================');
console.log(`Run root: ${runRoot}`);
if (runtimeRoot !== runRoot) console.log(`Runtime root: ${runtimeRoot}`);
console.log(`Summary files: ${summaryFiles.length}`);
for (const file of summaryFiles) console.log(`- ${path.relative(runRoot, file)}`);
console.log('');
console.log(`Completed turns: ${completedTurns.length}`);
console.log(`Sessions: ${Array.from(sessions).join(', ') || '(none)'}`);
console.log(`Events in summary: ${eventRecords.length}`);
console.log(`Retry events: ${eventRecords.filter(({ record }) => String(record.event || '').includes('retry')).length}`);
console.log('');
console.log('Memory/tool counters from sim-summary:');
console.log(`- memory_search: ${totals.memorySearchCalls}`);
console.log(`- memory_read_turn: ${totals.memoryReadCalls}`);
console.log(`- memory_neighbors: ${totals.memoryNeighborCalls}`);
console.log(`- finish_memory_search: ${totals.finishCalls}`);
console.log(`- injected: ${totals.lifecycleInjected || totals.injections}`);
console.log(`- dropped: ${totals.lifecycleDropped || totals.dropped}`);
console.log('');
console.log('Lifecycle counters from logs:');
console.log(`- published: ${lifecycle.published}`);
console.log(`- injected: ${lifecycle.injected}`);
console.log(`- dropped: ${lifecycle.dropped}`);
console.log(`- cancelled: ${lifecycle.cancelled}`);
console.log(`- suppressed: ${lifecycle.suppressed}`);
console.log('');
console.log('Branch log scan:');
console.log(`- branch log files: ${branchLogFiles}`);
console.log(`- memory_search: ${branchToolCalls.memory_search}`);
console.log(`- memory_read_turn: ${branchToolCalls.memory_read_turn}`);
console.log(`- memory_neighbors: ${branchToolCalls.memory_neighbors}`);
console.log(`- finish_memory_search: ${branchToolCalls.finish_memory_search}`);
console.log(`- possible runtime error lines: ${runtimeErrors}`);
if (latest) {
  console.log('');
  console.log(`Latest turn: #${latest.turn} session=${latest.session}`);
  console.log(`User: ${oneLine(latest.user, 220)}`);
  console.log(`XiaoBa: ${oneLine(latest.assistant, 300)}`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function listFiles(root, predicate) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && predicate(full)) result.push(full);
    }
  }
  return result.sort();
}

function readJsonl(file) {
  return safeRead(file)
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => tryJson(line))
    .filter(Boolean);
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function tryJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function uniquePaths(paths) {
  return Array.from(new Set(paths.map(item => path.resolve(item))));
}

function oneLine(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 12))}...[truncated]`;
}
