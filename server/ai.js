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
// El brief re-ordena leyendo cada sesión, así que tarda más que una respuesta
// corta. El widget muestra "reconstruyendo…" mientras tanto, así que la espera es
// legible; pasado esto, el fallback determinista entra sin que se note.
const BRIEF_TIMEOUT_MS = 10_000;

// Por qué falló la última llamada. Solo el tipo, nunca contenido.
export const lastAiError = { brief: null, advice: null };

function parseJson(response) {
  const text = response.content.find((b) => b.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

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
    // El porqué y la acción salen de state.js: son los mismos que ve la lista por
    // defecto, así el brief no contradice lo que ya tenías en pantalla.
    items: ranked.map((s) => ({
      sessionId: s.sessionId,
      label: s.label,
      repo: s.repo,
      who: s.who,
      minutes: minutes(s.costMs ?? s.waitedMs),
      tag: s.loopCount >= 1 ? 'en_loop' : s.reason === 'completed' ? 'casi_lista' : 'bloqueada',
      why: s.why || 'Te está esperando',
      action: s.action || 'Ve a esta primero',
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
  } catch (e) {
    lastAiError.advice = String(e && e.name || 'error') + ': ' + String(e && e.message || '').slice(0, 160);
    return fallbackAdvice(permit);
  }
}

// `tag` es la señal que el ranking mecánico no puede producir: no dice que la
// sesión está esperando (eso ya lo sabemos), dice CÓMO tratarla.
const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Una frase en español: por dónde empezar y por qué.' },
    items: {
      type: 'array',
      description: 'En el orden en que conviene atenderlas. El orden ES la recomendación.',
      items: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          tag: {
            type: 'string',
            enum: ['casi_lista', 'bloqueada', 'en_loop', 'cara_de_retomar', 'ya_no_importa'],
          },
          why: { type: 'string', description: 'Dónde quedó, concreto. Máximo 14 palabras.' },
          action: { type: 'string', description: 'Qué hacer. Imperativo, máximo 12 palabras.' },
        },
        required: ['sessionId', 'tag', 'why', 'action'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'items'],
  additionalProperties: false,
};

const BRIEF_SYSTEM = `El desarrollador acaba de volver al teclado. Tiene varias sesiones de Claude Code
paradas esperándolo. Tu trabajo NO es repetir cuál lleva más tiempo — eso ya está calculado.
Tu trabajo es decidir POR CUÁL EMPEZAR, usando lo que solo se ve leyendo cada sesión:

1. CERCANÍA A TERMINAR — una sesión a un paso de cerrar es barata: ciérrala y baja el número de
   frentes abiertos. Vale más que una que apenas arrancó, aunque lleve menos tiempo esperando.
2. CONSECUENCIA DEL BLOQUEO — no todos los permisos pesan igual. Leer un archivo y borrar una
   tabla de producción son ambos "permiso"; solo uno es urgente.
3. COSTO DE RETOMARLA — reconstruir el contexto de un refactor que dejó hace 40 minutos le cuesta
   caro a él. Confirmar algo terminado no cuesta nada.
4. VIGENCIA — si por lo que pidió después se ve que cambió de rumbo, esa sesión ya no importa:
   dilo y recomienda cerrarla.

Etiquetas: casi_lista · bloqueada · en_loop · cara_de_retomar · ya_no_importa.
Si repite el mismo intento, es en_loop y se cierra: está quemando tokens sin avanzar.

Devuelve los items EN EL ORDEN EN QUE CONVIENE ATENDERLOS — ese orden es tu recomendación, y
puede diferir del orden por costo que te doy. En español, seco, sin cortesías.
Usa los sessionId tal cual.`;

// El corazón del producto: cuando vuelves, lo caro no es saber a cuál ir,
// es reconstruir qué estaba pasando en cada una.
export async function aiBrief(snap) {
  const fallback = fallbackBrief(snap);
  if (!client) { lastAiError.brief = 'sin ANTHROPIC_API_KEY'; return fallback; }
  if (!snap.sessions.length) return fallback;
  lastAiError.brief = null;
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
        system: BRIEF_SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              `Deuda total: ${minutes(snap.totalWaitedMs)} agent-minutos.\n` +
              `Orden por costo mecánico (referencia, no obligación):\n\n` +
              ranked
                .map(
                  (s, i) =>
                    `${i + 1}. sessionId: ${s.sessionId}\n` +
                    `   se llama: ${s.label}\n` +
                    `   repo: ${s.repo} · de: ${s.who} · ${s.status}/${s.reason}\n` +
                    `   cuesta: ${minutes(s.costMs ?? s.waitedMs)} agent-min` +
                    `${s.blockedAgents > 1 ? ` (${s.blockedAgents} agentes parados)` : ''}` +
                    ` · intentos repetidos: ${s.loopCount}\n` +
                    `   lo último que le pidió: ${s.lastPrompt || '(no registrado)'}\n` +
                    `   dónde quedó: ${s.lastMessage || '(sin mensaje)'}`,
                )
                .join('\n\n'),
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
        return {
          sessionId: i.sessionId,
          label: s.label, repo: s.repo, who: s.who,
          minutes: minutes(s.costMs ?? s.waitedMs),
          tag: i.tag || null, why: i.why, action: i.action,
        };
      });
    if (!items.length) return fallback;
    return { source: 'ia', headline: out.headline || fallback.headline, items };
  } catch (e) {
    lastAiError.brief = String(e && e.name || 'error') + ': ' + String(e && e.message || '').slice(0, 160);
    return fallback;
  }
}
