// Brief y recomendaciones. El fallback determinista es el camino principal:
// se construye primero y nunca se apaga. La IA es una mejora que puede fallar.
// CONTRACT.md §6.

import { score } from './state.js';

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

export function fallbackAdvice(permit) {
  const text = `${permit.tool} ${permit.input}`;
  if (DANGEROUS.test(text)) {
    return { verdict: 'deny', why: 'toca algo destructivo e irreversible', source: 'fallback' };
  }
  return null; // sin opinión: el widget muestra los botones sin recomendación
}
