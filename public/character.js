// La bola. No es una mascota: es la deuda que les debes, con cara.
// Una sola bola por ventana (puede montarse en varios slots: normal y peaje),
// nunca una por sesión.
//
// SVG + CSS puro. Aquí solo se construye el SVG y se pone data-level;
// todo el color, la deformación y las animaciones viven en style.css.

const SVG_NS = 'http://www.w3.org/2000/svg';

// La boca es lo único que cambia de forma "a mano": el resto es CSS.
const MOUTHS = {
  calm:  'M46 76 Q60 87 74 76',
  nudge: 'M47 80 L73 80',
  angry: 'M46 87 Q60 73 74 87',
  toll:  'M43 88 Q60 70 77 88',
};

const LEVELS = ['calm', 'nudge', 'angry', 'toll'];

const instances = [];
let current = 'calm';
let seq = 0;

function node(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Monta una bola dentro de `host`. Devuelve el elemento raíz.
export function mount(host) {
  if (!host) return null;

  const root = document.createElement('div');
  root.className = 'peaje-char';
  root.setAttribute('aria-hidden', 'true');

  const svg = node('svg', { viewBox: '0 0 120 120', preserveAspectRatio: 'xMidYMid meet' });

  // Los párpados se recortan contra el cuerpo: fuera de la bola no existen.
  const clipId = 'peaje-ball-clip-' + ++seq;
  const defs = node('defs');
  const clip = node('clipPath', { id: clipId });
  clip.appendChild(node('circle', { cx: 60, cy: 60, r: 42 }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const all = node('g', { class: 'ch-all' });

  all.appendChild(node('ellipse', { class: 'ch-shadow', cx: 60, cy: 106, rx: 30, ry: 5 }));

  // Cuerpo: un círculo. Se deforma con transform desde CSS.
  const bodyG = node('g', { class: 'ch-body-g' });
  bodyG.appendChild(node('circle', { class: 'ch-body', cx: 60, cy: 60, r: 42 }));
  bodyG.appendChild(node('circle', { class: 'ch-shine', cx: 44, cy: 42, r: 11 }));

  // Cara dentro del mismo grupo: se deforma junto al cuerpo, como debe ser.
  const face = node('g', { class: 'ch-face' });

  // Dos elipses de ojos.
  face.appendChild(node('ellipse', { class: 'ch-eye', cx: 45, cy: 56, rx: 9, ry: 11 }));
  face.appendChild(node('ellipse', { class: 'ch-eye', cx: 75, cy: 56, rx: 9, ry: 11 }));

  const pupils = node('g', { class: 'ch-pupils' });
  pupils.appendChild(node('ellipse', { class: 'ch-pupil', cx: 45, cy: 57.5, rx: 4.2, ry: 5.2 }));
  pupils.appendChild(node('ellipse', { class: 'ch-pupil', cx: 75, cy: 57.5, rx: 4.2, ry: 5.2 }));
  face.appendChild(pupils);

  // Párpados del color del cuerpo: bajan y dejan los ojos entrecerrados (toll).
  const lids = node('g', { class: 'ch-lids', 'clip-path': `url(#${clipId})` });
  lids.appendChild(node('rect', { class: 'ch-lid', x: 32, y: 36, width: 26, height: 16, rx: 3 }));
  lids.appendChild(node('rect', { class: 'ch-lid', x: 62, y: 36, width: 26, height: 16, rx: 3 }));
  face.appendChild(lids);

  const brows = node('g', { class: 'ch-brows' });
  brows.appendChild(node('path', { class: 'ch-brow', d: 'M35 41 L54 47' }));
  brows.appendChild(node('path', { class: 'ch-brow', d: 'M85 41 L66 47' }));
  face.appendChild(brows);

  const mouth = node('path', { class: 'ch-mouth', d: MOUTHS.calm });
  face.appendChild(mouth);

  bodyG.appendChild(face);
  all.appendChild(bodyG);
  svg.appendChild(all);
  root.appendChild(svg);

  host.replaceChildren(root);

  const inst = { root, mouth };
  instances.push(inst);
  apply(inst, current);
  return root;
}

function apply(inst, level) {
  inst.root.dataset.level = level;
  inst.mouth.setAttribute('d', MOUTHS[level]);
}

// Cambia el humor de TODAS las bolas montadas.
export function setLevel(level) {
  const next = LEVELS.includes(level) ? level : 'calm';
  if (next === current) return current;
  current = next;
  for (const inst of instances) apply(inst, current);
  return current;
}

export function getLevel() {
  return current;
}
