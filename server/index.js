import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingest, snapshot, newToken, getToken, startDemo, stopDemo, resetDebt, levelFor, NUDGE_MS } from './state.js';
import * as permits from './permits.js';
import { aiBrief, aiAdvice } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 7777;

app.use(express.json({ limit: '2mb' }));

// Un hook JAMÁS debe ver un error nuestro. Si el body viene raro, seguimos con {}.
app.use((err, req, res, next) => {
  if (err && req.path === '/hook') return res.status(200).end();
  if (err) return res.status(200).json({ ok: false });
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// El token viaja en la query (es el mecanismo de onboarding: compartir la URL = compartir
// la cola del equipo). También lo aceptamos por header, para poder migrar los hooks a
// `headers: { Authorization }` sin tocar el servidor. Tradeoff asumido: queda en logs
// y en el Referer. Mitigación: TTL de 2h y token rotable desde la landing.
const tokenOf = (req) => {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return String(req.query.token || '').trim();
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

  // Regla de retención (CONTRACT.md §3): si estás en el teclado, Peaje no te estorba.
  const snap = snapshot(token);
  const ausente = snap.totalWaitedMs >= NUDGE_MS;
  if (!ausente) return res.status(200).end();

  // La recomendación llega después y se adjunta al permiso cuando esté lista.
  // Los botones aparecen en el widget de inmediato, con o sin ella.
  const session = snap.sessions.find((s) => s.sessionId === payload.session_id);
  permits.hold({ token, who, payload, res, onAdvice: (p) => aiAdvice(p, session) });
});

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
    res.write(`data: ${JSON.stringify(snap)}\n\n`);
  };
  tick();
  const timer = setInterval(tick, 1000);
  req.on('close', () => clearInterval(timer));
});

// ── Decisión remota sobre un permiso retenido ────────────────────────────────
app.post('/api/permit/:id', (req, res) => {
  // Sin el token del equipo no se decide nada: esto ejecuta comandos en la máquina de alguien.
  const ok = permits.resolve(req.params.id, req.body?.decision, tokenOf(req) || req.body?.token);
  if (!ok) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

// ── Resto ────────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const snap = snapshot(tokenOf(req));
  snap.permits = permits.pendingFor(tokenOf(req));
  res.json(snap);
});

app.get('/api/brief', async (req, res) => {
  res.json(await aiBrief(snapshot(tokenOf(req))));
});

app.post('/api/toll/complete', (req, res) => {
  resetDebt(tokenOf(req));
  res.json({ ok: true });
});

app.post('/api/demo/start', (req, res) => {
  const speed = Number(req.query.speed || process.env.PEAJE_DEMO_SPEED || 60);
  startDemo(tokenOf(req), speed);
  res.json({ ok: true, speed });
});

app.post('/api/demo/stop', (req, res) => {
  stopDemo(tokenOf(req));
  res.json({ ok: true });
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
      Stop: fast(),
      StopFailure: fast(),
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
              statusMessage: 'Peaje: esperando tu decisión desde el widget…',
            },
          ],
        },
      ],
    },
  });
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`peaje escuchando en :${PORT}`));
