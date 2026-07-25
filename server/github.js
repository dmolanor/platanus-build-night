// Emparejamiento entre conversaciones e issues/PRs.
//
// La pregunta que hace esto valioso no es "muéstrame mis PRs" —eso ya lo hace
// GitHub y mejor— sino la INVERSA: **qué issues no tiene nadie encima**. Un
// tablero muestra lo que existe; esto muestra lo que nadie empezó. Y para saber
// qué falta hay que conocer la lista completa, así que aquí sí hace falta la API.
//
// El PAT vive en memoria, jamás se persiste, jamás se loguea, jamás sale en una
// respuesta ni en el stream. Entra por el BODY de un POST, nunca por la query:
// la auditoría ya nos recordó que Render y Cloudflare registran la URL entera.

const TTL_MS = 60_000;          // la latencia no importa para un PR de tres días
const TIMEOUT_MS = 6_000;
const MAX_REPOS = 4;
const MAX_ITEMS = 60;

const CONFIG = new Map();       // pingsToken → { pat, repos[], items[], at, error }

export function configurar(token, { pat, repos }) {
  if (!token) return null;
  const lista = String(repos || '')
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r))
    .slice(0, MAX_REPOS);

  if (!pat || !lista.length) {
    CONFIG.delete(token);
    return { repos: [], conectado: false };
  }
  CONFIG.set(token, { pat: String(pat), repos: lista, items: [], at: 0, error: null });
  return { repos: lista, conectado: true };
}

export function estado(token) {
  const c = CONFIG.get(token);
  if (!c) return { conectado: false, repos: [], error: null };
  // Nunca se devuelve `pat`. Ni acá ni en ningún otro lado.
  return { conectado: true, repos: c.repos, error: c.error, items: c.items.length };
}

export function olvidar(token) {
  CONFIG.delete(token);
}

async function traerRepo(pat, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/issues?state=open&per_page=${MAX_ITEMS}&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pings',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!r.ok) throw new Error(`${repo}: ${r.status}`);
  const json = await r.json();
  return json.map((i) => ({
    repo,
    numero: i.number,
    titulo: String(i.title || '').slice(0, 140),
    esPR: Boolean(i.pull_request),
    asignado: i.assignee?.login || null,
    // El cuerpo solo se usa para que el modelo empareje; nunca se muestra entero.
    resumen: String(i.body || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    url: i.html_url,
    actualizado: i.updated_at,
  }));
}

/** Refresca con TTL. Nunca lanza: si GitHub falla, se queda con lo último bueno. */
export async function refrescar(token) {
  const c = CONFIG.get(token);
  if (!c) return [];
  if (Date.now() - c.at < TTL_MS) return c.items;
  c.at = Date.now();
  try {
    const lotes = await Promise.all(c.repos.map((r) => traerRepo(c.pat, r)));
    c.items = lotes.flat().slice(0, MAX_ITEMS * MAX_REPOS);
    c.error = null;
  } catch (e) {
    c.error = String(e?.message || e).slice(0, 120);
  }
  return c.items;
}

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
