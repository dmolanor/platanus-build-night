// Estado en memoria, indexado por token. Sin base de datos.
// CONTRACT.md §1 y §4 son la fuente de verdad de umbrales y forma de los mensajes.

import { randomBytes } from 'node:crypto';
import { ramaDeSalida, ramaDeComando, refsDe, refsDeRama, anotar } from './refs.js';

// 12h para que la deuda te espere de un día para otro. El estado vive en memoria,
// así que un redeploy la borra igual: no prometemos más de lo que damos.
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Sin eventos en NINGUNA sesión por este tiempo, no estás distraído: estás fuera
// (almuerzo, casa, dormido). La deuda se CONGELA —no se borra— y nos callamos.
// Nadie a quien intervenir en una silla vacía. Pings te avisa al volver.
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
  // Sin token válido no se crea tenant. `tokenOf()` en index.js devuelve '' para
  // cualquier cosa que no tenga el formato de newToken(), así que este guardia
  // cubre TODOS los endpoints de una vez, incluidos los que se agreguen después.
  if (!token) return undefined;
  let t = TOKENS.get(token);
  if (!t && create) {
    t = { token, createdAt: Date.now(), lastEventAt: Date.now(), lastHumanAt: Date.now(),
          sessions: new Map(), demoSpeed: 1, spoken: new Set(), autopilot: false, autoLog: [] };
    TOKENS.set(token, t);
  }
  if (t) t.lastEventAt = Date.now();
  return t;
}

// El humano dio señales de vida: escribió, o decidió un permiso.
export function markHuman(tokenOrObj) {
  const t = typeof tokenOrObj === 'string' ? TOKENS.get(tokenOrObj) : tokenOrObj;
  if (t) t.lastHumanAt = Date.now();
}

export function isAway(token, now = Date.now()) {
  const t = TOKENS.get(token);
  return t ? now - (t.lastHumanAt || 0) > AWAY_MS : false;
}

// Registro de lo que Pings decidió solo. Se muestra al volver: sin auditoría,
// decidir por alguien es abuso.
export function logAuto(token, entry) {
  const t = TOKENS.get(token);
  if (!t) return;
  t.autoLog.unshift({ at: Date.now(), ...entry });
  if (t.autoLog.length > 20) t.autoLog.pop();
}

// Revocación inmediata, sin cuentas. Un secreto que comparten tu máquina y el
// servidor no se puede volver local — pero sí desechable: si se te fue en una
// pantalla o en un QR, lo matas y todo lo que había debajo deja de existir.
export function revocar(token) {
  const habia = TOKENS.has(token);
  TOKENS.delete(token);
  return habia;
}

export function setAutopilot(token, on) {
  const t = getToken(token);
  if (!t) return false;
  t.autopilot = Boolean(on);
  return t.autopilot;
}

export function autopilotOn(token) {
  const t = TOKENS.get(token);
  return Boolean(t && t.autopilot);
}

export function repoFromCwd(cwd) {
  if (!cwd) return 'sin-repo';
  return String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'sin-repo';
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
      touched: new Map(),   // superficie -> cuándo la tocó por última vez
      tasksOpen: 0,
      tasksDone: 0,
      lastTask: null,
      subagents: 0,
      debtMs: 0,            // agent-milisegundos acumulados, ver acumular()
      tickAt: Date.now(),   // hasta cuándo ya se cobró
      title: null,
      lastPrompt: null,
      model: null,
      branch: null,
      refs: new Set(),
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
//
// Pasar de un motivo de espera a OTRO tampoco lo reinicia: `needs_input` → `idle` lo
// dispara el agente cansándose de esperar, no tú volviendo. La sesión nunca dejó de
// esperarte, así que su reloj no puede empezar de cero.
function setStatus(s, status, reason) {
  if (s.status === status && s.reason === reason) return;
  const seguiaEsperando = DEBT_STATUSES.has(s.status) && DEBT_STATUSES.has(status);
  s.status = status;
  s.reason = reason;
  if (!seguiaEsperando) s.since = Date.now();
}

// ── Superficies: qué archivo está tocando cada agente ────────────────────────
// El hook PermissionRequest nos entrega la intención de un agente JUSTO ANTES de
// ejecutarla, y ya estamos sosteniendo esa petición. Si además sabemos qué están
// tocando las demás sesiones, podemos ver la colisión cuando todavía es gratis:
// antes de que se escriba la primera línea, no en el merge.

const COLLISION_WINDOW_MS = 20 * 60 * 1000;

// Normaliza a una ruta relativa al repo. Sin esto, dos personas en máquinas
// distintas (C:\Users\diego\buk-api\... vs /home/sofia/buk-api/...) nunca
// coincidirían, y el cruce entre personas es justo lo que no tiene competencia.
export function surfaceOf(filePath, repo) {
  if (!filePath) return null;
  const p = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (!p.includes('/') && !p.includes('.')) return null;
  const r = String(repo || '').toLowerCase();
  const i = r ? p.lastIndexOf('/' + r + '/') : -1;
  if (i >= 0) return p.slice(i + 1);
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

function surfaceFromPayload(payload, repo) {
  const i = payload.tool_input || {};
  return surfaceOf(i.file_path || i.notebook_path || i.path, repo);
}

// ¿Otra sesión del mismo token está tocando esta superficie ahora mismo?
export function collisionFor(token, sessionId, surface, now = Date.now()) {
  const t = TOKENS.get(token);
  if (!t || !surface) return null;
  let best = null;
  for (const s of t.sessions.values()) {
    if (s.sessionId === sessionId) continue;
    const at = s.touched?.get(surface);
    if (!at || now - at > COLLISION_WINDOW_MS) continue;
    if (!best || at > best.at) best = { at, s };
  }
  if (!best) return null;
  return {
    who: best.s.who,
    repo: best.s.repo,
    sessionId: best.s.sessionId,
    surface,
    agoMs: now - best.at,
  };
}

export { surfaceFromPayload };

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
      if (payload.session_title) s.title = String(payload.session_title).slice(0, 80);
      if (payload.model) s.model = payload.model;
      break;

    // La señal más limpia de "el humano volvió y está en el teclado".
    // Sin esto, una sesión donde Claude responde sin usar herramientas se queda
    // marcada como `done` y acumula deuda fantasma: el número se infla y la
    // métrica deja de ser defendible.
    case 'UserPromptSubmit':
      setStatus(s, 'working', null);
      // Con dos sesiones en el mismo repo, el repo no distingue nada. Lo que de
      // verdad te dice cuál es cuál es qué le pediste.
      if (payload.prompt) {
        s.lastPrompt = String(payload.prompt).replace(/\s+/g, ' ').trim().slice(0, 90);
        anotar(s.refs, refsDe(payload.prompt));
      }
      markHuman(t);
      break;

    case 'PostToolUse': {
      setStatus(s, 'working', null);
      const sig = toolSignature(payload);
      s.recentTools.push(sig);
      if (s.recentTools.length > 8) s.recentTools.shift();
      const repeats = s.recentTools.filter((x) => x === sig).length;
      s.loopCount = repeats >= 3 ? repeats - 2 : 0;

      // La rama sale de la SALIDA del comando, que es donde git la imprime.
      const rama = ramaDeSalida(payload.tool_result) || ramaDeComando(payload.tool_input?.command);
      if (rama && rama !== s.branch) {
        s.branch = rama;
        anotar(s.refs, refsDeRama(rama));
      }

      // Qué archivo acaba de tocar. Es lo que permite ver la colisión después.
      const surface = surfaceFromPayload(payload, s.repo);
      if (surface) {
        s.touched.set(surface, Date.now());
        if (s.touched.size > 40) s.touched.delete(s.touched.keys().next().value);
      }
      break;
    }

    case 'Stop':
      setStatus(s, 'done', 'completed');
      if (payload.last_assistant_message) {
        s.lastMessage = String(payload.last_assistant_message).slice(0, 600);
        anotar(s.refs, refsDe(payload.last_assistant_message));
      }
      break;

    // Los subagentes multiplican la deuda: si una sesión con 3 subagentes te espera,
    // no tienes 1 agente parado, tienes 4. Eso es lo que significa "agent-minutos".
    case 'SubagentStart':
      s.subagents++;
      break;

    case 'SubagentStop':
      s.subagents = Math.max(0, s.subagents - 1);
      // Que un subagente termine NO significa que volviste. Si la principal está
      // congelada esperándote, sigue congelada. Marcarla "trabajando" hacía dos
      // destrozos a la vez: la sacaba de la lista de las que te esperan (por eso
      // veías conversaciones pausadas diciendo "trabajando") y le reiniciaba el
      // reloj, así que su deuda caía a cero. Solo vuelve a "trabajando" si de
      // verdad estaba trabajando.
      if (!DEBT_STATUSES.has(s.status)) setStatus(s, 'working', null);
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

// La deuda es una INTEGRAL, no una multiplicación.
//
// Antes era `tiempo_esperando × agentes_de_AHORA`, y eso reescribe el pasado: cuatro
// agentes parados cinco minutos son 20 agent-minutos, y que después termine un
// subagente no convierte esos 20 en 15. Ya se perdieron. Por eso el número saltaba
// hacia abajo en vez de crecer.
//
// Se suma tramo a tramo, cada uno al ritmo que tenía ese tramo. Es idempotente en el
// tiempo: que lo llamen dos clientes a la vez no cobra doble, porque cada llamada
// solo cobra desde `tickAt`.
function acumular(t, s, now, congelado) {
  const desde = s.tickAt || now;
  if (!congelado && now > desde && DEBT_STATUSES.has(s.status)) {
    s.debtMs += (now - desde) * (1 + (s.subagents || 0)) * (t.demoSpeed || 1);
  }
  // `tickAt` avanza SIEMPRE, incluso congelado: si no, al volver de almorzar se
  // cobraría de golpe todo el rato en que no estabas.
  s.tickAt = now;
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
      autopilot: false, auto: [],
      cost: { idleUsd: 0, rateUsdHour: Number(process.env.PINGS_DEV_RATE_USD || 60), loopSessions: 0 },
      sessions: [], permits: [], speak: null,
    };
  }

  // ¿Hay alguien en el teclado? Solo cuentan los eventos que produce el HUMANO:
  // escribir un prompt o decidir un permiso. `PostToolUse` lo dispara el agente
  // trabajando — si te fuiste a almorzar y un agente sigue corriendo, tú no estás.
  const lastActivity = t.lastHumanAt || 0;
  const away = now - lastActivity > AWAY_MS;
  // Estando fuera, el reloj se detiene donde estaba: la deuda queda congelada
  // esperándote, en vez de crecer toda la noche o borrarse.
  const clockNow = away ? lastActivity + AWAY_MS : now;

  const sessions = [];
  let total = 0;
  for (const s of t.sessions.values()) {
    const stale = now - s.lastEventAt > STALE_MS;
    // Cobrar ANTES de leer. Congelado si no estás o si la sesión ya está abandonada.
    acumular(t, s, now, away || stale);
    const status = stale ? 'stale' : s.status;
    const waitedMs = stale ? 0 : waitedMsFor(t, s, clockNow);
    // Una sesión parada con N subagentes tiene N+1 agentes parados.
    const blockedAgents = stale ? 0 : 1 + (s.subagents || 0);
    total += s.debtMs;
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
      why: whyFor(s, status),
      action: actionFor(s, status),
      costMs: s.debtMs,
      // Cómo llamar a esta sesión para que un humano la reconozca. El título de
      // la conversación si existe; si no, qué le pediste; si no, el id corto.
      label: s.title || s.lastPrompt || `sesión ${s.sessionId.slice(0, 6)}`,
      title: s.title || null,
      lastPrompt: s.lastPrompt || null,
      branch: s.branch || null,
      refs: [...(s.refs || [])],
      tasksOpen: s.tasksOpen || 0,
      tasksDone: s.tasksDone || 0,
      lastTask: s.lastTask || null,
      // Avance real cuando el agente lleva lista de tareas. `null` si no la lleva:
      // pintar 0% donde no hay datos miente, y la métrica solo vale si no miente.
      progress: progressOf(s),
    });
  }

  sessions.sort((a, b) => score(b) - score(a));

  // Dos costos distintos, y la diferencia importa:
  //  - Esperar NO quema tokens. Un agente bloqueado cuesta 0. Lo que pierdes es
  //    capacidad paralela: costo de oportunidad, con el supuesto de tarifa a la vista.
  //  - Dar vueltas en loop SÍ quema tokens de verdad. Eso es plata literal.
  // Decir "X dólares de cómputo parado" sería falso y se cae con una pregunta.
  const rateUsdHour = Number(process.env.PINGS_DEV_RATE_USD || 60);
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
    autopilot: Boolean(t.autopilot),
    auto: (t.autoLog || []).slice(0, 8),
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
      t.speakText = `${min} agent-minutos. Te digo a cuál volver primero.`;
    }
  }
  return t.speakText;
}

// El porqué y el qué-hacer de cada sesión, sin modelo. Viven aquí y no en ai.js
// porque son la vista por defecto: la lista ordenada tiene que ser útil siempre,
// con o sin API key. La IA los enriquece, no los sustituye.
const REASON_ES = {
  permission: 'Pidió permiso y está congelada',
  needs_input: 'Necesita que decidas algo',
  failed: 'Falló y se detuvo',
  completed: 'Terminó, falta que confirmes',
  idle: 'Lleva rato quieta',
};

// Cercanía a terminar, medida en vez de adivinada. Es el criterio que más le
// faltaba al ranking: una sesión a un paso de cerrar es barata aunque lleve
// menos rato esperando.
function progressOf(s) {
  const done = s.tasksDone || 0;
  const total = done + (s.tasksOpen || 0);
  if (total === 0) return null;
  return { done, total, pct: Math.round((done / total) * 100) };
}

function whyFor(s, status) {
  if (status === 'stale') return 'Sin señales hace rato';
  if (status === 'working') return 'Trabajando';
  return REASON_ES[s.reason] || 'Te está esperando';
}

function actionFor(s, status) {
  if (status === 'working' || status === 'stale') return null;
  if (s.loopCount >= 1) return 'Se está dando vueltas: ciérrala';
  if (s.reason === 'permission') return 'Decide el permiso desde aquí';
  if (s.reason === 'completed') return 'Confírmala y ciérrala';
  if (s.reason === 'failed') return 'Revisa el error';
  return 'Ve a esta primero';
}

// CONTRACT.md §6 — fallback determinista. Se construye ANTES que la IA y nunca se apaga.
const REASON_WEIGHT = { permission: 3.0, needs_input: 2.5, failed: 2.0, completed: 1.5, idle: 1.0 };

export function score(s) {
  const w = REASON_WEIGHT[s.reason] || 1.0;
  // costMs ya es la integral acumulada (tiempo × agentes parados, tramo a tramo).
  // Volver a multiplicar por blockedAgents contaría los subagentes dos veces.
  const costo = s.costMs != null ? s.costMs : s.waitedMs * (s.blockedAgents || 1);
  return costo * w * (1 + (s.loopCount || 0));
}

export function resetDebt(token) {
  const t = TOKENS.get(token);
  if (!t) return;
  const now = Date.now();
  for (const s of t.sessions.values()) {
    s.since = now;
    s.debtMs = 0;      // "ya volví": la deuda se salda, no se sigue arrastrando
    s.tickAt = now;
  }
  t.spoken.clear();
}

// `ramp`: arranca la deuda en cero para que el contador SUBA en vivo y se vea la
// escalada calm → nudge → angry → toll. Sin esto la demo aparece ya en pings y se
// salta el arco entero, que es justo el beat del pitch ("12... 30... 47").
export function startDemo(token, speed, ramp = false) {
  const t = getToken(token);
  if (!t) return null;
  t.demoSpeed = speed;
  t.sessions.clear();
  t.spoken.clear();
  const now = Date.now();
  const seed = [
    { sessionId: 'demo-auth', repo: 'buk-api', who: 'diego', status: 'waiting', reason: 'permission',
      title: 'Rotación de refresh tokens en auth', tareas: [4, 1],
      lastMessage: 'Quiero borrar db/migrations/ para regenerarlas desde cero.', loopCount: 0, subagents: 0, ageS: 40 },
    { sessionId: 'demo-checkout', repo: 'buk-api', who: 'diego', status: 'done', reason: 'completed',
      title: 'Cupones de descuento en checkout', tareas: [5, 0],
      lastMessage: 'Listo. PR #212 abierto, solo falta que lo confirmes.', loopCount: 0, subagents: 0, ageS: 15 },
    // Sofía lleva rato en el mismo archivo que el permiso de abajo va a pedir:
    // así la colisión se ve en la demo sin tener que orquestar dos máquinas.
    { sessionId: 'demo-ui', repo: 'buk-web', who: 'sofía', status: 'waiting', reason: 'needs_input',
      title: 'Arreglar hidratación del dashboard', tareas: [1, 4],
      lastMessage: 'Sigo viendo el mismo error de hidratación. Intento otra vez.', loopCount: 3, subagents: 3, ageS: 70,
      touched: [['buk-api/src/auth/client.ts', now - 6 * 60 * 1000]] },
    { sessionId: 'demo-infra', repo: 'buk-infra', who: 'diego', status: 'working', reason: null,
      title: 'Migrar los workers a Fly', tareas: [2, 3],
      lastMessage: null, loopCount: 0, subagents: 0, ageS: 5 },
  ];
  for (const d of seed) {
    t.sessions.set(d.sessionId, {
      sessionId: d.sessionId, repo: d.repo, who: d.who, status: d.status, reason: d.reason,
      since: now - (ramp ? 0 : d.ageS * 1000), lastMessage: d.lastMessage, loopCount: d.loopCount,
      subagents: d.subagents, branch: d.branch || null, refs: new Set(d.refs || []),
      // La deuda sembrada tiene que ser la MISMA integral que acumularía sola:
      // segundos de antigüedad × agentes parados. Con ramp arranca en cero y sube en vivo.
      debtMs: (ramp || !DEBT_STATUSES.has(d.status)) ? 0 : d.ageS * 1000 * (1 + d.subagents),
      tickAt: now,
      tasksDone: d.tareas ? d.tareas[0] : 0, tasksOpen: d.tareas ? d.tareas[1] : 0, lastTask: null,
      title: d.title, lastPrompt: null, model: null,
      recentTools: [], touched: new Map(d.touched || []), lastEventAt: now,
    });
  }
  // El registro de lo que se aprobó solo: es la prueba de que Pings trabajó
  // mientras no estabas, y sin auditoría decidir por alguien sería abuso.
  t.autoLog = [
    { at: now - 40_000, sessionId: 'demo-auth', who: 'diego', repo: 'buk-api',
      tool: 'Bash', input: 'git status', razon: 'comando de solo lectura' },
    { at: now - 95_000, sessionId: 'demo-ui', who: 'sofía', repo: 'buk-web',
      tool: 'Read', input: 'src/hooks/useAuth.ts', razon: 'Read no escribe nada' },
    { at: now - 160_000, sessionId: 'demo-auth', who: 'diego', repo: 'buk-api',
      tool: 'Grep', input: 'refreshToken', razon: 'Grep no escribe nada' },
  ];

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
