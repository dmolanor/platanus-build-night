import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ingest, snapshot, newToken, getToken, startDemo, stopDemo, resetDebt, levelFor,
  NUDGE_MS, surfaceFromPayload, collisionFor, repoFromCwd,
  isAway, autopilotOn, setAutopilot, logAuto, markHuman,
} from './state.js';
import { decidir } from './autopilot.js';
import { frase, TONOS } from './tono.js';
import * as github from './github.js';
import * as permits from './permits.js';
import { aiBrief, aiAdvice, aiEmparejar, lastAiError, fallbackBrief } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 7777;

app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// El token viaja en la query (es el mecanismo de onboarding: compartir la URL = compartir
// la cola del equipo). También lo aceptamos por header, para poder migrar los hooks a
// `headers: { Authorization }` sin tocar el servidor. Tradeoff asumido: queda en logs
// y en el Referer. Mitigación: TTL de 2h y token rotable desde la landing.
// Solo el formato que emite newToken(). Sin esto, cualquier cadena crea un tenant:
// alguien usa `?token=diego` porque le resulta cómodo y ese token SÍ se adivina
// —y quien lo adivine aprueba comandos en su máquina—, además de dejar crear
// entradas ilimitadas con TTL de 12h en una instancia de 512MB.
const FORMATO_TOKEN = /^p_[A-Za-z0-9_-]{24}$/;

const tokenOf = (req) => {
  const auth = req.get('authorization');
  const raw = auth?.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : String(req.query.token || '').trim();
  return FORMATO_TOKEN.test(raw) ? raw : '';
};

// ── Ingesta de hooks ─────────────────────────────────────────────────────────
// Responde rápido SIEMPRE, salvo PermissionRequest cuando el humano está ausente.
app.post('/hook', (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(200).end();

  const who = String(req.query.who || '').trim() || 'yo';
  const kind = String(req.query.kind || '').trim();
  const payload = req.body || {};

  ingest(token, who, payload, kind);

  if (payload.hook_event_name !== 'PermissionRequest') return res.status(200).end();

  const snap = snapshot(token);

  // Detección de colisión en el instante en que todavía es gratis: aún no se ha
  // escrito una línea. Ya tenemos la intención (el hook la trae) y ya sabemos qué
  // está tocando cada otra sesión. Sale del dato que ya está en memoria.
  const surface = surfaceFromPayload(payload, repoFromCwd(payload.cwd));
  const collision = collisionFor(token, payload.session_id, surface);

  // PILOTO AUTOMÁTICO: va ANTES de la compuerta de deuda. Si de verdad no estás,
  // lo rutinario se aprueba ya — no tiene sentido dejar que la deuda crezca dos
  // minutos para recién entonces decidir algo que no requería a nadie.
  const veredicto = decidir({
    tool: payload.tool_name,
    input: payload.tool_input,
    collision,
    away: isAway(token),
    encendido: autopilotOn(token),
  });

  if (veredicto.auto) {
    logAuto(token, {
      sessionId: payload.session_id,
      who,
      repo: repoFromCwd(payload.cwd),
      tool: payload.tool_name,
      input: String(payload.tool_input?.command || payload.tool_input?.file_path || '').slice(0, 120),
      razon: veredicto.razon,
    });
    return res.status(200).json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
  }

  // Regla de retención (CONTRACT.md §3): si estás en el teclado, Pings no te estorba.
  if (snap.totalWaitedMs < NUDGE_MS) return res.status(200).end();

  // La recomendación llega después y se adjunta al permiso cuando esté lista.
  // Los botones aparecen en el widget de inmediato, con o sin ella.
  const session = snap.sessions.find((s) => s.sessionId === payload.session_id);
  permits.hold({ token, who, payload, res, collision, onAdvice: (p) => aiAdvice(p, session, collision) });
});

// ── Personalización ──────────────────────────────────────────────────────────
// Los ajustes viajan en la query de la URL del widget (y por lo tanto en el QR, que
// se genera desde esa misma URL). Se aplican ACÁ, sobre el snapshot ya armado, por
// dos razones: state.js no tiene que saber que existen, y no hay nada que persistir.
// Es el mismo lugar donde ya se sobreescribe snap.permits.

const SENS_MIN = {                      // minutos de nudge / angry / toll
  relax: [5, 10, 20],
  normal: [2, 5, 10],                   // el de CONTRACT.md §1
  strict: [1, 3, 5],
};

// Acumulado del día. Vive en memoria y cada redeploy lo borra: lo decimos en la UI en
// vez de esconderlo. El guardia de lastAt es lo que evita que dos pestañas del widget
// abiertas a la vez cuenten doble — cada conexión SSE llama a esto una vez por segundo.
const perdidoHoy = new Map();           // token → { dia, ms, lastAt }

function acumular(token, snap) {
  if (!token) return 0;
  const ahora = Date.now();
  const dia = new Date().toISOString().slice(0, 10);
  let e = perdidoHoy.get(token);
  if (!e || e.dia !== dia) e = { dia, ms: 0, lastAt: ahora };
  const delta = ahora - e.lastAt;
  if (delta >= 900) {
    // Solo acumula si estás presente. Las horas en que estuviste fuera no cuentan:
    // no hay a quién intervenir en una silla vacía, y tampoco a quién cobrarle.
    if (snap.presence === 'here') e.ms += delta * (snap.agentesParados || 0);
    e.lastAt = ahora;
  }
  perdidoHoy.set(token, e);
  return e.ms;
}

// `acumula` solo va en true desde /events. /api/state es un endpoint de lectura (lo usa
// el widget para pintar el acumulado, y CONTRACT.md §5 lo declara para debug): un GET no
// debería mover el contador. Los dos comparten el mismo Map, así que el widget lee ahí
// lo que su propio SSE viene acumulando.
// Rota entre variantes para que cruzar el mismo umbral dos veces no diga lo mismo.
const rotaciones = new Map();
function rotacion(token) {
  const n = (rotaciones.get(token) || 0);
  rotaciones.set(token, n + 1);
  return n;
}

function personalizar(req, token, snap, acumula) {
  const q = req.query;

  // Tarifa. Lo que se pierde esperando es capacidad paralela, no cómputo: esperar no
  // quema tokens. Por eso el número se recalcula sobre totalWaitedMs y nada más.
  const rate = Number(q.rate);
  const tarifa = isFinite(rate) && rate > 0 && rate <= 100000
    ? rate
    : (snap.cost?.rateUsdHour ?? 60);
  const conPlata = q.money !== '0';

  if (snap.cost) {
    snap.cost.rateUsdHour = tarifa;
    snap.cost.idleUsd = conPlata
      ? Math.round((snap.totalWaitedMs / 3_600_000) * tarifa * 100) / 100
      : 0;
    const hoyMs = acumula ? acumular(token, snap) : (perdidoHoy.get(token)?.ms ?? 0);
    snap.cost.perdidoHoyMs = hoyMs;
    snap.cost.perdidoHoyUsd = conPlata
      ? Math.round((hoyMs / 3_600_000) * tarifa * 100) / 100
      : 0;
  }

  // Tono de la voz. Se reescribe DESPUÉS de que speakFor() ya decidió que hay algo
  // nuevo que decir, así que la lógica de "una sola vez por nivel" no se toca:
  // acá solo cambia el registro del mismo mensaje.
  const tono = TONOS.includes(q.tono) ? q.tono : 'seco';
  if (tono !== 'seco' && typeof snap.speak === 'string' && snap.speak) {
    const min = Math.round(snap.totalWaitedMs / 60000);
    const alt = frase(tono, snap.level, snap.agentesParados, min, rotacion(token));
    if (alt) snap.speak = alt;
  }

  // Sensibilidad. El widget deriva TODO de snap.level (colores de la bola, vista de
  // pings, voz), así que recalcularlo acá alcanza y levelFor() no se toca. En 'normal'
  // no entramos nunca: el comportamiento por defecto queda idéntico al de hoy.
  const sens = SENS_MIN[q.sens] ? q.sens : 'normal';
  if (sens !== 'normal') {
    const [n, a, t] = SENS_MIN[sens].map((m) => m * 60_000);
    const d = snap.totalWaitedMs;
    snap.level = d <= 0 ? 'calm' : d >= t ? 'toll' : d >= a ? 'angry' : d >= n ? 'nudge' : 'calm';
  }

  return snap;
}

// ── Stream al widget ─────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  const token = tokenOf(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const tick = () => {
    const snap = snapshot(token);
    snap.permits = permits.pendingFor(token);
    personalizar(req, token, snap, true);
    res.write(`data: ${JSON.stringify(snap)}\n\n`);
  };
  tick();
  const timer = setInterval(tick, 1000);
  req.on('close', () => clearInterval(timer));
});

// ── Decisión remota sobre un permiso retenido ────────────────────────────────
app.post('/api/permit/:id', (req, res) => {
  // Sin el token del equipo no se decide nada: esto ejecuta comandos en la máquina de alguien.
  markHuman(tokenOf(req));   // tocaste un botón: estás aquí
  const ok = permits.resolve(req.params.id, req.body?.decision, tokenOf(req) || req.body?.token);
  if (!ok) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

// ── Resto ────────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const token = tokenOf(req);
  const snap = snapshot(token);
  snap.permits = permits.pendingFor(token);
  personalizar(req, token, snap, false);
  res.json(snap);
});

// El brief es la única ruta que gasta dinero y no estaba autenticada: cualquiera
// podía sembrar un token y pedir briefs en bucle contra nuestra API key.
const briefUltimo = new Map();
let briefEstaHora = { hora: 0, n: 0 };
const BRIEF_COOLDOWN_MS = 10_000;
const BRIEF_TOPE_HORA = 120;

app.get('/api/brief', async (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(404).json({ ok: false });

  const ahora = Date.now();
  const hora = Math.floor(ahora / 3_600_000);
  if (briefEstaHora.hora !== hora) briefEstaHora = { hora, n: 0 };

  const frio = ahora - (briefUltimo.get(token) || 0) < BRIEF_COOLDOWN_MS;
  const topado = briefEstaHora.n >= BRIEF_TOPE_HORA;
  const snap = snapshot(token);
  // Con cooldown o tope, el fallback determinista responde igual de bien y gratis.
  if (frio || topado) return res.json(fallbackBrief(snap));

  briefUltimo.set(token, ahora);
  briefEstaHora.n++;
  res.json(await aiBrief(snap));
});

app.post('/api/toll/complete', (req, res) => {
  resetDebt(tokenOf(req));
  res.json({ ok: true });
});

// ?ramp=1 arranca la deuda en cero para que el contador suba en vivo y se vea la
// escalada completa. Es el beat del pitch; sin esto la demo aparece ya en pings.
app.post('/api/demo/start', (req, res) => {
  const ramp = req.query.ramp === '1';
  // Calibrado con el estado sembrado (6 agentes acumulando): a velocidad 2 la deuda
  // sube ~0.2 agent-min por segundo real → nudge ~10s, angry ~25s, pings ~50s.
  // Ese es el arco del pitch. Velocidades altas lo saltan entero.
  const speed = Number(req.query.speed || (ramp ? 2 : process.env.PINGS_DEMO_SPEED || 60));
  if (!startDemo(tokenOf(req), speed, ramp)) return res.status(404).json({ ok: false });
  res.json({ ok: true, speed, ramp });
});

app.post('/api/demo/stop', (req, res) => {
  stopDemo(tokenOf(req));
  res.json({ ok: true });
});

// MODO PITCH: acelera el reloj sobre tus sesiones REALES, sin sembrar nada.
// Un pitch dura 2 minutos y la deuda sube 1 agent-minuto por minuto y agente:
// sin esto no alcanzas ni el primer umbral. Los datos siguen siendo reales,
// solo comprimidos — y el widget muestra "reloj 5x" para decirlo de frente.
app.post('/api/clock', (req, res) => {
  const t = getToken(tokenOf(req));
  if (!t) return res.status(404).json({ ok: false });
  const speed = Math.max(1, Math.min(60, Number(req.query.speed || 1)));
  t.demoSpeed = speed;
  res.json({ ok: true, speed });
});

app.get('/api/token/new', (req, res) => {
  const token = newToken();
  getToken(token);
  res.json({ token });
});

// Bloque listo para pegar en ~/.claude/settings.json. Esto ES el onboarding.
app.get('/api/hooks.json', (req, res) => {
  const token = tokenOf(req) || 'PON_TU_TOKEN';
  const who = String(req.query.who || 'yo').trim();
  const base = `${req.protocol === 'http' && req.get('host')?.includes('localhost') ? 'http' : 'https'}://${req.get('host')}/hook`;
  const url = (extra = '') => `${base}?token=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}${extra}`;
  const fast = (extra = '') => [{ hooks: [{ type: 'http', url: url(extra), timeout: 5 }] }];

  res.json({
    hooks: {
      SessionStart: fast(),
      SessionEnd: fast(),
      UserPromptSubmit: fast(),
      Stop: fast(),
      StopFailure: fast(),
      SubagentStart: fast(),
      SubagentStop: fast(),
      TaskCreated: fast(),
      TaskCompleted: fast(),
      PostToolUse: [{ matcher: 'Edit|Write|Bash', hooks: [{ type: 'http', url: url(), timeout: 5 }] }],
      Notification: [
        { matcher: 'agent_needs_input', hooks: [{ type: 'http', url: url('&kind=needs_input'), timeout: 5 }] },
        { matcher: 'agent_completed', hooks: [{ type: 'http', url: url('&kind=completed'), timeout: 5 }] },
        { matcher: 'idle_prompt', hooks: [{ type: 'http', url: url('&kind=idle'), timeout: 5 }] },
      ],
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'http',
              url: url(),
              timeout: 90,
              statusMessage: 'Pings: esperando tu decisión desde el widget…',
            },
          ],
        },
      ],
    },
  });
});

// QR generado en el servidor, sin servicio externo: depender de una API de
// terceros en vivo durante el pitch sería el único punto de red evitable.
app.get('/api/qr.svg', async (req, res) => {
  // Se reenvía la query entera, no solo el token: así el QR lleva los ajustes (tarifa,
  // sensibilidad, carita) al celular. Es lo que hace que la config viaje sin sesiones.
  const qs = new URLSearchParams();
  for (const k of Object.keys(req.query)) qs.set(k, String(req.query[k]));
  const url = `https://${req.get('host')}/widget.html?${qs.toString()}`;
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      color: { dark: '#0d0e12', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch {
    res.status(500).end();
  }
});

// Apagado por defecto: es lo único que ejecuta algo sin que mires.
app.post('/api/autopilot', (req, res) => {
  if (!tokenOf(req)) return res.status(404).json({ ok: false });
  const on = setAutopilot(tokenOf(req), req.query.on === '1');
  res.json({ ok: true, autopilot: on });
});

// ── Voz por ElevenLabs ───────────────────────────────────────────────────────
// La key NUNCA sale del servidor. Sin key, con error, sin cuota o con demora
// respondemos 204 y el widget cae al speechSynthesis del navegador: la demo no
// depende de la red (CONTRACT.md §6 aplicado también a la voz).
const voiceCache = new Map();          // texto → mp3. Las frases de nivel se repiten
let lastVoiceError = null;

// Rate limits. Esto gasta cuota real de un tercero y el token viaja en la query:
// quien lo tenga puede pedir audio en bucle. Dos cinturones: ráfagas por token y
// un presupuesto global de caracteres que protege la cuota de la cuenta entera.
const VOICE_RPM = Number(process.env.ELEVENLABS_RPM || 20);
const VOICE_CHARS_HOUR = Number(process.env.ELEVENLABS_CHARS_HOUR || 8000);
const voiceHits = new Map();           // token → timestamps del último minuto
let charWindow = { start: Date.now(), used: 0 };

function voiceAllowed(token, chars) {
  const now = Date.now();

  if (now - charWindow.start > 3_600_000) charWindow = { start: now, used: 0 };
  if (charWindow.used + chars > VOICE_CHARS_HOUR) return 'quota';

  const hits = (voiceHits.get(token) || []).filter((t) => now - t < 60_000);
  if (hits.length >= VOICE_RPM) { voiceHits.set(token, hits); return 'rate'; }

  hits.push(now);
  voiceHits.set(token, hits);
  charWindow.used += chars;

  if (voiceHits.size > 200) {
    for (const [k, v] of voiceHits) if (!v.some((t) => now - t < 60_000)) voiceHits.delete(k);
  }
  return null;
}

app.get('/api/voice', async (req, res) => {
  const token = tokenOf(req);
  const text = String(req.query.text || '').trim().slice(0, 300);
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!token || !text || !key || !voiceId) return res.status(204).end();

  // El caché va ANTES del rate limit: repetir una frase ya sintetizada no gasta cuota.
  const hit = voiceCache.get(text);
  if (hit) return res.type('audio/mpeg').set('Cache-Control', 'no-store').send(hit);

  const blocked = voiceAllowed(token, text.length);
  if (blocked) {
    lastVoiceError = blocked === 'quota'
      ? `presupuesto de ${VOICE_CHARS_HOUR} caracteres/hora agotado`
      : `más de ${VOICE_RPM} peticiones/minuto para este token`;
    return res.status(429).end();      // el widget lo lee como fallo → voz del navegador
  }

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
          // 0.7 aplana la entonación: suena sentencioso en vez de expresivo, que es el
          // registro de "eso lo estás costando tú".
          voice_settings: { stability: 0.7, similarity_boost: 0.8 },
        }),
        signal: AbortSignal.timeout(4000),   // el pitch no espera más
      },
    );
    if (!r.ok) {
      lastVoiceError = `${r.status} ${(await r.text()).slice(0, 160)}`;
      return res.status(204).end();
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (voiceCache.size > 60) voiceCache.clear();
    voiceCache.set(text, buf);
    lastVoiceError = null;
    res.type('audio/mpeg').set('Cache-Control', 'no-store').send(buf);
  } catch (e) {
    lastVoiceError = String(e?.message || e).slice(0, 160);
    res.status(204).end();
  }
});

// ── Issues: qué trabajo no tiene a nadie encima ──────────────────────────────
// El PAT entra por el BODY, nunca por la query: Render y Cloudflare registran la
// URL entera, y eso fue justo lo que marcó la auditoría. Vive solo en memoria y
// no sale en ninguna respuesta.
app.post('/api/github', (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(404).json({ ok: false });
  const out = github.configurar(token, {
    pat: req.body?.pat,
    repos: req.body?.repos,
  });
  res.json({ ok: true, ...out });
});

app.get('/api/github', (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(404).json({ ok: false });
  res.json(github.estado(token));
});

// Se consulta aparte del SSE a propósito: pegarle a GitHub una vez por segundo
// por cada widget abierto sería absurdo. El TTL de 60s vive en github.js.
app.get('/api/issues', async (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(404).json({ ok: false });

  const est = github.estado(token);
  if (!est.conectado) return res.json({ conectado: false, pares: [], sinNadie: [] });

  const items = await github.refrescar(token);
  const snap = snapshot(token);
  const vivas = snap.sessions.filter((x) => x.status !== 'stale');

  // Lo determinista primero: una referencia `#123` o una rama `fix/123-…` no
  // necesita modelo, y además nunca se equivoca.
  const { pares, huerfanos, sesionesSinIssue } = github.emparejarPorNumero(items, vivas);

  let sinNadie = huerfanos;
  if (huerfanos.length) {
    const ia = await aiEmparejar(huerfanos, sesionesSinIssue);
    if (ia) {
      const porId = new Map(vivas.map((x) => [x.sessionId, x]));
      const porNum = new Map(huerfanos.map((i) => [i.numero, i]));
      for (const p of ia.pares || []) {
        const s = porId.get(p.sessionId);
        const it = porNum.get(p.numero);
        if (s && it) {
          pares.push({ sessionId: s.sessionId, label: s.label, numero: it.numero,
                       repo: it.repo, titulo: it.titulo, esPR: it.esPR,
                       como: 'semejanza', porque: p.porque });
        }
      }
      const emparejados = new Set(pares.map((p) => p.numero));
      sinNadie = huerfanos.filter((i) => !emparejados.has(i.numero));
    }
  }

  res.json({
    conectado: true,
    repos: est.repos,
    error: est.error,
    pares,
    // Lo que importa: trabajo abierto que ninguna conversación está atendiendo.
    sinNadie: sinNadie.map((i) => ({
      numero: i.numero, repo: i.repo, titulo: i.titulo,
      esPR: i.esPR, asignado: i.asignado, url: i.url,
    })),
  });
});

// Por qué la IA cayó al fallback. Para diagnosticar sin adivinar.
// Exige token: `lastAiError` es global entre tokens y los mensajes del SDK pueden
// arrastrar fragmentos de la petición que lo provocó.
app.get('/api/diag', (req, res) => {
  if (!tokenOf(req)) return res.status(404).json({ ok: false });
  res.json({
    apiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    lastAiError,
    voice: {
      key: Boolean(process.env.ELEVENLABS_API_KEY),
      voiceId: Boolean(process.env.ELEVENLABS_VOICE_ID),
      model: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      cached: voiceCache.size,
      charsUsed: charWindow.used,
      charsBudget: VOICE_CHARS_HOUR,
      rpm: VOICE_RPM,
      lastVoiceError,
    },
  });
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Un hook JAMÁS debe ver un error nuestro. Va al FINAL: Express solo enruta a
// manejadores de error registrados DESPUÉS del handler que lanzó. Registrado
// arriba solo atrapaba fallos de express.json(), y un cwd no-string devolvía un
// 500 con el stack y las rutas absolutas del servidor dentro.
app.use((err, req, res, _next) => {
  if (!err) return res.status(404).end();
  if (req.path === '/hook') return res.status(200).end();
  res.status(200).json({ ok: false });
});

app.listen(PORT, () => console.log(`pings escuchando en :${PORT}`));
