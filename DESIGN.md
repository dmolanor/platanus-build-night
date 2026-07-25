# DESIGN.md — sistema visual y de voz de Peaje

> Hermano de `CONTRACT.md`. Ese manda sobre los datos; este manda sobre lo que se ve y lo que se
> lee. Si un cambio visual lo contradice, **para y avisa**.
>
> Los tokens viven en `public/theme.css`. Este archivo explica **por qué**, para que nadie tenga
> que adivinar leyendo CSS.

---

## 0. La dirección, en una línea

**Terminal editorial.** Un dev tool que vive encima de una terminal, no una landing de SaaS.
Oscuro, denso, tipográfico, con números en vez de adjetivos.

Dos referencias, cada una por una sola cosa:

- **AppSignal** — el sustrato dev-nativo y el titular basado en el dolor real del usuario.
- **Umano** — la disciplina compositiva: un solo objeto focal por pantalla, espacio negativo que
  empuja la mirada.

Lo que **no** se copia de ninguna de las dos: los doodles de AppSignal (ver §5) y el hero centrado
de Umano (ver §4).

---

## 1. La ley tipográfica

Es la única regla que hay que recordar:

> **mono = la voz de la máquina. sans = la voz del producto.**

| Cuál | Stack | Para qué |
|---|---|---|
| `--font-mono` | `ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace` | eyebrows, etiquetas, métricas, timers, costos, tokens, comandos, repos, ids, diagramas de flujo |
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` | titulares, lede, prosa, botones |

Reglas duras:

- **Todo número lleva `font-variant-numeric: tabular-nums`.** Un contador que salta de ancho al
  cambiar de dígito arruina la sensación de instrumento. Ya está en `.debt` y `.sess-cost`; ahora
  es global.
- Las etiquetas mono van uppercase con `letter-spacing: .14em`. El tracking ancho es lo que las
  hace leer como etiqueta y no como texto.
- Display: `font-weight: 800`, `letter-spacing: -0.04em`. El tracking negativo a tamaño grande es
  lo que separa un titular diseñado de uno por defecto.
- **Cero webfonts.** Ni CDN ni self-hosted. Cero requests de red, misma razón por la que el QR se
  genera en el servidor: la demo no depende de la red.

Escala (en `theme.css`):

```
--t-display  clamp(40px, 8vw, 76px)   800   -0.04em
--t-h2       clamp(22px, 3.4vw, 32px) 700   -0.02em
--t-lede     clamp(17px, 2.2vw, 22px) 400
--t-body     16px / 1.55
--t-small    14px
--t-label    11px  mono  uppercase  .14em
```

---

## 2. Color: tres semánticos, ni uno inventado

Los tres colores son **exactamente los niveles que la máquina de estado ya produce**
(`CONTRACT.md` §1). No se inventa paleta; se le pone nombre a lo que existe y se le da un solo
trabajo a cada uno.

| Token | Hex | Único trabajo |
|---|---|---|
| `--calm` | `#2fbf71` | nadie te espera |
| `--warn` | `#ffd23f` | atención · la marca · el peaje |
| `--red` | `#ff4d4d` | alguien está bloqueado |

Un color = un significado. Si un elemento es amarillo, es porque reclama atención. Si hace falta un
cuarto color, la respuesta por defecto es **no**.

### Escala de tinta

Absorbe los ocho grises sueltos que había repartidos entre `index.html` y `style.css`
(`#c9c9d4`, `#b6b7c4`, `#9a9baa`, `#d7d8e2`, `#4d4e5a`, `#3a3b45`, `#8a8b98`, `#7a7b88`):

```
--ink-0   #0a0b0e   el pozo: bloques de comando
--ink-1   #0d0e12   fondo
--ink-2   #15161c   panel
--ink-3   #1b1c24   panel elevado
--line    #26272f   hairline
--line-2  #3a3b45   borde de control secundario
--dim-2   #4d4e5a   metadata terciaria
--dim     #8a8b98   metadata
--soft    #b6b7c4   prosa secundaria
--text    #e9e9ee   prosa
```

### Dos desambiguaciones que causaron el problema original

- **`--hot` es el token dinámico "color de la deuda"**, y solo eso. `body[data-level]` lo reescribe
  (`style.css:42-46`): `#9a9baa` en calm → `#ffd23f` en nudge → `#ff5a5a` en angry → `#ff6b6b` en
  toll. **El rojo fijo se llama `--red`.** La landing usaba `--hot` como rojo estático y el widget
  como token dinámico: de ahí salieron los dos sistemas divergentes.
- **`--ink-1` está congelado en `#0d0e12`** porque el generador de QR lo tiene hardcodeado
  (`server/index.js:199`). Cambiar el fondo rompería el contraste del QR sin que nada avise.

---

## 3. Radios, espacio, movimiento

**Radios: cuatro valores, y son chicos a propósito.** Había dos escalas incompatibles (landing
6/8/9/10/11/12; widget 3/4/5/6/7/8/9/10). Los radios grandes son lo que produce el look "burbuja
SaaS", así que la escala nueva es deliberadamente afilada:

```
--r-1   4px    chips, tags, barras
--r-2   8px    botones, inputs, tarjeta de permiso
--r-3   10px   paneles
```

No hay `border-radius: 999px`. Nada tiene forma de píldora.

**Espacio: múltiplos de 4.** `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`. Nada intermedio.

**Movimiento:**

```
--ease   cubic-bezier(.2, .8, .3, 1)
140ms    hover
260ms    entrada de un elemento nuevo
400ms    transición de color por nivel
```

El movimiento solo existe cuando **transporta información**: algo llegó, algo cambió de estado,
algo se está agotando. Nada se mueve para decorar.

Dos animaciones existentes son la firma del producto y **no se tocan**:

- `@keyframes slam` — la tarjeta de permiso entra de golpe. Un permiso retenido es un proceso
  congelado en la máquina de alguien; entrar suave sería mentir sobre la urgencia.
- `@keyframes bump` — el contador de deuda late al cruzar un minuto entero.

`prefers-reduced-motion: reduce` mata todo salvo las barras de tiempo, que son informativas y no
decorativas (`style.css:752-761` ya lo hace bien; la landing tenía el bloque faltando).

---

## 4. Composición

- **Alineación a la izquierda.** El texto de cuerpo nunca va centrado. Solo el número gigante de la
  vista de peaje se centra, porque ahí es el único objeto en pantalla.
- **Asimetría deliberada.** El hero no está centrado: el tipo va a la izquierda del grid, el objeto
  focal desplazado. La simetría perfecta es lo que hace que una página se lea como plantilla.
- **Secciones de largo desigual.** Una sección de tres frases al lado de una de diez está bien y es
  intencional. Un ritmo constante es una firma de plantilla.
- **Reglas hairline antes que cajas.** `1px solid var(--line)` para separar. Las cajas dentro de
  cajas dentro de cajas son un tell. La tarjeta de permiso sí es una caja, porque es una
  interrupción y tiene que leerse como tal.
- **Profundidad por tinta, no por sombra.** Los escalones `--ink-0..3` construyen la jerarquía.
  **Cero `box-shadow` decorativo.** Sobre fondo oscuro una sombra no se ve; lo que se ve es el glow,
  y el glow es slop.
- **Un solo acento por sección.** Si ya hay algo amarillo, lo demás es tinta.
- **Datos reales, nunca lorem.** El hero de la landing embebe el widget de verdad, corriendo. Un
  mockup se desincroniza del producto; el producto no puede.

---

## 5. Patrones visuales prohibidos

Lista literal. Todos son tells de interfaz generada por IA, y cualquiera de ellos hunde la
credibilidad de una herramienta para devs.

- ❌ **Gradientes violeta/índigo/azul.** `linear-gradient(135deg, #667eea, #764ba2)` y toda su
  familia. Es la firma más reconocible que existe.
- ❌ **Texto con gradiente** (`background-clip: text`). Nunca.
- ❌ **Glassmorphism.** `backdrop-filter: blur()` + `rgba(255,255,255,.1)` + borde blanco de 1px.
- ❌ **Glow y sombras de neón.** `box-shadow: 0 0 40px rgba(...)`. Única excepción: el
  `text-shadow` del número en la vista de peaje, que ya existe y significa algo.
- ❌ **Emoji como iconos** en tarjetas de feature (🚀 ⚡ 🔒 ✨). Los `⚠` y `✓` semánticos sí.
- ❌ **Tres tarjetas simétricas en fila** con icono arriba, título de tres palabras y descripción de
  dos líneas del mismo largo.
- ❌ **Icono dentro de un cuadrado redondeado con fondo tintado.** El "icon chip" ubicuo.
- ❌ **Blobs de fondo:** manchas radiales borrosas en las esquinas.
- ❌ **Mockups con cromo de navegador falso** y sombra flotante.
- ❌ **Badge de píldora sobre el titular** del tipo `✨ Nuevo`.
- ❌ **Scroll-reveal uniforme:** cada sección apareciendo con el mismo fade-up de 0.5 s.
- ❌ **Nav flotante en forma de píldora.** Se volvió el elemento más copiado de las landings
  generadas. La barra de Peaje va a ras del grid.
- ❌ **`hover: scale(1.05)` + sombra** en cada tarjeta.
- ❌ **Slate-900 con acento índigo** (`#0f172a` + `#6366f1`): el dark mode por defecto de Tailwind.
- ❌ **Fila de logos "Confían en nosotros".** No hay clientes. Inventarlos es mentir.

---

## 6. Voz

El copy es donde más fácil se cuela el texto generado, y donde más caro sale.

### La regla de oro

> **El copy se compone citando y comprimiendo `docs/que-estamos-construyendo.md` y `CONTRACT.md`.
> No se genera prosa nueva de marketing.**

Frase por frase: **¿esto ya lo dice un doc, o me lo acabo de inventar?** Si es lo segundo, se borra
o se reemplaza por un número.

Funciona porque los docs ya son anti-slop por construcción. Citan cifras verificadas (85,15 s de
retención medidos en producción; 105.533 PRs de agentes; $60/h; umbrales 2/5/10 min) y dejan hilos
abiertos a propósito: *"el bloqueo no bloquea nada real"*, *"evidencia N=1"*. **El texto generado
nunca admite un límite.** Por eso la sección "Lo que no hace" de la landing no es humildad
decorativa: es la defensa estructural.

### Construcciones prohibidas

- `No es solo X, es Y` · `No se trata de X, sino de Y` — la simetría más delatora que existe.
- `Ya seas X o Y…` · `Imagina que…` · `Como desarrollador, sabes que…` — empatía de plantilla.
- `Y aquí está lo mejor:` · `Pero aquí está el detalle:` · `Lo que casi nadie ve:` — prometen
  revelación y entregan lo obvio.
- `Dile adiós a…` · `¿Listo para empezar?` · `En resumen,` — CTA y cierre de plantilla.
- `En el mundo actual del desarrollo…` — apertura de plantilla.

### Léxico prohibido

potencia · impulsa · desbloquea · revoluciona · eleva · transforma la manera en que · sin fricción ·
sin esfuerzo · experiencia fluida · de última generación · robusto · aprovecha · optimiza tu flujo ·
lleva tu X al siguiente nivel · panorama · profundizar · ecosistema (salvo citando el doc).

### Forma

- **Em-dash: presupuesto, no prohibición.** El tell no es el guion; es usarlo tres veces por
  párrafo para empalmar cláusulas que deberían ser oraciones. Los docs lo usan y es la voz del
  autor, no hay que pelearla. Máximo uno por párrafo.
- **Cero adjetivo donde quepa un número.** `85 s`, no `ultra-rápido`. `105.533 PRs`, no `masivo`.
- **Cero estadística inventada, cero testimonio, cero logo.** La evidencia está marcada como
  **N=1** en el doc §2 y la landing no puede contradecirlo.
- **Variar el largo de las oraciones.** El texto generado promedia todo a 18 palabras.
- **Un tricolon en toda la página**, no uno por párrafo. `rápido, simple y confiable` no existe.
- **Nada de Title Case en español.** No es slop, es error de idioma, pero viaja en el mismo paquete.

---

## 7. Personalización

Sin cuentas, sin sesiones, sin base de datos. **La configuración vive en `localStorage` y viaja en
la query string de la URL del widget.** Como el QR se genera desde esa misma URL, el celular hereda
los ajustes sin login. Eso es lo que hace que esto no cueste backend.

| Ajuste | localStorage | Param | Dónde se aplica |
|---|---|---|---|
| Nombre | `peaje_who` | `&who=` | `/api/hooks.json`, en la URL de cada hook |
| Tarifa $/h | `peaje_rate` | `&rate=` | `server/index.js`, sobreescribe `snap.cost` |
| Mostrar dinero | `peaje_money` | `&money=0` | idem |
| Sensibilidad | `peaje_sens` | `&sens=relax\|normal\|strict` | idem, recalcula `snap.level` |
| Carita on/off | `peaje_face` | `&face=0` | `settings.js` → `body[data-face="0"]` |
| Voz | `peaje_mute` | `&voice=0` | `settings.js` siembra la clave |

Sensibilidad, en minutos de `nudge`/`angry`/`toll`: `relax` 5/10/20 · `normal` 2/5/10 (el de
`CONTRACT.md` §1) · `strict` 1/3/5.

**El toggle de la carita es una posición de producto, no una preferencia.** El argumento contra
"¿es otro tamagotchi?" (doc §9) es que si le apagas la carita el producto sigue sirviendo.
Convertirlo en un switch real lo demuestra en vez de afirmarlo.

**El dinero se dice sin mentir.** Doc §4: *"Decir «X dólares de cómputo parado» es falso y se cae
con una pregunta."* Esperar no quema tokens. Lo que se pierde es capacidad paralela, o sea costo de
oportunidad. La copy siempre dice **capacidad**, nunca cómputo ni gasto.

---

## 8. No-goals

Enunciarlos es criterio de scope, mismo argumento que el doc §6.

- **Sin modo claro.** El widget flota sobre una terminal. Oscuro no es preferencia, es contexto.
- **Sin ilustraciones ni doodles sueltos.** El personaje de `character.js` (§10) **es** la
  ilustración, y es uno solo (representa la deuda, no a los agentes). Un doodle mal hecho lee peor
  que ninguno.
- **Sin i18n.** Todo en español.
- **Sin librerías, sin bundler, sin webfonts.** `CONTRACT.md` §8.

---

## 9. El personaje: un plátano que madura

Era una bola con cara. Ahora es un plátano, y el cambio es de tesis, no de gusto.

**La maduración *es* la métrica.** Una bola necesita una cara que te *diga* que está enojada. Un
plátano que se pone marrón *muestra* tiempo acumulado sin que nadie lo explique. Es el único objeto
cotidiano cuya apariencia es un reloj, y esta herramienta mide exactamente eso: tiempo transcurrido
desde que hacías falta.

**Culpa a la entropía, no a ti.** El doc §1 abandonó *"tú eres el rate limiter"* porque convertía al
usuario en el defecto. Una bola roja vibrando de rabia arrastra ese problema: está enojada *contigo*.
Un plátano madurándose no acusa a nadie. Solo pasó el tiempo.

Y es Platanus Build Night. El chiste sale gratis.

| Nivel | Estado | `--ball` | `--ball-dark` |
|---|---|---|---|
| `calm` | verde, sonriendo | `#9fd356` | `#4a7a1e` |
| `nudge` | amarillo, primeras manchas | `#f5c518` | `#9a7400` |
| `angry` | manchado, ceño | `#c8801f` | `#6b3d08` |
| `toll` | puré | `#7a5128` | `#3c2410` |

Reglas de construcción, todas por una razón concreta:

- **El cuerpo es un trazo grueso, no un contorno relleno.** El widget dibuja el personaje a
  `clamp(38px, 11vw, 64px)`. Un círculo sobrevive cualquier escala; una silueta de plátano con
  curvas finas se convierte en una mancha. Un `stroke-width: 28` con puntas redondas aguanta.
- **`character.js` reusa los nombres de clase de la bola** (`ch-all`, `ch-body-g`, `ch-face`,
  `ch-pupils`, `ch-lids`, `ch-brow`, `ch-mouth`). Todas las animaciones por nivel siguen viviendo
  en `style.css` y **el plátano las hereda enteras sin tocar ese archivo**.
- **Las manchas están siempre en el DOM** y el nivel solo cambia su opacidad, así que madurar es
  una transición y no un salto de markup.
- **Los párpados se recortan contra los ojos, no contra el cuerpo.** Es más correcto que en la bola
  (un párpado es parte del ojo) y además resuelve que un trazo no sirve como `clipPath`, que solo
  entiende geometría rellena.
- **El puré va centrado en `y≈69`, no pegado al piso del viewBox.** La vista de peaje escala el
  personaje a `min(150vw, 150vh)` centrado: cualquier cosa dibujada abajo se sale de la ventana y
  la cara desaparece. Costó un bug encontrarlo.
- **Solo se mueve `--ball`.** `--hot` (el número de la deuda) y `--red` (permisos) siguen rojos: el
  rojo es la alarma, el plátano es el tiempo. Son dos canales distintos y no deben fusionarse.
- **Nada de PNG.** `peaje-brief` §4.2 manda SVG + CSS, y cuatro rásters serían cuatro requests de
  red más el estilo de ilustración con degradados que §5 prohíbe.

---

## 10. Deuda conocida

- **`public/style.css` sigue declarando su propio `:root`.** `theme.css` se carga después y gana la
  cascada, así que el sistema es uno solo en la práctica, pero hay dos bloques de tokens en el
  repo. Se borra el de `style.css` cuando termine el trabajo en curso sobre el widget. Ugly y
  funcional, que es lo que `CLAUDE.md` autoriza para código que vive 8 horas.
- **El hero de la landing acuña un token de preview por pestaña** (`sessionStorage`), separado del
  token real del visitante: sembrarle sesiones de demo a su cola sería mentirle. Empezó siendo un
  string fijo compartido y eso resultó ser exactamente lo que el guardia de formato de
  `state.js:34` existe para rechazar. Un token por visitante cuesta memoria con TTL de 12 h, y a
  cambio quita una carrera: con el token compartido, cada visitante re-sembraba el hero de los
  demás.
- **El acumulado "perdido hoy" vive en memoria y cada redeploy lo borra** (doc §7.7). Se dice en la
  UI, no se esconde.
