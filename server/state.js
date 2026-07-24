// Estado en memoria, indexado por token. Sin base de datos. TTL 2h.
// CONTRACT.md §1 y §4 son la fuente de verdad de umbrales y forma de los mensajes.

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

export const NUDGE_MS = 2 * 60 * 1000;
export const ANGRY_MS = 5 * 60 * 1000;
export const TOLL_MS = 10 * 60 * 1000;

// Estados que acumulan deuda: el agente terminó o está trabado y TE espera.
const DEBT_STATUSES = new Set(['waiting', 'done']);

const TOKENS = new Map();

export function newToken() {
  return 'p_' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

export function getToken(token, { create = true } = {}) {
  let t = TOKENS.get(token);
  if (!t && create) {
    t = { token, createdAt: Date.now(), lastEventAt: Date.now(), sessions: new Map(), demoSpeed: 1, spoken: new Set() };
    TOKENS.set(token, t);
  }
  if (t) t.lastEventAt = Date.now();
  return t;
}

export function repoFromCwd(cwd) {
  if (!cwd) return 'sin-repo';
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'sin-repo';
}

function getSession(t, sessionId, payload, who) {
  let s = t.sessions.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      repo: repoFromCwd(payload.cwd),
      who: who || 'yo',
      status: 'working',
      reason: null,
      since: Date.now(),
      lastMessage: null,
      loopCount: 0,
      recentTools: [],
      tasksOpen: 0,
      tasksDone: 0,
      lastTask: null,
      lastEventAt: Date.now(),
    };
    t.sessions.set(sessionId, s);
  }
  if (payload.cwd) s.repo = repoFromCwd(payload.cwd);
  if (who) s.who = who;
  s.lastEventAt = Date.now();
  return s;
}

// Cambiar de estado reinicia el reloj de espera. Repetir el mismo estado no lo reinicia:
// si el agente sigue esperando, la deuda debe seguir subiendo.
function setStatus(s, status, reason) {
  if (s.status !== status || s.reason !== reason) {
    s.status = status;
    s.reason = reason;
    s.since = Date.now();
  }
}

// Firma de una llamada a herramienta, para detectar que el agente se está dando vueltas.
function toolSignature(payload) {
  const i = payload.tool_input || {};
  const arg = i.file_path || i.command || i.pattern || i.path || '';
  return `${payload.tool_name}:${String(arg).slice(0, 120)}`;
}

export function ingest(token, who, payload, kind) {
  const t = getToken(token);
  const sessionId = payload.session_id;
  if (!sessionId) return t;
  const event = payload.hook_event_name;

  if (event === 'SessionEnd') {
    t.sessions.delete(sessionId);
    return t;
  }

  const s = getSession(t, sessionId, payload, who);

  switch (event) {
    case 'SessionStart':
      setStatus(s, 'working', null);
      s.loopCount = 0;
      s.recentTools = [];
      break;

    case 'PostToolUse': {
      setStatus(s, 'working', null);
      const sig = toolSignature(payload);
      s.recentTools.push(sig);
      if (s.recentTools.length > 8) s.recentTools.shift();
      const repeats = s.recentTools.filter((x) => x === sig).length;
      s.loopCount = repeats >= 3 ? repeats - 2 : 0;
      break;
    }

    case 'Stop':
      setStatus(s, 'done', 'completed');
      if (payload.last_assistant_message) s.lastMessage = String(payload.last_assistant_message).slice(0, 600);
      break;

    case 'SubagentStop':
      // El subagente terminó pero la sesión principal sigue: no es deuda todavía.
      setStatus(s, 'working', null);
      break;

    case 'StopFailure':
      setStatus(s, 'waiting', 'failed');
      s.lastMessage = `Falló: ${payload.error_type || 'error desconocido'}`;
      break;

    case 'PermissionRequest':
      setStatus(s, 'waiting', 'permission');
      break;

    // Granularidad de work item, gratis y sin instalar nada (la idea de beads,
    // sin la dependencia de beads): permite decir "lleva 40 min en la misma tarea".
    case 'TaskCreated':
      s.tasksOpen++;
      s.lastTask = payload.task_title || null;
      break;

    case 'TaskCompleted':
      s.tasksOpen = Math.max(0, s.tasksOpen - 1);
      s.tasksDone++;
      s.lastTask = payload.task_title || s.lastTask;
      break;

    case 'Notification': {
      // El matcher no viene en el payload, así que cada matcher usa su propia URL con ?kind=
      const reason = kind === 'completed' ? 'completed' : kind === 'idle' ? 'idle' : 'needs_input';
      setStatus(s, reason === 'completed' ? 'done' : 'waiting', reason);
      if (payload.message) s.lastMessage = String(payload.message).slice(0, 600);
      break;
    }

    default:
      break;
  }

  return t;
}

export function waitedMsFor(t, s, now = Date.now()) {
  if (!DEBT_STATUSES.has(s.status)) return 0;
  return Math.max(0, now - s.since) * (t.demoSpeed || 1);
}

export function levelFor(totalWaitedMs) {
  if (totalWaitedMs >= TOLL_MS) return 'toll';
  if (totalWaitedMs >= ANGRY_MS) return 'angry';
  if (totalWaitedMs >= NUDGE_MS) return 'nudge';
  return 'calm';
}

export function snapshot(token) {
  const t = TOKENS.get(token);
  const now = Date.now();
  if (!t) return { totalWaitedMs: 0, level: 'calm', sessions: [], permits: [], speak: null };

  const sessions = [];
  let total = 0;
  for (const s of t.sessions.values()) {
    const stale = now - s.lastEventAt > STALE_MS;
    const status = stale ? 'stale' : s.status;
    const waitedMs = stale ? 0 : waitedMsFor(t, s, now);
    total += waitedMs;
    sessions.push({
      sessionId: s.sessionId,
      repo: s.repo,
      who: s.who,
      status,
      reason: stale ? null : s.reason,
      since: s.since,
      waitedMs,
      lastMessage: s.lastMessage,
      loopCount: s.loopCount,
      tasksOpen: s.tasksOpen || 0,
      tasksDone: s.tasksDone || 0,
      lastTask: s.lastTask || null,
    });
  }

  sessions.sort((a, b) => score(b) - score(a));
  return { totalWaitedMs: total, level: levelFor(total), sessions, permits: [], speak: null };
}

// CONTRACT.md §6 — fallback determinista. Se construye ANTES que la IA y nunca se apaga.
const REASON_WEIGHT = { permission: 3.0, needs_input: 2.5, failed: 2.0, completed: 1.5, idle: 1.0 };

export function score(s) {
  const w = REASON_WEIGHT[s.reason] || 1.0;
  return s.waitedMs * w * (1 + (s.loopCount || 0));
}

export function resetDebt(token) {
  const t = TOKENS.get(token);
  if (!t) return;
  const now = Date.now();
  for (const s of t.sessions.values()) s.since = now;
  t.spoken.clear();
}

export function startDemo(token, speed) {
  const t = getToken(token);
  t.demoSpeed = speed;
  t.sessions.clear();
  t.spoken.clear();
  const now = Date.now();
  const seed = [
    { sessionId: 'demo-auth', repo: 'buk-api', who: 'diego', status: 'waiting', reason: 'permission',
      lastMessage: 'Quiero borrar db/migrations/ para regenerarlas desde cero.', loopCount: 0, ageS: 40 },
    { sessionId: 'demo-checkout', repo: 'buk-api', who: 'diego', status: 'done', reason: 'completed',
      lastMessage: 'Listo. PR #212 abierto, solo falta que lo confirmes.', loopCount: 0, ageS: 15 },
    { sessionId: 'demo-ui', repo: 'buk-web', who: 'sofía', status: 'waiting', reason: 'needs_input',
      lastMessage: 'Sigo viendo el mismo error de hidratación. Intento otra vez.', loopCount: 3, ageS: 70 },
    { sessionId: 'demo-infra', repo: 'buk-infra', who: 'diego', status: 'working', reason: null,
      lastMessage: null, loopCount: 0, ageS: 5 },
  ];
  for (const d of seed) {
    t.sessions.set(d.sessionId, {
      sessionId: d.sessionId, repo: d.repo, who: d.who, status: d.status, reason: d.reason,
      since: now - d.ageS * 1000, lastMessage: d.lastMessage, loopCount: d.loopCount,
      recentTools: [], lastEventAt: now,
    });
  }
  return t;
}

export function stopDemo(token) {
  const t = TOKENS.get(token);
  if (t) { t.demoSpeed = 1; t.sessions.clear(); t.spoken.clear(); }
}

// Barrido de tokens muertos.
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of TOKENS) if (now - t.lastEventAt > TOKEN_TTL_MS) TOKENS.delete(k);
}, 60_000).unref?.();
