# Qué estamos construyendo

> Documento interno y honesto. El README es para jurados y usuarios; este es para
> saber qué es cierto, qué es teatro, y qué hacer si alguien pregunta hondo.

---

## 1. La frase

> **Te digo en cuál de tus agentes estás perdiendo más tiempo — y te deja arreglarlo ahí mismo, sin volver a la terminal.**

Diagnóstico **más** acción. Las dos mitades importan:

- Solo la primera mitad es un dashboard, y la capa de monitoreo está muerta (hay al menos cuatro proyectos haciendo exactamente eso).
- Solo la segunda mitad es un truco sin contexto.

### La premisa anterior, y por qué cambió

Empezamos con *"tú eres el rate limiter"*. Es una frase mejor, pero **te convierte a ti en el defecto**. Nadie adopta una herramienta que le dice que el problema es él. Sí adoptan una que le dice dónde mirar.

El cambio no costó código: casi todo lo construido ya servía a la premisa nueva. Lo único que dejó afuera fue la bola brava, la voz que regaña y el bloqueo de 90 segundos — es decir, la capa de juguete. **La reformulación amputó sola lo que sobraba.**

---

## 2. El problema

Trabajas con varias sesiones de Claude Code en paralelo. La mitad están **paradas esperando que tú decidas algo**. No sabes cuál, ni desde cuándo, ni cuál conviene matar. Vuelves al teclado y lo caro no es elegir: es **reconstruir qué estaba pasando en cada una**.

### Qué evidencia tenemos, y cuál no

| Afirmación | Estado |
|---|---|
| El desarrollo multi-agente en paralelo ya es masivo | **Sólido.** 105.533 PRs de agentes en 59.412 repos (AgenticFlict, arXiv 2604.03551) |
| Nadie mide la latencia humana en flujos agénticos | **Defendible.** El ecosistema mide tokens, latencia del modelo y tasa de éxito. Esa métrica no aparece |
| A otros desarrolladores les duele esto | **N=1.** No tenemos evidencia directa. No lo afirmes como si la tuvieras |

> ⚠️ **Trampa a evitar:** el 27,67% de conflictos de merge de AgenticFlict mide **agentes chocando entre sí**, no latencia humana. Citarlo como si midiera nuestro problema es falso, y un jurado que leyó el paper lo desarma. Sirve para probar la *precondición* (hay mucha gente corriendo muchos agentes), no la conclusión.

El argumento honesto es aritmético: **los agentes por humano suben; la atención humana es fija.**

---

## 3. El mecanismo (esto es lo genuinamente nuevo)

El hook **`PermissionRequest`** de Claude Code acepta que un handler responda `allow`/`deny` **en nombre del usuario**. Eso significa que un tercero puede destrabar un agente congelado.

```
Claude Code  ──PermissionRequest (HTTP)──▶  Peaje  ──SSE──▶  widget / celular
     ▲                                        │
     └────────── {allow | deny} ──────────────┘
```

**Garantía dura:** si nadie decide en 85 s, el servidor responde vacío y Claude Code muestra el prompt normal en la terminal. Un timeout de hook es error **no bloqueante**. Peaje nunca cuelga un agente. *(Verificado en producción: 200 vacío a los 85,15 s, el proxy de Render aguanta.)*

**Regla de no-estorbo:** solo retiene si la deuda indica que estás ausente. Si estás en el teclado, pasa de largo al instante.

### Por qué no hay relay local

El brief original asumía un relay en Node distribuido por `npx`. Al verificar las docs apareció `type: "http"`: Claude Code hace POST directo a una URL. **Eso eliminó un componente entero** — sin `npx publish`, sin instalador, sin líos de shell entre Windows y macOS — y de paso eliminó la objeción de privacidad, porque ya no mandamos tails de transcript.

---

## 4. La métrica

**Agent-minutos**, pesados por agentes realmente parados:

```
costo_sesión = tiempo_esperando × (1 + subagentes_activos)
ranking      = costo × peso(motivo) × (1 + loops)
peso: permiso 3.0 · needs_input 2.5 · falló 2.0 · terminado 1.5 · idle 1.0
```

Una sesión detenida con 3 subagentes son **4 agentes parados**, no 1.

### Presencia, no horario

Sin eventos en ninguna sesión por 30 min, no estás distraído: **estás fuera**. La deuda se **congela** —no se borra ni sigue creciendo toda la noche— y nos callamos: sin voz, sin peaje. **La intervención se dispara cuando vuelves**, que es cuando sirve. No hay a quién intervenir en una silla vacía.

Un horario laboral sería la abstracción equivocada: el almuerzo no está en el calendario, y configurarlo mataría el onboarding.

### El dinero, dicho con precisión

**Esperar no quema tokens.** Un agente bloqueado cuesta $0. Lo que se pierde es **capacidad paralela**: costo de oportunidad, calculado con una tarifa por hora que se muestra en pantalla. Lo que sí quema tokens de verdad son las **sesiones en loop**, y van contadas aparte.

> Decir *"X dólares de cómputo parado"* es falso y se cae con una pregunta.

---

## 5. Auditoría honesta: qué sirve a la tesis

| Pieza | ¿Sirve? |
|---|---|
| Ranking por costo · brief al volver · detección de loop | **Sí. Es la tesis** |
| Desbloqueo remoto de permisos | **Sí.** Elimina la espera, no solo la mide |
| Peso por subagentes · modelo de presencia | **Sí.** Hacen la métrica verdadera |
| Token de equipo | **Sí.** Extiende "quién bloquea a quién" |
| Costo en dinero | Marginal. Hace legible el número |
| Detección de colisión entre agentes | **No.** Es la tesis de otro producto (airlock). Se queda como *razón* del consejo de la IA, no como feature |
| Tareas (`TaskCreated`) | **No.** Entró por leer beads. No se muestra |
| Bloqueo de 90 s sin permisos | **No.** Castiga sin ayudar. Fuera de la demo |

**Cómo se llegó aquí, para no repetirlo:** cada documento externo que llegó produjo una feature (beads → tareas, pixel-agents → subagentes, airlock → colisión). Eso es construir por estímulo, no por tesis. Nada se borró del código —no estorba y responde preguntas profundas— pero **no aparece en el relato**.

---

## 6. Lo que deliberadamente no se construyó

Decirlo en voz alta suma: demuestra criterio de scope.

- ❌ Dashboard de PRs e issues de GitHub — GitHub ya lo hace bien, y nos volvería la categoría muerta
- ❌ Un personaje por sesión — ya existe tres veces; el nuestro es **uno solo**, y representa la deuda, no a los agentes
- ❌ Lectura de transcripts — solo eventos estructurados
- ❌ Versión de escritorio con bloqueo real — un `.exe` sin firmar dispara SmartScreen y nadie lo instala
- ❌ Base de datos, cuentas, login

---

## 7. Debilidades conocidas

Tenerlas enunciadas primero es la diferencia entre criterio y hueco.

1. **El "bloqueo" no bloquea nada real.** Solo toma la ventana del widget. Tu terminal sigue intacta y puedes cerrarlo.
   → *Enúncialo tú:* "esta versión apuesta a que ver el número basta; la de escritorio tiene dientes". Y usa el argumento fuerte: **con un permiso pendiente sí hay un proceso real congelado, y tú eres el único que lo destraba.**
2. **Evidencia N=1.**
3. **Confianza a escala de equipo:** cualquiera con el token aprueba un `rm -rf` en tu máquina. Es intencional para dos socios; no escala a una org. Permisos por persona es lo siguiente.
4. **Token compartido comparte más de lo obvio:** rutas relativas, comandos, fragmentos de `lastMessage`. Menos profundo que dar acceso al repo, más inmediato.
5. **Solo funciona con Claude Code.**
6. **Los repos se emparejan por nombre**, así que dos repos distintos llamados `api` darían falso positivo en colisión.
7. **El estado vive en memoria:** cada redeploy lo borra.
8. **Se recibe más de lo que se guarda.** El hook HTTP manda el payload nativo completo y no hay
   cliente local que lo filtre: el prompt que escribes, el contenido de archivo en un `Write`, el
   diff de un `Edit`, el comando y su salida en `Bash`, y la respuesta final del modelo. Guardamos
   una fracción (título 80, prompt 90, mensaje 600, firma de herramienta 120) y no persistimos ni
   logueamos nada — pero **recibir poco y guardar poco no son lo mismo**, y decir "nunca mando tu
   código" es falso.
   → *Enúncialo tú:* "cambiamos minimización de datos por instalación sin instalar nada; un relay
   local filtraría en el origen y es lo primero del roadmap".

---

## 8. Notas operativas

| | |
|---|---|
| **URL** | https://platanus-build-night.onrender.com |
| **Cada push borra el estado** | Render reinicia el proceso. **No hagas pushes cerca del pitch** |
| **Free tier duerme a los 15 min** | El widget hace ping a `/healthz` cada 10 min mientras esté abierto |
| **Modo pitch** | `POST /api/clock?token=…&speed=4` acelera el reloj sobre sesiones **reales**. El widget muestra `reloj 4×` — dilo en voz alta |
| **Cuentas del pitch** | La deuda sube `agentes × reloj` por minuto real. Con 3 agentes a 4×: bravo a los 25 s, peaje a los 50 s |
| **Voz** | Las voces de Chrome en español son **de red**. Instala una local (Configuración → Voz → Español) o no dependas de ella |
| **Sin API key** | Todo funciona con el fallback determinista. Probado |

---

## 9. Objeciones y respuestas

| Pregunta | Respuesta |
|---|---|
| ¿Esto no es Agent View? | Agent View te dice qué pasa. Doy por hecho que ya lo sabes: el problema es que igual no vuelves. Y yo dejo que actúes sin volver |
| ¿Es otro tamagotchi? | Los otros representan a los agentes, uno por sesión. El mío es uno solo y representa la deuda. Y si le apagas la carita, el producto sigue sirviendo |
| ¿No es `dev-checkpoint`? | Tiene 3 estrellas porque hay que acordarse de apretar un atajo. Los hooks disparan solos: no necesito que te acuerdes de nada |
| ¿Dónde está la IA? | Decidiendo por ti sobre un agente congelado, y reconstruyendo qué pasaba en cada sesión cuando vuelves |
| ¿Y si se cae la red o la API key? | Fallback determinista en todo. Probado cortando la key |
| ¿Mandas mi código? | **No digas "nunca".** Los hooks mandan el payload completo, que en un `Write` incluye el contenido del archivo. Guardamos una fracción mínima y no persistimos nada, pero sí lo recibimos. Ver §7.8 |
| ¿Me bloqueas la máquina? | No, y no pretendo. Ver debilidad #1 |
