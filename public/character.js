// El plátano. No es una mascota: es la deuda que les debes, madurándose.
//
// Por qué un plátano y no una bola: la maduración ES la métrica. Una bola necesita
// una cara que te DIGA que está enojada; un plátano que se pone marrón MUESTRA tiempo
// acumulado sin que nadie lo explique. Es el único objeto cotidiano cuya apariencia
// es un reloj. Y de paso culpa a la entropía en vez de a ti, que es exactamente el
// giro que pedía el doc §1 al abandonar "tú eres el rate limiter".
//
// Uno solo por ventana (montado en dos slots: normal y pings), nunca uno por sesión.
//
// SVG + CSS puro, como manda el brief original §4.2. Aquí solo se construye el SVG y se
// pone data-level. El color, la deformación y las animaciones viven en el CSS.
//
// CONTRATO DE CLASES: los nombres ch-all / ch-body-g / ch-face / ch-pupils / ch-lids /
// ch-brow / ch-mouth / ch-body / ch-shadow son los mismos de la bola. style.css les
// tiene colgadas todas las animaciones por nivel (breathe, stare, deform, vibrate,
// loom, sway) y NO se toca: el plátano las hereda enteras.

const SVG_NS = 'http://www.w3.org/2000/svg';

// El cuerpo es un trazo grueso con puntas redondas, no un contorno relleno. A 38 px
// —el tamaño mínimo del widget— un contorno con curvas finas se convierte en una
// mancha; un trazo de 28 sobrevive la escala y sigue leyéndose como plátano.
// Tres tramos del mismo lomo, de fino a grueso a fino. Un solo trazo con
// linecap redondo daba dos semiesferas idénticas en las puntas — o sea, un
// pepino. El plátano se afina en los extremos, y eso un stroke uniforme no lo
// puede hacer. Se mantiene el trazo (y no un contorno relleno) porque a 38 px
// —el mínimo del widget— un contorno fino se convierte en mancha.
const LOMO = [
  { d: 'M37 20 C46 27, 52 33, 56 41', clase: 'ch-body ch-body-fin' },
  { d: 'M53 36 C64 52, 65 70, 56 85', clase: 'ch-body ch-body-medio' },
  { d: 'M58 81 C55 89, 50 95, 45 99', clase: 'ch-body ch-body-fin2' },
];

// La boca es lo único que cambia de forma a mano. El resto es CSS.
const BOCAS = {
  calm:  'M52 74 Q60 82 68 73',
  nudge: 'M53 77 L67 77',
  angry: 'M52 82 Q60 71 68 80',
  toll:  'M50 84 Q60 70 70 82',
};

// En toll el plátano ya no es un plátano: es puré. La boca vive más abajo y más ancha.
const BOCA_TOLL = 'M49 76 Q60 64 71 76';

const LEVELS = ['calm', 'nudge', 'angry', 'toll'];

const instances = [];
let current = 'calm';
let seq = 0;

function node(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Monta un plátano dentro de `host`. Devuelve el elemento raíz.
export function mount(host) {
  if (!host) return null;

  const root = document.createElement('div');
  root.className = 'pings-char';
  root.setAttribute('aria-hidden', 'true');

  // viewBox ajustado a la TINTA, no a un cuadrado cómodo. Medido: con `0 0 120 120`
  // en un slot de 42x42 el plátano se dibujaba a 16x34 px — el 30% del área. La causa
  // no era el slot: la tinta de los tres tramos del lomo ocupa x 28,5..75,6 de 120,
  // así que el 61% del ancho estaba vacío y `preserveAspectRatio: meet` encajona una
  // forma vertical en un cuadrado hasta que cabe por su lado largo. Recortando el
  // viewBox se dibuja ~2,7x más grande Y ocupando menos ancho de layout que antes.
  const svg = node('svg', { viewBox: '25 5 54 105', preserveAspectRatio: 'xMidYMid meet' });

  // Los párpados se recortan contra LOS OJOS, no contra el cuerpo. Es más correcto que
  // en la bola: un párpado es parte del ojo. Y de paso resuelve que un trazo no se
  // puede usar como clipPath (clipPath solo entiende geometría rellena).
  const clipId = 'pings-ojos-' + ++seq;
  const defs = node('defs');
  const clip = node('clipPath', { id: clipId });
  clip.appendChild(node('ellipse', { cx: 53, cy: 55, rx: 6, ry: 7 }));
  clip.appendChild(node('ellipse', { cx: 67, cy: 55, rx: 6, ry: 7 }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const all = node('g', { class: 'ch-all' });
  all.appendChild(node('ellipse', { class: 'ch-shadow', cx: 52, cy: 105, rx: 19, ry: 4 }));

  const bodyG = node('g', { class: 'ch-body-g' });

  // ── El plátano ───────────────────────────────────────────────────────────
  const banana = node('g', { class: 'ch-banana' });
  for (const t of LOMO) banana.appendChild(node('path', { class: t.clase, d: t.d }));
  // Cabito y punta: los dos extremos se oscurecen antes que el resto, igual que
  // en un plátano de verdad.
  banana.appendChild(node('path', { class: 'ch-stem', d: 'M37 21 L34 12' }));
  banana.appendChild(node('path', { class: 'ch-tip', d: 'M45 98 L43 105' }));
  banana.appendChild(node('path', { class: 'ch-shine', d: 'M44 32 C58 46, 61 68, 52 84' }));

  // Manchas: siempre están en el DOM, el CSS las revela por nivel. Así la transición
  // entre estados es una animación de opacidad y no un salto de markup.
  const spots = node('g', { class: 'ch-spots' });
  const MANCHAS = [
    [55, 40, 3.4, 2.6, -18], [66, 55, 4.2, 3.1, 12], [58, 68, 2.8, 2.2, 30],
    [64, 82, 3.6, 2.5, -8], [49, 52, 2.4, 1.9, 20],
  ];
  for (const [cx, cy, rx, ry, rot] of MANCHAS) {
    spots.appendChild(node('ellipse', { class: 'ch-spot', cx, cy, rx, ry, transform: `rotate(${rot} ${cx} ${cy})` }));
  }
  banana.appendChild(spots);
  bodyG.appendChild(banana);

  // ── El puré (solo en toll) ───────────────────────────────────────────────
  // Pasado el umbral ya no hay plátano que salvar. El cambio de silueta dice más
  // que cualquier color: es el único estado que se lee de un vistazo a 38 px.
  //
  // Va centrado alrededor de y=69, no pegado al piso del viewBox. La vista de deuda alta
  // escala el personaje a min(150vw,150vh) centrado: cualquier cosa dibujada abajo
  // se sale de la ventana y la cara desaparece.
  const mush = node('g', { class: 'ch-mush' });
  mush.appendChild(node('path', {
    class: 'ch-mush-body',
    // Mismo ancho que el plátano: dos siluetas de anchos distintos dentro de un
    // viewBox recortado se ven descentradas una respecto de la otra.
    d: 'M28 70 C31 56, 42 47, 52 48 C63 49, 73 56, 75 68 C77 79, 64 86, 51 86 C36 86, 25 79, 28 70 Z',
  }));
  bodyG.appendChild(mush);

  // ── La cara ──────────────────────────────────────────────────────────────
  const face = node('g', { class: 'ch-face' });
  face.appendChild(node('ellipse', { class: 'ch-eye', cx: 53, cy: 55, rx: 6, ry: 7 }));
  face.appendChild(node('ellipse', { class: 'ch-eye', cx: 67, cy: 55, rx: 6, ry: 7 }));

  const pupils = node('g', { class: 'ch-pupils' });
  pupils.appendChild(node('ellipse', { class: 'ch-pupil', cx: 53, cy: 56, rx: 2.8, ry: 3.4 }));
  pupils.appendChild(node('ellipse', { class: 'ch-pupil', cx: 67, cy: 56, rx: 2.8, ry: 3.4 }));
  face.appendChild(pupils);

  const lidClip = node('g', { 'clip-path': `url(#${clipId})` });
  const lids = node('g', { class: 'ch-lids' });
  lids.appendChild(node('rect', { class: 'ch-lid', x: 44, y: 38, width: 32, height: 18, rx: 2 }));
  lidClip.appendChild(lids);
  face.appendChild(lidClip);

  const brows = node('g', { class: 'ch-brows' });
  brows.appendChild(node('path', { class: 'ch-brow', d: 'M46 43 L59 48' }));
  brows.appendChild(node('path', { class: 'ch-brow', d: 'M74 43 L61 48' }));
  face.appendChild(brows);

  const mouth = node('path', { class: 'ch-mouth', d: BOCAS.calm });
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
  inst.mouth.setAttribute('d', level === 'toll' ? BOCA_TOLL : BOCAS[level]);
}

// Cambia el estado de TODOS los plátanos montados.
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
