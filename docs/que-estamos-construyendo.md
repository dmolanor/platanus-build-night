# Qué estamos construyendo

> Documento interno y honesto. El README es para jurados y usuarios; este es para
> saber qué es cierto, qué es teatro, y qué hacer si alguien pregunta hondo.
>
> Hermanos: `CONTRACT.md` (contratos de datos) y `DESIGN.md` (sistema visual).

---

## 1. La frase

> **Te digo en cuál de tus agentes estás perdiendo más tiempo — y te deja arreglarlo ahí mismo, sin volver a la terminal.**

Diagnóstico **más** acción. Las dos mitades importan:

- Solo la primera mitad es un dashboard, y la capa de monitoreo está muerta (hay al menos cuatro proyectos haciendo exactamente eso).
- Solo la segunda mitad es un truco sin contexto.

### Dos premisas que ya descartamos

**"Tú eres el rate limiter"** era mejor frase pero **te convertía a ti en el defecto**. Nadie adopta
una herramienta que le dice que el problema es él. Sí adoptan una que le dice dónde mirar.

El cambio no costó código: casi todo lo construido ya servía a la premisa nueva. Lo único que dejó
afuera fue la capa de juguete — y **la reformulación amputó sola lo que sobraba**.

---

## 2. El problema

Trabajas con varias sesiones de Claude Code en paralelo. La mitad están **paradas esperando que tú
decidas algo**. No sabes cuál, ni desde cuándo, ni cuál conviene matar. Vuelves al teclado y lo caro
no es elegir: es **reconstruir qué estaba pasando en cada una**.

### Qué evidencia tenemos, y cuál no

| Afirmación | Estado |
|---|---|
| El desarrollo multi-agente en paralelo ya es masivo | **Sólido.** 105.533 PRs de agentes en 59.412 repos (AgenticFlict, arXiv 2604.03551) |
| Nadie mide la latencia humana en flujos agénticos | **Defendible.** El ecosistema mide tokens, latencia del modelo y tasa de éxito. Esa métrica no aparece |
| A otros desarrolladores les duele esto | **N=1.** No tenemos evidencia directa. No lo afirmes como si la tuvieras |

> ⚠️ **Trampa a evitar:** el 27,67% de conflictos de merge de AgenticFlict mide **agentes chocando
> entre sí**, no latencia humana. Citarlo como si midiera nuestro problema es falso, y un jurado que
> leyó el paper lo desarma. Sirve para probar la *precondición*, no la conclusión.

El argumento honesto es aritmético: **los agentes por humano suben; la atención humana es fija.**

---

## 3. El mecanismo (esto es lo genuinamente nuevo)

El hook **`PermissionRequest`** de Claude Code acepta que un handler responda `allow`/`deny`
**en nombre del usuario**. Eso significa que un tercero puede destrabar un agente congelado.

```
Claude Code  ──PermissionRequest (HTTP)──▶  Pings  ──SSE──▶  widget / celular
     ▲                                        │
     └────────── {allow | deny} ──────────────┘
```

**Garantía dura:** si nadie decide en 85 s, el servidor responde vacío y Claude Code muestra el
prompt normal. Un timeout de hook es error **no bloqueante**. Pings nunca cuelga un agente.
*(Verificado en producción: 200 vacío a los 85,15 s; el proxy de Render aguanta.)*

**Regla de no-estorbo:** solo retiene si la deuda indica que estás ausente. Si estás en el teclado,
pasa de largo al instante.

### Por qué no hay relay local

El brief original asumía un relay en Node distribuido por `npx`. Al verificar las docs apareció
`type: "http"`: Claude Code hace POST directo a una URL. **Eso eliminó un componente entero** — sin
`npx publish`, sin instalador, sin líos de shell entre Windows y macOS.

---

## 4. Las tres capas, de pasiva a activa

| | Qué hace | Depende de |
|---|---|---|
| **Mide** | Agent-minutos perdidos, pesados por agentes realmente parados | Nada. Siempre funciona |
| **Ordena** | Ranking mecánico, y la IA lo **re-ordena por consecuencia** | La IA es opcional: hay fallback determinista |
| **Actúa** | Desbloqueo remoto + piloto automático mientras no estás | Lista blanca cerrada, sin modelo |

### La métrica

```
costo_sesión = tiempo_esperando × (1 + subagentes_activos)
ranking      = costo × peso(motivo) × (1 + loops)
peso: permiso 3.0 · needs_input 2.5 · falló 2.0 · terminado 1.5 · idle 1.0
```

Una sesión detenida con 3 subagentes son **4 agentes parados**, no 1.

### El orden mecánico no es el orden correcto

El costo dice **qué es caro**; no dice **qué conviene**. La IA re-ordena leyendo cada sesión por
cuatro criterios que la aritmética no puede ver:

1. **Cercanía a terminar** — ahora es un dato **medido** (`TaskCreated`/`TaskCompleted`), no una
   impresión. Una sesión al 80% es barata de cerrar aunque lleve menos rato esperando.
2. **Consecuencia del bloqueo** — leer un archivo y borrar una tabla de producción son ambos
   "permiso"; solo uno es urgente.
3. **Costo de retomarla para ti** — reconstruir el contexto de un refactor de hace 40 minutos se paga.
4. **Vigencia** — si por lo que pediste después cambiaste de rumbo, esa sesión ya no importa.

Cada ítem sale con una etiqueta que dice **cómo tratarla**: `casi_lista` · `bloqueada` · `en_loop` ·
`cara_de_retomar` · `ya_no_importa`.

> **Demostrado en producción:** con los mismos datos, el orden mecánico ponía primero la sesión de
> 220 agent-min; la IA la mandó al último ("está en loop, no es una sesión a la que volver sino una
> que se cierra") y subió una de 33 min porque el permiso pendiente borraba migraciones. Los dos
> órdenes son opuestos, y el de la IA es el correcto.

### Presencia, no horario

Solo cuentan los eventos que produce **el humano**: escribir un prompt o decidir un permiso.
`PostToolUse` lo dispara el agente — si te fuiste a almorzar con un agente corriendo, tú no estás.

Sin señales humanas por 30 min, la deuda se **congela** —no se borra ni crece toda la noche— y nos
callamos. **La intervención se dispara cuando vuelves.** No hay a quién intervenir en una silla vacía.

### El dinero, dicho con precisión

**Esperar no quema tokens.** Un agente bloqueado cuesta $0. Lo que se pierde es **capacidad
paralela**: costo de oportunidad, con la tarifa por hora visible y ajustable. Lo que sí quema tokens
son las **sesiones en loop**, contadas aparte.

> Decir *"X dólares de cómputo parado"* es falso y se cae con una pregunta.

---

## 5. El piloto automático

Lo único en todo Pings que **ejecuta algo en tu máquina sin que mires**. Apagado por defecto.

Aprueba solo lo de una **lista blanca cerrada y determinista, sin modelo de por medio**:
`Read`/`Glob`/`Grep` y comandos de shell de solo lectura. Solo si estás ausente, nunca si hay
colisión, y **todo queda registrado y se te muestra al volver**.

> **La frase que desarma la inyección de prompt:** *"La IA recomienda; solo una lista blanca cerrada
> ejecuta. Son dos caminos distintos, y el de la IA no toca la máquina."* Un `allow` inyectado en la
> respuesta del modelo no cambia absolutamente nada.

### Lo que la auditoría rompió, y ya está cerrado

Tres bypasses reales, todos verificados y arreglados:

| | Cómo se colaba |
|---|---|
| **Salto de línea** | La clase de caracteres no incluía `\n`, y en bash separa comandos igual que `;`. `cat README.md\nrm -rf ~` pasaba como "cat". **El atacante ni necesitaba el token: le bastaba un README envenenado que el agente propusiera ejecutar** |
| **`git --output`** | `git log --output=~/.bashrc --format=%s` escribe en tu shell bytes que controla quien redactó el asunto de un commit. Los metacaracteres viven en el historial, nunca en el comando |
| **`npm test`** | Ejecuta `scripts.test` del `package.json`, que en un repo clonado o una rama de PR no escribiste tú |

Ahora: solo ASCII imprimible, denylist de banderas, y `git remote`/`git branch` solo en forma exacta.

---

## 6. Auditoría honesta: qué sirve a la tesis

| Pieza | ¿Sirve? |
|---|---|
| Ranking por costo · brief · detección de loop · avance por tareas | **Sí. Es la tesis** |
| Desbloqueo remoto · piloto automático | **Sí.** Eliminan la espera, no solo la miden |
| Peso por subagentes · presencia · etiqueta de sesión | **Sí.** Hacen la métrica verdadera y legible |
| Costo en dinero | Marginal. Hace legible el número |
| Detección de colisión entre agentes | **No.** Es la tesis de otro producto (airlock). Se queda como *razón* del consejo, no como feature |
| Tareas como feature propia | **No.** Entró por leer beads. Solo vale como señal de avance |

**Cómo se llegó aquí, para no repetirlo:** cada documento externo que llegó produjo una feature
(beads → tareas, pixel-agents → subagentes, airlock → colisión). Eso es construir por estímulo, no
por tesis. Nada se borró del código —no estorba y responde preguntas profundas— pero **no aparece
en el relato**.

---

## 7. Lo que deliberadamente no se construyó

Decirlo en voz alta suma: demuestra criterio de scope.

- ❌ **Bloqueo de pantalla.** Se construyó y **se eliminó**: tomaba una ventana de 380 px que
  cerrabas con un clic. Windows impide de raíz que un proceso sin admin bloquee la pantalla, así
  que la alternativa honesta no era hacerlo más agresivo sino quitarlo.
- ❌ Dashboard de PRs e issues de GitHub — GitHub ya lo hace bien, y nos volvería la categoría muerta.
- ❌ Un personaje por sesión — ya existe tres veces; el nuestro es **uno solo**, y representa la deuda.
- ❌ Lectura de transcripts, base de datos, cuentas, login.

---

## 8. Debilidades conocidas

Tenerlas enunciadas primero es la diferencia entre criterio y hueco.

1. **Evidencia N=1.**
2. **Confianza a escala de equipo:** cualquiera con el token aprueba en la máquina de cualquiera.
   Es intencional para dos socios; no escala a una org. Permisos por persona es lo siguiente.
3. **No hay revocación.** Rotar el token genera otro, pero el viejo vive hasta el TTL de 12 h.
   Un `DELETE /api/token` son tres líneas y da revocación real **sin necesidad de login**.
4. **El token viaja en la query string.** El `Referer` ya no lo filtra (los navegadores modernos
   recortan path y query al salir del origen), pero **los logs de Render y Cloudflare sí lo ven**.
   → *Frase lista:* "Es el mismo modelo de confianza que un webhook de Slack o un share link de
   Figma: quien tiene el enlace, entra. Lo elegimos porque el onboarding es pegar un JSON, no crear
   una cuenta. Lo que no tenemos todavía es revocación inmediata, y lo sabemos."
5. **Solo funciona con Claude Code.**
6. **Los repos se emparejan por nombre**, así que dos repos distintos llamados `api` darían falso
   positivo en colisión.
7. **El estado vive en memoria:** cada redeploy lo borra.
8. **Se recibe más de lo que se guarda.** El hook manda el payload nativo completo y no hay cliente
   local que lo filtre: tu prompt, el contenido de archivo en un `Write`, el diff de un `Edit`, el
   comando y su salida en `Bash`, y la respuesta final del modelo. Guardamos una fracción y no
   persistimos ni logueamos nada — pero **recibir poco y guardar poco no son lo mismo**, y decir
   "nunca mando tu código" es falso.
   → *Enúncialo tú:* "cambiamos minimización de datos por instalación sin instalar nada; un relay
   local filtraría en el origen y es lo primero del roadmap".

---

## 9. Notas operativas

| | |
|---|---|
| **URL** | https://platanus-build-night.onrender.com |
| **Render despliega del repo PERSONAL** | Mergear en el repo de la organización **no despliega nada**. Hay que sincronizar y empujar a ambos |
| **Cada push borra el estado** | Render reinicia el proceso. Guardar una variable de entorno también. **No toques nada cerca del pitch** |
| **Free tier duerme a los 15 min** | El widget hace ping a `/healthz` cada 10 min mientras esté abierto |
| **Modo pitch** | `POST /api/clock?token=…&speed=4` acelera el reloj sobre sesiones **reales**. El widget muestra `reloj 4×` — dilo en voz alta |
| **Cuentas del pitch** | La deuda sube `agentes × reloj` por minuto real. Con 3 agentes a 4×: bravo a los 25 s, nivel alto a los 50 s |
| **Voz** | ElevenLabs (Charlie, `stability 0.7`), con caché, tope horario y **fallback a `speechSynthesis`** ante cualquier fallo |
| **Sin API key** | Todo funciona con el fallback determinista. Probado |
| **El QR lleva tu token dentro** | **Usa un token desechable para la demo.** Proyectarlo deja que cualquiera en la sala apruebe permisos en tu portátil |

---

## 10. Objeciones y respuestas

| Pregunta | Respuesta |
|---|---|
| ¿Esto no es Agent View? | Agent View te dice qué pasa. Doy por hecho que ya lo sabes: el problema es que igual no vuelves. Y yo dejo que actúes sin volver |
| ¿Es otro tamagotchi? | Los otros representan a los agentes, uno por sesión. El mío es uno solo y representa la deuda. Y si le apagas la carita desde ajustes, el producto sigue sirviendo igual |
| ¿No es `dev-checkpoint`? | Tiene 3 estrellas porque hay que acordarse de apretar un atajo. Los hooks disparan solos: no necesito que te acuerdes de nada |
| ¿Dónde está la IA? | Decidiendo por ti sobre un agente congelado, y re-ordenando por consecuencia cuando vuelves — no por costo, que ya lo sabía la aritmética |
| ¿Y si la IA se equivoca? | La IA recomienda; solo una lista blanca cerrada ejecuta. Son caminos distintos |
| ¿Y si se cae la red o la API key? | Fallback determinista en todo. Probado cortando la key |
| ¿Mandas mi código? | **No digas "nunca".** Ver debilidad #8 |
| ¿Me bloqueas la máquina? | No, y no pretendo: lo construimos y lo quitamos. Ver §7 |
