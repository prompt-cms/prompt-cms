// Step 14 canned-suite driver: runs the 5 prompts against the live server and
// evaluates the measurable pass criteria from PLAN.md.
const BASE = 'http://localhost:8787/chat';

const PROMPTS = [
  'Build me a dashboard for server metrics',
  'Create a login form with username and password fields',
  'Add a status card showing CPU usage to the dashboard', // follow-up to 1
  'Make a settings page with a theme choice picker',
  'Show a list of three sample users with names and emails',
];

function msg(id, role, content) {
  return { id, role, content };
}

async function run(threadId, runId, messages) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, runId, messages }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const raw = await res.text();
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()));
    } catch {
      /* ignore keep-alive or partial frames */
    }
  }
  return events;
}

function summarize(label, events) {
  const types = events.map((e) => e.type);
  const finished = types.includes('RUN_FINISHED');
  const errored = types.includes('RUN_ERROR');
  const toolStarts = types.filter((t) => t === 'TOOL_CALL_START').length;
  const snapshots = events.filter((e) => e.type === 'ACTIVITY_SNAPSHOT');
  const ops = snapshots.flatMap((s) => s.content?.operations ?? []);
  const opKinds = ops.map((o) => Object.keys(o).find((k) => k !== 'version'));
  const surfaceIds = [
    ...new Set(
      ops
        .map((o) => o.createSurface?.surfaceId ?? o.updateComponents?.surfaceId ?? o.updateDataModel?.surfaceId)
        .filter(Boolean),
    ),
  ];
  const text = events
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => e.delta)
    .join('');
  return { label, finished, errored, toolStarts, snapshotCount: snapshots.length, opKinds, surfaceIds, textPreview: text.slice(0, 120) };
}

const results = [];

// Prompt 1 — fresh thread, keep history for the follow-up.
const t1 = 'suite-thread';
const e1 = await run(t1, 'r1', [msg('m1', 'user', PROMPTS[0])]);
results.push(summarize('P1 dashboard', e1));
const asst1 = e1.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta).join('');

// The real CopilotKit client sends the full thread back, including activity
// messages. Reconstruct the a2ui-surface activity message from P1's snapshot.
const snap1 = e1.find((e) => e.type === 'ACTIVITY_SNAPSHOT');
const activity1 = snap1
  ? {
      id: snap1.messageId ?? 'act-1',
      role: 'activity',
      activityType: 'a2ui-surface',
      content: snap1.content,
    }
  : null;

// Prompt 2 — fresh thread.
const e2 = await run('suite-thread-2', 'r2', [msg('m2', 'user', PROMPTS[1])]);
results.push(summarize('P2 login form', e2));

// Prompt 3 — follow-up on thread 1 with prior history (incl. the activity
// message, as the real client sends it).
const e3 = await run(t1, 'r3', [
  msg('m1', 'user', PROMPTS[0]),
  msg('a1', 'assistant', asst1 || '(built dashboard)'),
  ...(activity1 ? [activity1] : []),
  msg('m3', 'user', PROMPTS[2]),
]);
results.push(summarize('P3 follow-up', e3));

// Prompt 4 — fresh thread.
const e4 = await run('suite-thread-4', 'r4', [msg('m4', 'user', PROMPTS[3])]);
results.push(summarize('P4 settings', e4));

// Prompt 5 — fresh thread.
const e5 = await run('suite-thread-5', 'r5', [msg('m5', 'user', PROMPTS[4])]);
results.push(summarize('P5 user list', e5));

console.log('=== Step 14 canned suite results ===');
for (const r of results) {
  console.log(`\n${r.label}:`);
  console.log(`  RUN_FINISHED: ${r.finished}  RUN_ERROR: ${r.errored}  TOOL_CALL_START: ${r.toolStarts}`);
  console.log(`  ACTIVITY_SNAPSHOTs: ${r.snapshotCount}`);
  console.log(`  op kinds: ${r.opKinds.join(', ') || '(none)'}`);
  console.log(`  surfaceIds: ${r.surfaceIds.join(', ') || '(none)'}`);
  console.log(`  text: ${r.textPreview.replace(/\n/g, ' ')}`);
}

const allFinished = results.every((r) => r.finished && !r.errored);
const firstTry = results.filter((r) => r.toolStarts === 1 && r.snapshotCount >= 1).length;
// Criterion 3: the follow-up must target the SAME surfaceId P1 created.
const p1Surface = results[0].surfaceIds[0];
const followUpUpdated =
  p1Surface !== undefined &&
  results[2].surfaceIds.length > 0 &&
  results[2].surfaceIds.every((id) => id === p1Surface) &&
  results[2].opKinds.some((k) => k === 'updateComponents' || k === 'updateDataModel');

console.log('\n=== Pass criteria ===');
console.log(`1. All 5 runs finished without error: ${allFinished ? 'PASS' : 'FAIL'}`);
console.log(`2. Valid A2UI first-try (1 tool call + snapshot): ${firstTry}/5 — need ≥4: ${firstTry >= 4 ? 'PASS' : 'FAIL'}`);
console.log(`3. Follow-up updates existing surface (same surfaceId "${p1Surface}"): ${followUpUpdated ? 'PASS' : 'FAIL'}`);
console.log('4. Button round-trip: browser-only — defer to manual check');
