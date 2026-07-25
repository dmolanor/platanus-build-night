// Emparejamiento entre conversaciones e issues.
//
// Lo valioso no es "muéstrame mis PRs" —eso GitHub lo hace mejor— sino la
// pregunta INVERSA: **qué issue no tiene a nadie encima**. Un tablero muestra lo
// que existe; esto muestra lo que nadie empezó.
//
// Acá NO vive ninguna credencial. El navegador consulta GitHub por su cuenta y
// nos manda solo los títulos: el PAT nunca sale de la máquina del usuario.

/**
 * Empareja por número: si la sesión mencionó `#123`, o su rama es `fix/123-…`,
 * es un match duro y no necesita modelo. Devuelve también los huérfanos de los
 * dos lados, que es lo que el modelo tendrá que resolver después.
 */
export function emparejarPorNumero(items, sessions) {
  const porNumero = new Map();
  for (const it of items) porNumero.set(it.numero, it);

  const pares = [];
  const sesionesSinIssue = [];
  const emparejados = new Set();

  for (const s of sessions) {
    const refs = Array.isArray(s.refs) ? s.refs : [];
    const hit = refs.map((n) => porNumero.get(n)).find(Boolean);
    if (hit) {
      pares.push({ sessionId: s.sessionId, label: s.label, numero: hit.numero,
                   repo: hit.repo, titulo: hit.titulo, esPR: hit.esPR, como: 'referencia' });
      emparejados.add(hit.numero);
    } else {
      sesionesSinIssue.push(s);
    }
  }

  const huerfanos = items.filter((it) => !emparejados.has(it.numero));
  return { pares, huerfanos, sesionesSinIssue };
}
