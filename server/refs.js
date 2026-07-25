// Rama de git y referencias a issues/PRs, sacadas de lo que YA nos llega.
//
// El hallazgo que lo hace posible: `PostToolUse` incluye `tool_result`, o sea la
// SALIDA del comando. Cada vez que un agente corre `git status`, la respuesta
// trae "On branch feature/123-auth". Estábamos recibiendo la rama y tirándola.
//
// Nada de esto necesita credenciales ni red. Es el cimiento barato sobre el que
// después se puede emparejar contra GitHub — y si eso no llega, esto ya sirve
// para saber en qué rama está cada agente.

const RAMA = [
  /(?:^|\n)On branch ([^\s\n]+)/,                       // git status
  /Switched to (?:a new )?branch '([^']+)'/,            // git checkout / switch
  /Your branch is (?:up to date with|ahead of) '[^/]+\/([^'\n]+)'/,
  /(?:^|\n)\* ([^\s\n]+)/,                              // git branch (la marcada)
];

export function ramaDeSalida(texto) {
  if (!texto) return null;
  const t = String(texto).slice(0, 4000);
  for (const re of RAMA) {
    const m = t.match(re);
    const v = m && m[1];
    if (v && v !== 'HEAD' && v.length < 80 && !v.includes('(')) return v;
  }
  return null;
}

// Y del comando mismo, cuando es él quien la crea o la cambia.
export function ramaDeComando(cmd) {
  const m = String(cmd || '').match(/git\s+(?:checkout|switch)\s+(?:-b\s+|-c\s+)?([^\s;&|]+)/);
  const v = m && m[1];
  return v && !v.startsWith('-') && v !== 'HEAD' ? v : null;
}

// Números de issue/PR. Tres formas, todas comunes:
//   "arregla el #212"            → mención directa
//   github.com/o/r/issues/45     → URL pegada
//   fix/123-auth                 → convención de rama
export function refsDe(texto) {
  const out = new Set();
  const t = String(texto || '').slice(0, 4000);
  for (const m of t.matchAll(/(?:^|[\s([{,])#(\d{1,6})\b/g)) out.add(Number(m[1]));
  for (const m of t.matchAll(/github\.com\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/(\d{1,6})/gi)) out.add(Number(m[1]));
  return out;
}

// En una rama el número casi siempre va pegado a un separador: `fix/123-auth`,
// `123-descripcion`, `feature/PROJ-456`. Se busca aparte porque en prosa
// cualquier número suelto daría falsos positivos.
export function refsDeRama(rama) {
  const out = new Set();
  for (const m of String(rama || '').matchAll(/(?:^|[/_-])(\d{1,6})(?=[/_-]|$)/g)) {
    out.add(Number(m[1]));
  }
  return out;
}

export function anotar(destino, nums) {
  for (const n of nums) {
    if (Number.isInteger(n) && n > 0 && n < 100000) destino.add(n);
  }
  if (destino.size > 12) {
    const recortado = [...destino].slice(-12);
    destino.clear();
    for (const n of recortado) destino.add(n);
  }
}
