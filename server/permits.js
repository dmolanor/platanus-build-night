// Permisos retenidos: el corazón de Peaje.
//
// Claude Code dispara PermissionRequest de forma SÍNCRONA y acepta que el hook responda
// allow/deny en nombre del usuario. Sostenemos esa petición abierta mientras el humano
// decide desde el widget flotante.
//
// Garantía dura (CONTRACT.md §3): si nadie decide, respondemos vacío y Claude Code muestra
// el prompt normal. Un timeout del hook es error NO bloqueante. Nunca colgamos un agente.

import { randomBytes, timingSafeEqual } from 'node:crypto';

const HOLD_MS = 85_000; // el hook tiene timeout: 90 → 5s de margen
const PERMITS = new Map();

export function pendingFor(token, now = Date.now()) {
  const out = [];
  for (const p of PERMITS.values()) {
    if (p.token !== token) continue;
    out.push({
      id: p.id,
      sessionId: p.sessionId,
      repo: p.repo,
      who: p.who,
      tool: p.tool,
      input: p.input,
      advice: p.advice,
      expiresInMs: Math.max(0, p.expiresAt - now),
    });
  }
  return out;
}

// Retiene la petición HTTP del hook. `res` es el response de Express, sin contestar todavía.
export function hold({ token, who, payload, res, onAdvice }) {
  // ID impredecible: aprobar un permiso ejecuta un comando en la máquina de alguien.
  // Un contador secuencial dejaría que un extraño adivine el siguiente y lo apruebe.
  const id = 'perm_' + randomBytes(12).toString('base64url');
  const input = payload.tool_input || {};
  const p = {
    id,
    token,
    sessionId: payload.session_id,
    repo: payload.cwd,
    who: who || 'yo',
    tool: payload.tool_name || 'desconocida',
    input: input.command || input.file_path || JSON.stringify(input).slice(0, 300),
    advice: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + HOLD_MS,
    res,
  };
  PERMITS.set(id, p);

  // Si el humano cierra Claude Code o el agente se cancela, soltamos la referencia.
  res.on('close', () => {
    if (PERMITS.get(id) === p) {
      clearTimeout(p.timer);
      PERMITS.delete(id);
    }
  });

  p.timer = setTimeout(() => {
    if (PERMITS.get(id) !== p) return;
    PERMITS.delete(id);
    // Nadie decidió: 200 vacío → Claude Code muestra el prompt normal en la terminal.
    if (!p.res.writableEnded) p.res.status(200).end();
  }, HOLD_MS);
  p.timer.unref?.();

  // La recomendación de la IA llega después y se adjunta cuando esté. Los botones
  // aparecen en el widget de inmediato, con o sin ella.
  if (onAdvice) {
    onAdvice(p)
      .then((advice) => { if (PERMITS.get(id) === p) p.advice = advice; })
      .catch(() => {});
  }

  return p;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// `token` es obligatorio: solo quien tiene el token del equipo decide sobre sus permisos.
export function resolve(id, decision, token) {
  const p = PERMITS.get(id);
  if (!p) return false;
  if (!sameToken(p.token, token)) return false;
  PERMITS.delete(id);
  clearTimeout(p.timer);
  if (p.res.writableEnded) return false;
  p.res.status(200).json({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: decision === 'allow' ? 'allow' : 'deny' },
    },
  });
  return true;
}

export function countFor(token) {
  let n = 0;
  for (const p of PERMITS.values()) if (p.token === token) n++;
  return n;
}
