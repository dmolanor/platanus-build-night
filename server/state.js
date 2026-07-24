// Estado en memoria, indexado por token. Sin base de datos. TTL 2h.
// CONTRACT.md §1 y §4 son la fuente de verdad de umbrales y forma de los mensajes.

import { randomBytes } from 'node:crypto';

// 12h para que la deuda te espere de un día para otro. El estado vive en memoria,
// así que un redeploy la borra igual: no prometemos más de lo que damos.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Sin eventos en NINGUNA sesión por este tiempo, no estás distraído: estás fuera
// (almuerzo, casa, dormido). La deuda se CONGELA —no se borra— y nos callamos.
// Nadie a quien intervenir en una silla vacía. El peaje te cobra al volver.
const AWAY_MS = 30 * 60 * 1000;

// Mucho más tarde: la sesión está abandonada de verdad (terminal cerrada, máquina
// apagada). Ahí sí deja de contar, porque ya no hay nadie esperando.
const STALE_MS = 4 * 60 * 60 * 1000;

export const NUDGE_MS = 2 * 60 * 1000;
export const ANGRY_MS = 5 * 60 * 1000;
export const TOLL_MS = 10 * 60 * 1000;

// Estados que acumulan deuda: el agente terminó o está trabado y TE espera.
const DEBT_STATUSES = new Set(['waiting', 'done']);

const TOKENS = new Map();

// El token es la ÚNICA credencial y autoriza aprobar comandos en la máquina de alguien.
// Tiene que ser impredecible: CSPRNG, no Math.random.
export function newToken() {
  return 'p_' + randomBytes(18).toString('base64url');
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
      subagents: 0,
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

    // La señal más limpia de "el humano volvió y está en el teclado".
    // Sin esto, una sesión donde Claude responde sin usar herramientas se queda
    // marcada como `done` y acumula deuda fantasma: el número se infla y la
    // métrica deja de ser defendible.
    case 'UserPromptSubmit':
      setStatus(s, 'working', null);
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

    // Los subagentes multiplican la deuda: si una sesión con 3 subagentes te espera,
    // no tienes 1 agente parado, tienes 4. Eso es lo que significa "agent-minutos".
    case 'SubagentStart':
      s.subagents++;
      break;

    case 'SubagentStop':
      s.subagents = Math.max(0, s.subagents - 1);
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
  if (!t) {
    return {
      totalWaitedMs: 0, level: 'calm', agentesParados: 0, clock: 1, presence: 'here',
      cost: { idleUsd: 0, rateUsdHour: Number(process.env.PEAJE_DEV_RATE_USD || 60), loopSessions: 0 },
      sessions: [], permits: [], speak: null,
    };
  }

  // ¿Hay alguien en el teclado? Cualquier evento en cualquier sesión cuenta.
  const lastActivity = t.lastEventAt || 0;
  const away = now - lastActivity > AWAY_MS;
  // Estando fuera, el reloj se detiene donde estaba: la deuda queda congelada
  // esperándote, en vez de crecer toda la noche o borrarse.
  const clockNow = away ? lastActivity + AWAY_MS : now;

  const sessions = [];
  let total = 0;
  for (const s of t.sessions.values()) {
    const stale = now - s.lastEventAt > STALE_MS;
    const status = stale ? 'stale' : s.status;
    const waitedMs = stale ? 0 : waitedMsFor(t, s, clockNow);
    // Una sesión parada con N subagentes tiene N+1 agentes parados.
    const blockedAgents = stale ? 0 : 1 + (s.subagents || 0);
    total += waitedMs * blockedAgents;
    sessions.push({
      blockedAgents,
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

  // Dos costos distintos, y la diferencia importa:
  //  - Esperar NO quema tokens. Un agente bloqueado cuesta 0. Lo que pierdes es
  //    capacidad paralela: costo de oportunidad, con el supuesto de tarifa a la vista.
  //  - Dar vueltas en loop SÍ quema tokens de verdad. Eso es plata literal.
  // Decir "X dólares de cómputo parado" sería falso y se cae con una pregunta.
  const rateUsdHour = Number(process.env.PEAJE_DEV_RATE_USD || 60);
  const idleCostUsd = (total / 3_600_000) * rateUsdHour;
  const loopSessions = sessions.filter((s) => s.loopCount >= 1).length;

  const level = levelFor(total);

  // Agentes realmente parados AHORA. Es la frase que el humano entiende sin traducir.
  const agentesParados = sessions
    .filter((s) => s.status === 'waiting' || s.status === 'done')
    .reduce((n, s) => n + s.blockedAgents, 0);

  return {
    totalWaitedMs: total,
    level,
    agentesParados,
    presence: away ? 'away' : 'here',
    clock: t.demoSpeed || 1,
    cost: { idleUsd: Math.round(idleCostUsd * 100) / 100, rateUsdHour, loopSessions },
    sessions,
    permits: [],
    // Estando fuera no hablamos: no hay nadie oyendo, y gritarle a una silla vacía
    // a las 3am es exactamente lo que haría un dashboard más.
    speak: away ? null : speakFor(t, level, total, sessions),
  };
}

// La voz es el escalón de 5–10 min de la escalera, no un extra.
// El texto se fija al ENTRAR a un nivel y no cambia mientras sigas ahí: así el
// widget lo dice una vez y no repite. Con token de equipo, todos oyen lo mismo.
function speakFor(t, level, total, sessions) {
  if (t.speakLevel === level) return t.speakText || null;
  t.speakLevel = level;

  if (level === 'calm') {
    t.speakText = null;
  } else {
    const min = Math.round(total / 60000);
    const parados = sessions
      .filter((s) => s.status === 'waiting' || s.status === 'done')
      .reduce((n, s) => n + s.blockedAgents, 0);
    if (level === 'nudge') {
      t.speakText = `${parados} agentes llevan ${min} minutos esperándote.`;
    } else if (level === 'angry') {
      t.speakText = `${min} agent-minutos parados. Eso lo estás costando tú.`;
    } else {
      t.speakText = `Peaje. Les debes ${min} agent-minutos. No sigues hasta saldarlo.`;
    }
  }
  return t.speakText;
}

// CONTRACT.md §6 — fallback determinista. Se construye ANTES que la IA y nunca se apaga.
const REASON_WEIGHT = { permission: 3.0, needs_input: 2.5, failed: 2.0, completed: 1.5, idle: 1.0 };

export function score(s) {
  const w = REASON_WEIGHT[s.reason] || 1.0;
  return s.waitedMs * (s.blockedAgents || 1) * w * (1 + (s.loopCount || 0));
}

export function resetDebt(token) {
  const t = TOKENS.get(token);
  if (!t) return;
  const now = Date.now();
  for (const s of t.sessions.values()) s.since = now;
  t.spoken.clear();
}

// `ramp`: arranca la deuda en cero para que el contador SUBA en vivo y se vea la
// escalada calm → nudge → angry → toll. Sin esto la demo aparece ya en peaje y se
// salta el arco entero, que es justo el beat del pitch ("12... 30... 47").
export function startDemo(token, speed, ramp = false) {
  const t = getToken(token);
  t.demoSpeed = speed;
  t.sessions.clear();
  t.spoken.clear();
  const now = Date.now();
  const seed = [
    { sessionId: 'demo-auth', repo: 'buk-api', who: 'diego', status: 'waiting', reason: 'permission',
      lastMessage: 'Quiero borrar db/migrations/ para regenerarlas desde cero.', loopCount: 0, subagents: 0, ageS: 40 },
    { sessionId: 'demo-checkout', repo: 'buk-api', who: 'diego', status: 'done', reason: 'completed',
      lastMessage: 'Listo. PR #212 abierto, solo falta que lo confirmes.', loopCount: 0, subagents: 0, ageS: 15 },
    { sessionId: 'demo-ui', repo: 'buk-web', who: 'sofía', status: 'waiting', reason: 'needs_input',
      lastMessage: 'Sigo viendo el mismo error de hidratación. Intento otra vez.', loopCount: 3, subagents: 3, ageS: 70 },
    { sessionId: 'demo-infra', repo: 'buk-infra', who: 'diego', status: 'working', reason: null,
      lastMessage: null, loopCount: 0, subagents: 0, ageS: 5 },
  ];
  for (const d of seed) {
    t.sessions.set(d.sessionId, {
      sessionId: d.sessionId, repo: d.repo, who: d.who, status: d.status, reason: d.reason,
      since: now - (ramp ? 0 : d.ageS * 1000), lastMessage: d.lastMessage, loopCount: d.loopCount,
      subagents: d.subagents, tasksOpen: 0, tasksDone: 0, lastTask: null,
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
