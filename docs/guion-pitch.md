# Guion de pitch — 2:00 con demo en vivo

> Calibrado sobre el código real: `state.js:490` (reinicio), `index.js:95` (umbral de
> retención), `permits.js:13` (ventana de 85 s), `widget.html:836` (el brief se abre solo).
> Los tiempos de abajo salen de la fórmula, no de la intuición. **Ensáyalo con cronómetro.**
>
> **Ritmo:** 272 palabras habladas. A 155 pal/min (ritmo claro de pitch en español) son **105 s**,
> y quedan **15 s de aire** para las pausas del demo. Si te vas a 135 pal/min no cabe: 121 s y te
> comes el cierre. La primera versión de este guion tenía 373 palabras — 144 s, 24 s pasado.

---

## La aritmética del reloj

La deuda sube así: `total = agentes_parados × segundos_reales × reloj`.
Los umbrales son 2 min (amarillo), 5 min (manchado), 10 min (puré → abre el brief).

```
segundos_hasta_amarillo = 120 / (agentes × reloj)
segundos_hasta_manchado = 300 / (agentes × reloj)
segundos_hasta_puré     = 600 / (agentes × reloj)
```

**Validada contra el servidor**, no deducida: con 6 agentes a 2,5× predije 8 / 20 / 40 s y midió
**8 / 20 / 40**. Puedes confiar en los números de abajo para cronometrar.

**Plan: 3 sesiones esperando + la 4ª que disparas en vivo, reloj 2,5×.**

| Momento | Qué pasa en pantalla | De dónde sale |
|---|---|---|
| 0:19 | arrancas el reloj; el widget muestra `reloj 2.5×` solo | — |
| 0:35 | **amarillo** — desde aquí un permiso se retiene | 120/(3×2,5) = 16 s |
| 0:55 | disparas la 4ª sesión → llega el permiso | deuda = 4,5 min, ya pasó el umbral |
| ~1:08 | **manchado** | — |
| **1:28** | **puré → el brief se abre solo** | (600−270)/(4×2,5) = 33 s |

Fíjate en el salto: cuando entra la 4ª sesión pasas de 3 a 4 agentes parados y **el arco se
acelera**. Por eso el puré cae en 1:28 y no en 1:40. Si decides no disparar el permiso, el
brief se te va a ~1:47.

Si acabas con más o menos agentes, ajusta: **`reloj = 8 / agentes`** deja el puré a los ~75 s.
Ojo: una sesión con subagentes cuenta como `1 + subagentes`, así que el arco se acelera
sin avisar. Por eso se ensaya.

**Tu botón de rebobinar:** `POST /api/toll/complete?token=…` pone `since = now` en todas las
sesiones y **reinicia el arco desde cero sin matar tus sesiones reales**. Úsalo entre ensayos
y una última vez 5 segundos antes de empezar.

---

## Montaje (T-15 min)

- [ ] **Ningún push.** Cada deploy borra el estado y te quedas sin sesiones.
- [ ] Widget abierto en la PiP, punto de conexión en verde.
- [ ] **3 sesiones reales detenidas** en 3 repos distintos, cada una en un estado diferente:
      una pidiendo permiso, una esperando input, una terminada sin confirmar. Es lo que hace
      que la lista salga con tres colores y el triaje se vea.
- [ ] **4ª sesión lista y armada**: Claude Code abierto, con el prompt pegado en la terminal
      **sin darle enter**. Tiene que pedir un permiso destructivo de verdad
      (`rm -rf migrations/` o similar). Un comando rutinario no sirve.
- [ ] **Piloto automático APAGADO.** Si está encendido aprueba solo lo rutinario y te come el beat.
- [ ] **Voz APAGADA.** El texto de la burbuja dice exactamente lo mismo, y el audio de un venue
      es una ruleta.
- [ ] Celular con el widget abierto y la pantalla despierta, aunque no lo proyectes: lo vas a
      levantar para señalarlo.
- [ ] `POST /api/toll/complete` justo antes de arrancar. Reloj todavía en 1×.

---

## El guion

### 0:00 – 0:19 · El problema  ·  48 pal · 19 s

> «Trabajo con cuatro sesiones de Claude Code a la vez. Ahora mismo, mientras les hablo,
> **tres están paradas esperándome a mí**.
>
> No sé cuál, ni desde cuándo. Y volver cuesta: hay que **reconstruir qué hacía cada una**.
>
> El ecosistema mide la latencia del modelo. Nadie mide la mía.»

*(Al decir «esperándome a mí»: arrancas el reloj. Un comando, sin mirar.)*

```
curl -X POST "https://…/api/clock?token=$TOKEN&speed=2.5"
```

---

### 0:19 – 0:37 · Qué estás viendo  ·  40 pal · 15 s + 3 s de pausa

> «Esto es Pings. Vive encima de mi terminal: son los hooks nativos de Claude Code,
> un JSON pegado en `settings.json`.
>
> La lista está **ordenada por lo que me cuesta**, y cada fila me dice **qué hacer**,
> no solo qué pasa.»

*(Señala **una** fila y calla dos segundos. Los tres colores se ven solos: narrarlos era
gastar seis segundos en describir algo que el jurado ya está mirando.)*

---

### 0:37 – 0:55 · La métrica, y el plátano se pone feo  ·  44 pal · 17 s

> «El número no es tiempo de reloj: son **agent-minutos**. Una sesión con tres subagentes
> son cuatro agentes parados, no uno. El plátano madura con la deuda.
>
> Y ojo —» *(señalas el `reloj 2.5×`)* «— **estoy acelerando el reloj dos veces y media**.
> Las sesiones son reales, el tiempo va comprimido.»

*(Decir la aceleración en voz alta, señalando la etiqueta, es lo que convierte un truco en
un dato. El widget la muestra solo; si no la nombras, parece que la escondes.)*

---

### 0:55 – 1:28 · El beat: destrabar sin volver  ·  63 pal · 24 s + 9 s de aire

*(Enter en la 4ª terminal. El permiso llega al widget en ~1 s.)*

> «Le pedí a un agente que borre las migraciones. La terminal **está congelada**,
> esperándome.
>
> El permiso llegó acá, con lo que el modelo opina. Y esto» *(levantas el celular)* «**es lo
> mismo en mi celular**: es donde estoy cuando me alejé del teclado.
>
> Deniego.» *(clic — **calla y deja que se vea**)* «Y la terminal arranca sola.»

**Cuidado con el tiempo:** tienes **85 segundos** desde que llega el permiso. Si te pasas, el
servidor responde vacío y Claude Code muestra el prompt normal en tu terminal. No se rompe
nada — pero se te cae el beat. Si vas tarde, decide y sigue hablando.

> «Si nadie decide en 85 segundos, el prompt vuelve a la terminal.
> **Pings nunca cuelga un agente.**»

---

### 1:28 – 1:46 · El brief, que se abre solo  ·  41 pal · 16 s

*(No toques nada. Al llegar a puré el widget cambia de vista.)*

> «Ahí está la otra mitad: cuando vuelvo, **me reconstruye qué pasaba en cada sesión** y me
> dice a cuál ir primero.
>
> Esa de arriba lleva tres intentos con el mismo error. No me espera: **está dando vueltas**.
> Eso sí quema tokens.»

---

### 1:46 – 2:00 · Cierre  ·  36 pal · 14 s

> «Esperar no quema tokens: un agente bloqueado cuesta cero. Lo que se pierde es **capacidad
> paralela**.
>
> Los agentes por humano suben. Tu atención es fija. Yo mido la diferencia — **y te dejo
> arreglarla desde el celular.**»

---

## Si te preguntan

| Pregunta | Respuesta |
|---|---|
| ¿A cuánta gente le pasa esto? | **N=1.** Es mi experiencia y no tengo más. Lo que sí puedo defender es que nadie mide la latencia humana: el ecosistema mide tokens, latencia del modelo y tasa de éxito |
| ¿No es Agent View? | Agent View te dice qué pasa. Doy por hecho que ya lo sabes: el problema es que igual no vuelves. Yo te dejo actuar sin volver |
| ¿Otro tamagotchi? | Los otros son uno por sesión. El mío es uno solo y representa la deuda. Y hay un switch para apagarlo: el producto sigue sirviendo, porque el trabajo lo hace la lista |
| ¿Mandas mi código? | **No digas «nunca».** Los hooks mandan el payload completo, que en un `Write` incluye el archivo. Guardo una fracción y no persisto nada, pero sí lo recibo. Cambié minimización de datos por instalar pegando un JSON; el relay local es lo primero del roadmap |
| ¿Me bloqueas la máquina? | No, y no pretendo. Toma la ventana del widget y nada más |
| ¿Y el token en la URL? | Mismo modelo que un webhook de Slack o un share link de Figma. Y se revoca en un clic, sin login |

---

## Lo que dejé fuera, y por qué

**El piloto automático** (aprueba lo rutinario mientras no estás) es probablemente la feature
más impresionante que tienes, pero **compite con el beat del permiso manual** y necesita que
llegue un permiso rutinario en la ventana exacta. En 100 segundos no caben las dos.
Guárdalo para las preguntas: *«y si es algo rutinario y de solo lectura, ni te pregunto —
lo apruebo yo y te dejo el registro de lo que decidí».*

**Los issues de GitHub sin dueño** y **la voz** son buenas features y malos beats de 2 minutos.

---

## Plan B

| Si falla | Qué haces |
|---|---|
| El permiso no llega | Sigue hablando de la lista. Hay 3 filas con 3 colores: el triaje se sostiene solo |
| Render está dormido | Abre la landing **5 min antes**. El widget pinga `/healthz` cada 10 min mientras esté abierto |
| Se te pasan los 85 s | Dilo: «se acabó la ventana, y el prompt volvió a mi terminal — eso es la garantía funcionando» |
| El arco va lento | `POST /api/clock?speed=4`. Está a un comando |
| El arco va rápido | `POST /api/toll/complete` y vuelve a empezar. Sin matar sesiones |
| Se cayó la API key | El fallback determinista responde igual. No lo menciones si no preguntan |
