// Brief y recomendaciones. El fallback determinista es el camino principal:
// se construye primero y nunca se apaga. La IA es una mejora que puede fallar.
// CONTRACT.md §6.

import Anthropic from '@anthropic-ai/sdk';
import { score } from './state.js';

const MODEL = 'claude-opus-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// El permiso se retiene 85s, así que la recomendación puede tomarse su tiempo.
// El brief NO: el humano está mirando la pantalla esperándolo.
const ADVICE_TIMEOUT_MS = 15_000;
const BRIEF_TIMEOUT_MS = 5_000;

function parseJson(response) {
  const text = response.content.find((b) => b.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

const REASON_ES = {
  permission: 'pidió permiso',
  needs_input: 'necesita que decidas',
  failed: 'falló',
  completed: 'terminó, falta confirmar',
  idle: 'lleva rato quieta',
};

function minutes(ms) {
  return Math.max(1, Math.round(ms / 60000));
}

// Fallback aritmético: ranking + una línea de porqué, sin red y sin API key.
export function fallbackBrief(snap) {
  const ranked = snap.sessions
    .filter((s) => s.status === 'waiting' || s.status === 'done')
    .sort((a, b) => score(b) - score(a))
    .slice(0, 5);

  return {
    source: 'fallback',
    headline: ranked.length
      ? `${ranked.length} sesiones te esperan. ${minutes(snap.totalWaitedMs)} agent-minutos de deuda.`
      : 'Nadie te está esperando. Estás al día.',
    items: ranked.map((s) => ({
      sessionId: s.sessionId,
      repo: s.repo,
      who: s.who,
      minutes: minutes(s.waitedMs),
      why: REASON_ES[s.reason] || 'esperando',
      action:
        s.loopCount >= 1
          ? 'Se está dando vueltas: considera cerrarla.'
          : s.reason === 'permission'
            ? 'Decide el permiso desde aquí.'
            : s.reason === 'completed'
              ? 'Solo falta que confirmes.'
              : 'Ve a esta primero.',
    })),
  };
}

// Recomendación sobre un permiso retenido, sin IA: heurística de patrones destructivos.
const DANGEROUS = /rm\s+-rf|drop\s+(table|database)|force[- ]?push|--force|git\s+reset\s+--hard|truncate|delete\s+from|migrations?\b.*\b(borr|delet|drop)|\b(borr|delet|drop)\b.*\bmigrations?\b/i;

export function fallbackAdvice(permit, collision = null) {
  // La colisión es determinista: no necesita modelo y por eso sobrevive sin red.
  if (collision) {
    return {
      verdict: 'deny',
      why: `${collision.who} está tocando ese archivo hace ${Math.round(collision.agoMs / 60000)} min`,
      source: 'fallback',
    };
  }
  const text = `${permit.tool} ${permit.input}`;
  if (DANGEROUS.test(text)) {
    return { verdict: 'deny', why: 'toca algo destructivo e irreversible', source: 'fallback' };
  }
  return null; // sin opinión: el widget muestra los botones sin recomendación
}

// ── Capa de IA ───────────────────────────────────────────────────────────────
// Todo lo de aquí puede fallar. Nada de aquí es obligatorio.

const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['allow', 'deny', 'unsure'] },
    why: { type: 'string', description: 'Máximo 12 palabras, en español, sin punto final.' },
  },
  required: ['verdict', 'why'],
  additionalProperties: false,
};

// Decide por el humano ausente sobre un permiso que tiene a un agente congelado.
export async function aiAdvice(permit, session, collision = null) {
  if (!client) return fallbackAdvice(permit, collision);
  try {
    const contexto = session?.lastMessage ? `\nÚltimo mensaje del agente: ${session.lastMessage}` : '';
    const choque = collision
      ? `\nCOLISIÓN: ${collision.who} lleva ${Math.round(collision.agoMs / 60000)} min tocando ` +
        `este mismo archivo (${collision.surface}) desde otra sesión. Si ambos escriben, chocan en el merge.`
      : '';
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ADVICE_SCHEMA } },
        system:
          'Eres el copiloto de un desarrollador que está lejos del teclado. Un agente de Claude Code ' +
          'está CONGELADO esperando permiso para ejecutar algo. Decide si conviene permitirlo.\n' +
          'Criterio: "deny" solo si es destructivo, irreversible o toca producción sin respaldo. ' +
          '"allow" para lo rutinario (leer, listar, correr tests, instalar deps, editar código). ' +
          '"unsure" si de verdad depende de contexto que no tienes.\n' +
          'Si te reporto una COLISIÓN, pesa mucho: otro agente está tocando ese mismo archivo ' +
          'ahora y escribir encima produce un conflicto de merge. Ahí inclínate a "deny".\n' +
          'El campo "why" va en español, máximo 12 palabras, y dice la RAZÓN, no repite el comando.',
        messages: [
          {
            role: 'user',
            content: `Repo: ${permit.repo}\nHerramienta: ${permit.tool}\nEntrada: ${permit.input}${contexto}${choque}`,
          },
        ],
      },
      { timeout: ADVICE_TIMEOUT_MS },
    );
    const out = parseJson(response);
    if (!out) return fallbackAdvice(permit);
    return { ...out, source: 'ia' };
  } catch {
    return fallbackAdvice(permit);
  }
}

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Una frase en español con el costo total.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          why: { type: 'string', description: 'Qué pasa ahí. Máximo 12 palabras.' },
          action: { type: 'string', description: 'Qué hacer. Imperativo, máximo 12 palabras.' },
        },
        required: ['sessionId', 'why', 'action'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'items'],
  additionalProperties: false,
};

// El corazón del producto: cuando vuelves, lo caro no es saber a cuál ir,
// es reconstruir qué estaba pasando en cada una.
export async function aiBrief(snap) {
  const fallback = fallbackBrief(snap);
  if (!client || !snap.sessions.length) return fallback;
  try {
    const ranked = snap.sessions
      .filter((s) => s.status === 'waiting' || s.status === 'done')
      .sort((a, b) => score(b) - score(a))
      .slice(0, 6);
    if (!ranked.length) return fallback;

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 6000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
        system:
          'El desarrollador acaba de volver al teclado. Tiene varias sesiones de Claude Code paradas ' +
          'esperándolo. Reconstruye qué pasaba en cada una y ordénalas por urgencia real.\n' +
          'Busca tres señales: (1) bloqueo real — pidió permiso, falló, necesita decisión; ' +
          '(2) terminado y listo — solo falta confirmar; (3) en loop — repite el mismo intento, ' +
          'y ahí recomienda CERRARLA porque quema tokens sin avanzar.\n' +
          'Todo en español, seco, sin cortesías. Devuelve los items ya ordenados, el más urgente primero. ' +
          'Usa los sessionId tal cual te los doy.',
        messages: [
          {
            role: 'user',
            content:
              `Deuda total: ${minutes(snap.totalWaitedMs)} agent-minutos.\n\n` +
              ranked
                .map(
                  (s) =>
                    `- sessionId: ${s.sessionId} | repo: ${s.repo} | de: ${s.who} | ` +
                    `estado: ${s.status}/${s.reason} | esperando: ${minutes(s.waitedMs)} min | ` +
                    `intentos repetidos: ${s.loopCount} | tareas abiertas: ${s.tasksOpen}\n` +
                    `  último mensaje: ${s.lastMessage || '(ninguno)'}`,
                )
                .join('\n'),
          },
        ],
      },
      { timeout: BRIEF_TIMEOUT_MS },
    );

    const out = parseJson(response);
    if (!out?.items?.length) return fallback;

    // Reinyectamos los datos duros: la IA aporta el porqué, no los números.
    const byId = new Map(ranked.map((s) => [s.sessionId, s]));
    const items = out.items
      .filter((i) => byId.has(i.sessionId))
      .map((i) => {
        const s = byId.get(i.sessionId);
        return { sessionId: i.sessionId, repo: s.repo, who: s.who, minutes: minutes(s.waitedMs), why: i.why, action: i.action };
      });
    if (!items.length) return fallback;
    return { source: 'ia', headline: out.headline || fallback.headline, items };
  } catch {
    return fallback;
  }
}
