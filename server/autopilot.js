// Piloto automático: aprobar lo rutinario mientras el humano no está, para que
// sus agentes no se detengan.
//
// Es lo ÚNICO en todo Peaje que ejecuta algo en la máquina de alguien sin que
// mire. Por eso aquí no hay modelo, no hay heurística difusa y no hay beneficio
// de la duda: una lista blanca cerrada, y todo lo que no esté en ella espera.
//
// Regla que ordena el archivo: si tengo que pensarlo, es que no.

// Herramientas que por definición no escriben nada.
const SOLO_LECTURA = new Set(['Read', 'Glob', 'Grep', 'NotebookRead']);

// Comandos de shell inofensivos. Se compara el comando COMPLETO contra estos
// prefijos; cualquier cosa fuera de la lista espera al humano.
const BASH_SEGURO = [
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df', 'echo',
  'which', 'whoami', 'date', 'env',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'git rev-parse', 'git blame', 'git stash list',
  'npm test', 'npm run test', 'npm ls', 'npm outdated',
  'pnpm test', 'yarn test',
  'node --check', 'node -v', 'npm -v', 'python --version',
  'grep', 'rg', 'find', 'tree', 'jq',
];

// Cualquiera de estos convierte un comando "seguro" en un vehículo para otro:
// `ls && rm -rf /`. Si aparece uno solo, no se aprueba.
const ENCADENA = /[;&|><`$(){}]|\bsudo\b|\bnpx\b|\bcurl\b|\bwget\b|--force|\bxargs\b|\beval\b|\bexec\b/;

function bashEsSeguro(cmd) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 200) return false;
  if (ENCADENA.test(c)) return false;
  return BASH_SEGURO.some((p) => c === p || c.startsWith(p + ' '));
}

/**
 * ¿Se puede aprobar esto solo? Devuelve { auto: boolean, razon: string }.
 * `razon` sirve para el registro que ve el humano al volver — en los dos casos.
 */
export function decidir({ tool, input, collision, away, encendido }) {
  if (!encendido) return { auto: false, razon: 'piloto automático apagado' };
  if (!away) return { auto: false, razon: 'estás en el teclado, decides tú' };

  // Dos agentes sobre el mismo archivo no se resuelve solo, ni siquiera leyendo.
  if (collision) return { auto: false, razon: `colisión con ${collision.who}` };

  if (SOLO_LECTURA.has(tool)) {
    return { auto: true, razon: `${tool} no escribe nada` };
  }

  if (tool === 'Bash') {
    const cmd = input && typeof input === 'object' ? input.command : input;
    if (bashEsSeguro(cmd)) return { auto: true, razon: 'comando de solo lectura' };
    return { auto: false, razon: 'comando fuera de la lista blanca' };
  }

  return { auto: false, razon: `${tool} puede escribir` };
}

export const listaBlanca = { herramientas: [...SOLO_LECTURA], comandos: BASH_SEGURO };
