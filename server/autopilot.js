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
//
// EXCLUIDOS a propósito, aunque "suenen" de solo lectura, porque ejecutan otros
// programas sin necesitar ningún operador de shell:
//   env   → `env rm -rf /` corre cualquier cosa
//   find  → `find . -delete` borra; `-exec` ejecuta
//   rg    → `--pre` y `--hostname-bin` corren un binario externo
//   jq    → innecesario aquí, y no vale la pena auditar sus flags
//   npm/pnpm/yarn test → ejecutan `scripts.test` del package.json, que en un repo
//                        clonado o en la rama de un PR NO lo escribiste tú
//   tree               → `-o ARCHIVO` escribe
const BASH_SEGURO = [
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df', 'echo',
  'which', 'whoami', 'date',
  'git status', 'git log', 'git diff', 'git show',
  'git rev-parse', 'git blame', 'git stash list',
  'npm ls', 'npm outdated',
  'node --check', 'node -v', 'npm -v', 'python --version',
  'grep',
];

// Solo en su forma EXACTA, sin argumentos. `git branch` a secas lista ramas;
// `git branch -D main` borra, y `git remote set-url` secuestra tu próximo push.
const BASH_EXACTO = new Set(['git branch', 'git remote']);

// Cualquiera de estos convierte un comando "seguro" en un vehículo para otro:
// `ls && rm -rf /`. Si aparece uno solo, no se aprueba.
const ENCADENA = /[;&|><`$(){}]|\bsudo\b|\bnpx\b|\bcurl\b|\bwget\b|\bxargs\b|\beval\b|\bexec\b/;

// Defensa en profundidad: banderas que ejecutan o destruyen aunque el binario
// esté en la lista. Si el binario permitido crece, esto sigue protegiendo.
// `--output` escribe el resultado en la ruta que le des. `git log --output=~/.bashrc
// --format=%s` escribe en tu shell bytes que controla quien haya escrito el asunto
// de un commit — y esos metacaracteres viven en el historial, nunca en el comando.
const BANDERA_PELIGROSA =
  /(^|\s)-(-)?(exec|execdir|delete|force|pre|pre-glob|ext-diff|eval|output|upload-pack|receive-pack|hostname-bin|fprint\w*|fls|ok|okdir)\b|--(pre|ext-diff|output)=/i;

function bashEsSeguro(cmd) {
  const c = String(cmd || '').trim();
  if (!c || c.length > 200) return false;

  // PRIMERO, y cierra una clase entera: solo ASCII imprimible. En bash un salto de
  // línea separa comandos igual que `;`, así que sin esto `cat README.md\nrm -rf ~`
  // pasaba por "cat". También mata tabs, NBSP y homoglifos unicode de un golpe.
  if (!/^[\x20-\x7E]+$/.test(c)) return false;

  if (ENCADENA.test(c)) return false;
  if (BANDERA_PELIGROSA.test(c)) return false;
  if (BASH_EXACTO.has(c)) return true;
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
