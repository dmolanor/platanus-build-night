// Registro de la voz. Tres niveles, del más seco al más charro.
//
// El default es `seco` y es el que se muestra en un pitch: el producto se
// defiende solo, y una frase graciosa por defecto lo clasifica como juguete en
// veinte segundos. Los otros dos son opt-in explícito desde ajustes.
//
// Reglas de escritura, para que esto no se vuelva relleno genérico:
//   · Ni una exclamación. El reclamo seco pega más que el entusiasta.
//   · Nada de "¡Ups!", "parece que", "vaya" ni emoji. Eso es tono de asistente.
//   · Español colombiano de verdad — bogotano y paisa —, no español neutro con
//     una palabra rara encima.
//   · El número siempre está. Es un instrumento, no un chiste con datos.

const FRASES = {
  seco: {
    nudge: [
      (n, m) => `${n} agentes llevan ${m} minutos esperándote.`,
      (n, m) => `${n} agentes parados hace ${m} minutos.`,
    ],
    angry: [
      (n, m) => `${m} agent-minutos parados. Eso lo estás costando tú.`,
      (n, m) => `${m} agent-minutos. ${n} agentes sin avanzar.`,
    ],
    toll: [
      (n, m) => `${m} agent-minutos. Te digo a cuál volver primero.`,
      (n, m) => `${m} agent-minutos acumulados. Empieza por la primera.`,
    ],
  },

  // Conversacional y adulto. Ironía seca, sin jerga.
  suelto: {
    nudge: [
      (n) => `Tienes ${n} agentes mirando al techo.`,
      (n, m) => `${n} agentes llevan ${m} minutos sin nada que hacer.`,
    ],
    angry: [
      (n, m) => `${m} agent-minutos. Ya van siendo bastantes.`,
      (n) => `${n} agentes quietos, y ninguno se va a destrabar solo.`,
    ],
    toll: [
      (n, m) => `${m} agent-minutos. En algún momento hay que volver.`,
      (n, m) => `${m} agent-minutos. Nadie más va a decidir esto por ti.`,
    ],
  },

  // Colombiano. "Sumercé" y "ala" son bogotanos; "los tiene botados",
  // "qué oso" y "descaro" son de uso corriente. El usted es deliberado:
  // el reclamo en usted suena más grave que en tú.
  charro: {
    nudge: [
      (n) => `Ala, tiene ${n} agentes ahí parados.`,
      (n, m) => `Sumercé, ${n} agentes llevan ${m} minutos esperándolo.`,
      (n) => `Ojo que ${n} agentes están mirándose las manos.`,
    ],
    angry: [
      (n, m) => `Los tiene botados hace ${m} minutos.`,
      (n, m) => `${m} minutos, sumercé. Los dejó colgados.`,
      (n) => `Deje la pereza que hay ${n} agentes sin hacer nada.`,
    ],
    toll: [
      (n, m) => `${m} agent-minutos. Ya esto es descaro.`,
      (n, m) => `Qué oso. ${m} agent-minutos ahí quietos.`,
      (n, m) => `Se durmió, sumercé. ${m} agent-minutos les debe.`,
    ],
  },
};

export const TONOS = Object.keys(FRASES);

/**
 * Reescribe `snap.speak` en el registro pedido. Devuelve el texto o `null`.
 * `i` rota entre variantes para que no repita la misma frase cada vez que
 * vuelves a cruzar el mismo umbral.
 */
export function frase(tono, level, agentes, minutos, i = 0) {
  const set = FRASES[tono];
  if (!set || !set[level]) return null;
  const opciones = set[level];
  return opciones[i % opciones.length](agentes, minutos);
}
