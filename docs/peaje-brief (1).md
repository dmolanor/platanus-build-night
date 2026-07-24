# Peaje

**La primera herramienta que actúa sobre el humano, no sobre los agentes.**

> Históricamente el humano esperaba a la máquina.
> Ahora nueve agentes te están esperando a ti, y nadie mide ese costo.
> **Tú eres el rate limiter.**

*Nombres alternativos: Cuello, Bottleneck, Guayabo.*

**Estructura:** §1–§4 estrategia · §5–§7 decisiones técnicas · §8–§11 ejecución y riesgos · §12 anexo para Claude Code.

> ⚠️ **Restricción de la competencia:** al final debe quedar **desplegado y usable por otros**. No hay límite de frameworks. Esta restricción cambió decisiones importantes — ver §5 y §6.

---

## 1. El problema

### 1.1 Las fricciones reales

1. **Pérdida de estado.** Muchas sesiones, issues y PRs. Es fácil perder de vista cuál quedó a mitad de desarrollo, cuál va por mal camino, en cuál pediste qué.
2. **Colaboración degradada.** Dos personas usando Claude para todo. La IA permite trabajar en 10 cosas a la vez, pero colaborar se vuelve más difícil.
3. **La productividad falsa.** *"Como sé que está corriendo, se me olvida revisar otras conversaciones y me quedo viendo el celular sintiéndome productivo."*

### 1.2 El diagnóstico

**La fricción 3 no es un problema de información. Es de comportamiento.**

Ya sabes que los agentes están corriendo. Ya tienes dashboards. Los ignoras igual.

**El recurso escaso ya no es cómputo. Es tu atención.** Y no existe un scheduler para ella.

### 1.3 Por qué las herramientas actuales no sirven

Todas **informan**. Ninguna **interviene**.

| Herramienta | Qué hace | Por qué no resuelve la fricción 3 |
|---|---|---|
| **Agent View** (Anthropic, may 2026) | Dashboard CLI de todas las sesiones. Notifica cuando una necesita input, termina o falla | Es el dashboard que ya ignoras |
| **recon** | Cada agente es una criatura de pixel art en una habitación | Más bonito de ignorar |
| **Menu-bar pixel-cat** (macOS) | Gato que monitorea Claude Code, Codex y Gemini | Tamagotchi ya construido |
| **Widget KDE Plasma 6** | Muestra qué agente trabaja, espera o está inactivo | Misma categoría |
| **ClaudeMon / AgentsRoom / Claude-Code-Agent-Monitor** | Dashboards con WS, kanban, analytics, push. El último trae un *"cute buddy"* | Misma categoría, más features |

**La capa de monitoreo está muerta.** Si construyes un widget que muestra sesiones y avisa, pierdes.

**El hueco:** la guía de Agent View recomienda tratar el "needs input" como única notificación y dejar en paz a las sesiones que trabajan. Te dicen que te vayas. **Nadie gestiona qué haces mientras tanto ni cómo vuelves.**

---

## 2. La solución

### 2.1 La métrica es el producto

**Agent-minutes perdidos esperándote.** Un contador que sube en rojo mientras miras el celular.

### 2.2 La escalera de intervención

| Tiempo esperando | Qué pasa |
|---|---|
| 0–2 min | Nada. No eres una notificación más |
| 2–5 min | El personaje cambia de color. Aparece el contador |
| 5–10 min | Voz. Te dice cuánto llevas costando |
| +10 min | **PEAJE.** No sigues hasta cumplir el hábito. Bloqueo de 90 segundos |

### 2.3 El regreso con brief (el corazón)

Al pagar el peaje no vuelves a la pantalla: recibes un brief generado por LLM.

```
1. auth (22 min) — pidió permiso para borrar migrations. REVISA ESTO.
2. checkout (8 min) — terminó, PR listo, solo falta confirmar.
3. ui (40 min) — lleva 3 intentos del mismo fix. Se está dando vueltas.
   → Considera cerrarla, está quemando tokens sin avanzar.
```

Cuando vuelves con 5 sesiones esperando, lo caro no es saber *cuál* atender: es **reconstruir qué estaba pasando en cada una**. Eso resuelve la fricción 1, y ningún score numérico lo puede hacer.

### 2.4 La inversión que lo hace divertido

No eres tú cuidando un tamagotchi. **Son ellos aguantándote a ti.**

---

## 3. Features y prioridades

### Tier 0 — El producto (innegociable)

- **Despliegue funcionando desde la hora 1** (§6)
- Relay local que ingesta hooks y envía al servidor
- Estado por sesión: `working` / `waiting` / `done` / `stale`
- **Contador de agent-minutes perdidos**
- Widget siempre visible (§5)
- Escalera de intervención + peaje con bloqueo
- **Brief con LLM al regresar** (§4.1)
- **Onboarding de 30 segundos para un tercero** (§6.3) — es requisito de la competencia *y* momento de demo

### Tier 0.5 — Alta prioridad, time-boxed

- **Personaje animado** — es la UI del widget, no un extra (§4.2). Máx. 90 min
- Voz (Web Speech API) — vehículo del brief, no feature en sí

### Tier 1 — Segundo plano

- Issues y PRs pendientes, integrados al mismo ranking (§10.4)
- Skin temática Platanus (últimos 30 min)

### Tier 2 — Roadmap del pitch (no se construye)

- **Versión de escritorio (Electron) con bloqueo real** — ver §5.3, ya no es candidata para hoy
- Multijugador: el estado de tu compañero en tu widget (fricción 2)
- Histórico: a qué hora del día eres peor cuello de botella

### Descartadas

| Feature | Razón |
|---|---|
| **Cámara para detectar el celular** | Frágil en vivo, lenta, incómoda. **Sustituto 100× más barato: ausencia de teclado/mouse** |
| **Voz de tu pareja / jefe** | Puede leerse raro frente a un jurado |
| **Ultra-personalizable** | Es lo que construyes cuando no sabes qué es el producto |
| **Un tamagotchi por sesión** | Ya existe dos veces. Ver §4.2 |

---

## 4. Las dos piezas distintivas

### 4.1 El brief con LLM

**Habilitador:** los eventos de hook incluyen `session_id`, `transcript_path` y `cwd`.

> ⚠️ Dato de documentación de terceros. **Verificar contra docs oficiales en el Milestone 0.**

> 🔴 **Consecuencia del despliegue:** el transcript vive en la máquina del usuario. **Un servidor en la nube no puede leerlo.** Por eso el relay local (§6.1) es obligatorio: él lee el tail y lo envía. Esto no es opcional — sin relay no hay brief.

```
Disparador:  el usuario paga el peaje / pulsa "volver"
Entrada:     estado de las N sesiones + tail (~4 KB) de cada transcript
Salida:      ranking + una línea de "por qué" + banderas de sospecha
Frecuencia:  una llamada por regreso. NO continua
```

**Tres señales que debe buscar:**
1. **Bloqueo real** — pidió permiso, necesita decisión, falló algo
2. **Terminado y listo** — solo falta confirmar
3. **Loop / atascado** — repite el mismo intento → *recomienda cerrarla*

**Fallback obligatorio** si falla o tarda >5s:

```
score = tiempo_esperando × peso_tipo(needs_input > completed > idle) × factor_bloqueo
```

La demo nunca puede depender de la red.

### 4.2 El personaje

**El riesgo:** ya existen dos tamagotchis de sesiones de Claude.

**La distinción que te salva:**

> Los otros representan **a los agentes** — una criatura por sesión.
> Tu bola representa **la deuda que les debes**. Una sola.
> No es una mascota que cuidas: **es tu culpa acumulada con cara.**

**Especificación:**

- Una bola, no N. Es el contador con cuerpo
- **SVG + CSS.** Nada de canvas ni librerías de animación
- Círculo, dos elipses de ojos, transiciones de `background`, `border-radius` y `transform`
- **Cuatro estados:**

| Estado | Disparador | Apariencia |
|---|---|---|
| `calm` | 0 esperando | Verde, redonda, respira lento |
| `nudge` | 2–5 min | Amarilla, más grande, mira fijo |
| `angry` | 5–10 min | Roja, deformada, vibra |
| `toll` | +10 min | Roja oscura, ocupa toda la ventana, ojos entrecerrados |

- **Time-box duro: 90 minutos.** Si no está, te quedas con la versión fea
- **Feo y funcional le gana a bonito e incompleto**

---

## 5. La ventana siempre visible (Windows)

### 5.1 El panorama completo

| Opción | Costo | ¿Desplegable a terceros? | Veredicto |
|---|---|---|---|
| **Document PiP** | ya planeado | ✅ Abren una URL | **Elegida** |
| **AutoHotkey v2** | ~10 min | ⚠️ Requiere instalar AHK | **Red de seguridad** |
| **PowerToys "Always On Top"** | 0 min | ⚠️ Herramienta externa | Plan C de emergencia *(verifica el atajo, creo que es `Win+Ctrl+T`)* |
| **Electron** | 1–1.5 h + empaquetado | ❌ .exe sin firmar = alerta de SmartScreen | **Descartada hoy** (§5.3) |
| **pywebview** | ~45 min | ❌ Requiere Python | No |
| **Tauri** | ⚠️ | ❌ | **No en Windows, no hoy.** Necesita toolchain de Rust + MSVC Build Tools, y hay issues abiertos donde `alwaysOnTop` no queda realmente encima |
| **Widgets de Windows 11** | ❌ | | Requiere MSIX + adaptive cards. Semanas |
| **Extensión de navegador** | ❌ | | Las extensiones **no pueden** crear ventanas always-on-top. Limitación conocida |
| **Rainmeter** | ❌ | | Herramienta equivocada; sus widgets viven detrás de tus ventanas |

### 5.2 Document PiP: cómo y restricciones

```js
const pip = await documentPictureInPicture.requestWindow({ width: 340, height: 220 });
```

Según MDN, la ventana PiP flota sobre las demás y es como una ventana en blanco de `window.open()` pero siempre encima.

| Restricción | Implicación |
|---|---|
| **Solo Chromium** (Chrome/Edge) | Detectar `'documentPictureInPicture' in window` y fallar con mensaje claro. En Windows no es problema |
| **Requiere gesto para abrirla** | **No aparece sola.** Se abre una vez al inicio, como el miniplayer de Spotify |
| **No puedes fijar su posición** | El usuario la coloca |
| **No sobrevive a la ventana madre** | Si cierras la pestaña, se cae el widget |
| **Fullscreen también requiere gesto** | **No hay toma de pantalla automática.** La escalada ocurre dentro de la PiP |

**⚠️ El gotcha que arruina la noche:** la spec advierte que los navegadores **suspenden el renderizado y estrangulan scripts en ventanas no visibles**, y recomienda ejecutar la lógica dentro de la propia ventana PiP. Tú vas a estar en la terminal → la pestaña madre en segundo plano → **si el contador vive ahí, se congela justo en el escenario que importa.**

**Regla: cliente WebSocket, timers y toda la lógica van DENTRO de la PiP.** La pestaña madre solo la abre y se calla.

### 5.3 Por qué Electron queda descartado (reversión de decisión)

Electron da lo que PiP no puede: `frame: false`, `transparent: true`, `setAlwaysOnTop(true, 'screen-saver')`, `closable: false` y fullscreen real. **El peaje con dientes de verdad.**

**Pero el requisito de despliegue lo mata:** distribuir un `.exe` sin firmar dispara la alerta de SmartScreen en Windows, y nadie en un hackathon descarga y ejecuta un binario de un desconocido. "Usable por otros" con Electron significa fricción alta y una demo de instalación mala.

**Web gana por distribución, no por capacidad.** Y esa debilidad se convierte en frase de pitch:

> *"Corre en el navegador, sin instalar nada. La versión de escritorio con bloqueo real es el siguiente paso."*

**Nota de arquitectura:** aun así, mantén `widget.html` **agnóstico del host**. Si algún día quieres Electron, es un `main.js` de 30 líneas cargando el mismo HTML, no una reescritura.

### 5.4 AutoHotkey: el seguro de 10 minutos

`WinSetAlwaysOnTop` hace que la ventana especificada se quede encima de todas las demás. Ten un script de 3 líneas listo apuntando a la ventana de Chrome.

Si en el escenario la PiP hace algo raro, esto te salva la demo. **Diez minutos por eliminar un riesgo de severidad alta: la mejor relación costo-beneficio de la noche.**

---

## 6. Arquitectura desplegable

### 6.1 Por qué hace falta un relay local

Los hooks corren en la máquina del usuario y el transcript vive ahí. **Un servidor en la nube no puede leer ninguno de los dos.** El relay local es inevitable.

```
Claude Code (N sesiones, M proyectos)
      │ hooks → stdin JSON
      ▼
peaje-relay  (script local, ~40 líneas)
      │ lee transcript_path, saca tail de 4 KB
      │ POST https://peaje.xxx.app/hook?token=ABC
      ▼
Servidor (nube)   estado por token · contador · brief
      │ WebSocket
      ▼
widget.html en ventana Document PiP   (navegador del usuario)
```

**El relay debe ser Node** (mismo runtime que ya tienes, cross-platform, y evita líos de shell entre Windows y macOS).

### 6.2 Multi-tenancy mínima

- Token aleatorio generado en la primera visita. **Sin cuentas, sin auth, sin base de datos**
- El token vive en la URL del widget y en la config del hook
- Estado en memoria, indexado por token, con TTL de 2 horas

~30 líneas. Suficiente para cumplir "usable por otros".

### 6.3 El onboarding de 30 segundos (es un activo de demo)

```
1. Abre https://peaje.xxx.app          → te da tu token
2. Corre:  npx peaje-relay ABC123      → escribe el hook en ~/.claude/settings.json
3. Clic en "Abrir widget"              → la ventana PiP queda flotando
```

**Poder decirle al jurado "instálalo ahora en tu laptop, te toma 30 segundos" es más fuerte que cualquier diapositiva.** Ensáyalo en una máquina limpia.

### 6.4 Hosting

| Elemento | Elección |
|---|---|
| Plataforma | Railway, Render o Fly — la que ya conozcas. **No aprendas una nueva hoy** |
| Runtime | Node, un solo proceso (HTTP + WS) |
| Persistencia | Ninguna. Memoria + TTL |
| Cold start | ⚠️ Si el free tier duerme, el primer hook se pierde. **Ping cada 5 min desde el relay** |
| API key | La tuya, del lado del servidor, con límite de llamadas |

---

## 7. Punto de decisión (hora 4)

Con Electron fuera, la decisión ya no es sobre el host de la ventana. Es sobre alcance:

**Hora 4 — evalúa el estado de Tier 0:**

| Si... | Entonces |
|---|---|
| Tier 0 completo y desplegado | Ataca Tier 1 (issues/PRs) y pule el personaje |
| Tier 0 completo pero solo local | **Detente y despliega.** Es requisito de la competencia, no un extra |
| Tier 0 incompleto | Recorta: brief → fallback aritmético; personaje → `<div>` de color. **El despliegue no se recorta** |

**Regla no negociable:** entre "una feature más" y "desplegado y usable", siempre gana el despliegue. Un proyecto brillante que solo corre en tu laptop **incumple las bases**.

---

## 8. Plan de 8 horas

| Horas | Qué | Regla |
|---|---|---|
| 0–1 | **Verificar docs de hooks** + Chrome confirmado + **desplegar un "hello world" a la nube** + relay local haciendo POST al servidor desplegado | **Nada de esto es opcional.** El despliegue va aquí, no al final |
| 1–2.5 | Estado por token + contador + WebSocket, todo contra la URL desplegada | Local solo como conveniencia de desarrollo |
| 2.5–4.5 | Ventana PiP + **personaje** (contador, 4 estados, voz) | Lógica DENTRO de la PiP. Personaje time-boxed |
| 4.5–5.5 | Escalera de intervención + peaje con bloqueo de 90s | |
| 5.5–6.5 | **Brief con LLM** + fallback aritmético | El relay ya envía el tail desde la hora 1 |
| 6.5–7.5 | **Ensayar 3 veces + probar el onboarding en máquina limpia + script AHK de respaldo** | Innegociable |
| 7.5–8 | Skin de plátano, pitch, buffer | |

**Por qué el despliegue va en la hora 0–1:** es la misma lección de siempre. Desplegar a las 7.5 horas es donde mueren los proyectos. Si despliegas primero, todo lo que construyas después ya nace funcionando en producción.

**Reglas de corte:**
- Atrasado a la hora 4 → el personaje se queda en un `<div>` de color
- Atrasado a la hora 6 → el brief cae a fallback aritmético
- **Nunca sacrifiques 6.5–7.5.** Un producto sin ensayar es un producto que no existe

---

## 9. Riesgos

### 9.1 Integración

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Nombres de eventos de hooks cambiaron** | **Alta** | Milestone 0. ~30 eventos, varían por versión |
| **`transcript_path` no disponible** | **Alta** | Milestone 0. Sin él, el brief cae al fallback |
| **Estrangulamiento de la pestaña madre** | **Alta** | Toda la lógica dentro de la PiP (§5.2) |
| **Hook lento bloquea a Claude Code** | **Alta** | Timeout de 2s y salida silenciosa. Un hook que cuelga te congela los agentes de verdad |
| **Relay: shell distinto en Windows vs macOS** | Media-Alta | Por eso el relay es Node, no un one-liner de bash |
| Document PiP no disponible (Safari/Firefox) | Media | Detectar y mostrar mensaje. En Windows no es problema |
| **TTS: autoplay bloqueado** | Media-Alta | Requiere interacción previa; el click que abre la PiP sirve. **Probar temprano** |
| TTS: voces en español pobres | Media | Probar en la hora 1. Fallback: solo texto |
| Latencia del LLM en vivo | Media | Timeout de 5s → fallback |

### 9.2 Despliegue

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Desplegar al final** | **Muy alta** | Va en la hora 0–1. No negociable |
| Cold start pierde el primer hook | Media-Alta | Ping cada 5 min desde el relay |
| Abuso de tu API key | Media | Límite de llamadas por token |
| **Privacidad: mandas tails de transcripts a la nube** | Media | Efímero, sin persistencia. **Ten la respuesta lista, te la van a preguntar.** Menciona el modo local como roadmap |
| CORS / WSS entre dominios | Media | Servir el widget desde el mismo dominio del servidor |
| Fricción de instalación para terceros | Media | Ensayar el onboarding en una máquina limpia antes del pitch |

### 9.3 Demo

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Compartes una ventana y la PiP no aparece** | **Alta** | **Comparte pantalla completa, nunca una ventana.** Probar con el proyector real en la hora 3 |
| Topmost no se captura al proyectar | Media-Alta | En Windows, las ventanas topmost y la captura interactúan raro — Electron incluso expone `setContentProtection` que las **excluye** de la captura. Verificar temprano. Plan B: video grabado |
| El tiempo muerto es lento por naturaleza | **Alta** | Estado pre-cargado + reloj acelerado, diseñado desde el inicio |
| Falla la escalada en vivo | Media | Modo demo determinista |
| El wifi del venue | Media-Alta | El servidor está en la nube: sin red no hay producto. Ten hotspot y video de respaldo |

### 9.4 Producto y pitch

| Riesgo | Comentario |
|---|---|
| **Veredicto "lindo pero trivial"** | Tu mayor amenaza. **Abre con el problema serio y la cifra, cierra con lo divertido.** Nunca al revés |
| **Polarización** | Encantará a unos jueces y otros lo descartarán. Varianza alta = correcto en hackathon |
| **Otro de los 24 construye monitoreo** | Probable. Que se note en 10 segundos que tú no monitoreas: intervienes |

---

## 10. Detalles de implementación

### 10.1 Stack (decidido)

| Capa | Elección | Por qué |
|---|---|---|
| Servidor | **Node 20+ / Express + `ws`** | Un proceso, un lenguaje, sin build |
| Estado | **Memoria, por token, TTL 2h** | Nada de base de datos |
| Relay local | **Node, distribuido por `npx`** | Cross-platform, sin líos de shell |
| Front | **HTML + JS vanilla + SVG/CSS** | **Nada de React ni bundler.** Es una ventana de 340×220 |
| LLM | **`@anthropic-ai/sdk`**, una llamada por regreso | |
| Voz | **Web Speech API** | Gratis, sin red |

### 10.2 Estructura

```
peaje/
├── server/
│   ├── index.js        # Express + WS + rutas + tokens
│   ├── state.js        # sesiones, contador, transiciones
│   ├── brief.js        # LLM + fallback aritmético
│   └── demo.js         # estado sembrado + reloj acelerado
├── relay/
│   ├── bin.js          # npx peaje-relay <token>
│   ├── install.js      # escribe en ~/.claude/settings.json
│   └── forward.js      # lee stdin, saca tail, POST
├── public/
│   ├── index.html      # landing: token + botón "abrir widget"
│   ├── widget.html     # contenido de la PiP (TODA la lógica)
│   ├── character.js    # SVG + 4 estados
│   └── style.css
├── .env.example
└── README.md
```

### 10.3 Contratos de datos

**Del relay al servidor** (`POST /hook?token=ABC`):

```json
{
  "hook_event_name": "Notification",
  "session_id": "abc-123",
  "cwd": "C:\\Users\\diego\\proyecto-movil",
  "type": "agent_needs_input",
  "transcript_tail": "...últimos 4KB del transcript...",
  "raw": { }
}
```

> El relay añade `transcript_tail`. **Guarda siempre `raw`** por si un campo cambia de nombre.

**Estado interno:**

```json
{
  "sessionId": "abc-123",
  "project": "proyecto-movil",
  "status": "waiting",
  "reason": "needs_input",
  "since": 1753372800000,
  "waitedMs": 1320000
}
```

`status`: `working` | `waiting` | `done` | `stale` (sin eventos >30 min)

**WebSocket (servidor → widget), cada segundo:**

```json
{
  "totalWaitedMs": 2820000,
  "level": "angry",
  "sessions": [ ],
  "speak": "Llevas 47 minutos de agente parados."
}
```

`level`: `calm` | `nudge` | `angry` | `toll`
`speak`: `null` salvo cuando hay algo nuevo. El widget no repite lo ya dicho.

**Endpoints:**

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/hook?token=` | Ingesta. Responde 200 siempre, rápido |
| `GET` | `/api/brief?token=` | Brief con LLM, con fallback |
| `POST` | `/api/toll/complete` | Peaje pagado, resetea el contador |
| `POST` | `/api/demo/start` | Estado sembrado + reloj acelerado |
| `GET` | `/api/token/new` | Token nuevo |
| `WS` | `/ws?token=` | Stream de estado |

### 10.4 Issues y PRs (Tier 1): la vía barata

**No uses webhooks.** Necesitan endpoint público por usuario y depender de la entrega de GitHub en vivo.

**Usa polling del API de GitHub cada 60s con un PAT.** ~20 líneas. La latencia es irrelevante para un PR que lleva tres días esperando.

Intégralo **al mismo ranking**, no como lista aparte. El valor es: *"lo más caro que tienes pendiente no es un agente, es el PR #14 de tu compañero."*

### 10.5 Variables de entorno

```bash
ANTHROPIC_API_KEY=      # servidor
PORT=7777
PEAJE_DEMO_SPEED=60     # 1 seg real = 60 simulados
PEAJE_SERVER_URL=       # relay → servidor desplegado
GITHUB_TOKEN=           # Tier 1
GITHUB_REPOS=           # Tier 1: owner/repo,owner/repo
```

---

## 11. Pitch

### 11.1 Guion de demo (3 minutos)

**0:00–0:30** — El problema, en serio. *"Trabajo con 5 agentes en 2 repos. La mitad del tiempo están parados esperándome, y yo en el celular sintiéndome productivo."*

**0:30–1:00** — El personaje vive en la esquina, verde y tranquilo. Tres agentes trabajando.

**1:00–2:00** — Terminan. El contador sube: 12... 30... 47 agent-minutes. La bola se pone amarilla, luego roja, se deforma, habla. **Peaje. Haces las flexiones frente al jurado.**

**2:00–2:40** — Desbloqueado, llega el brief: *"Ve a auth primero, pidió permiso para borrar migrations. Y mata la sesión de ui, lleva 3 intentos del mismo fix."*

**2:40–3:00** — *"Está desplegado. Si tienen Claude Code corriendo ahora mismo, en 30 segundos lo tienen en su laptop."* Cierre: *"No solo te saco de la silla. Cuando vuelves, sabes a dónde ir y qué matar."*

### 11.2 Objeciones del jurado

| Pregunta | Respuesta |
|---|---|
| **¿Esto no es Agent View?** | Agent View te dice qué está pasando. Yo doy por hecho que ya lo sabes — el problema es que igual te quedas en el celular |
| **¿No es un tamagotchi más?** | Los otros representan a los agentes, uno por sesión. El mío representa la deuda que les debes |
| **¿Dónde está la IA?** | En el regreso. Reconstruyo qué pasó mientras no estabas y te digo cuál matar porque está en loop |
| **¿Y si cierro la ventana?** | Puedes. La versión de escritorio tiene dientes; esta apuesta a que ver el número subir basta |
| **¿Mandas mis transcripts a un servidor?** | Solo el tail, efímero, sin persistencia. El modo local es lo siguiente en el roadmap |
| **¿Cómo lo uso yo?** | Abre la URL, corre un comando, listo. Te lo instalo ahora si quieres |

---

## 12. Anexo para Claude Code

### 12.1 Instrucciones al agente

1. **El Milestone 0 es verificación, no código.** Consulta `https://code.claude.com/docs/en/hooks` y confirma nombres de eventos (`Notification`, `Stop`, `SessionStart`, `SubagentStop`), los tipos `agent_needs_input` / `agent_completed`, y si `transcript_path` viene en el payload. **No inventes nombres ni campos.** Si algo no coincide con este documento, repórtalo antes de codificar.
2. **El Milestone 1 es desplegar.** Antes de construir features, un "hello world" tiene que estar vivo en una URL pública. **No avances sin eso.**
3. **No agregues features fuera del Tier declarado.** Si crees que falta algo, propónlo, no lo construyas.
4. **Cada milestone termina con su verificación ejecutable.** No pases al siguiente sin que pase.
5. **El modo demo es Tier 0**, se construye en el milestone 3, no al final.
6. Prefiere código feo y funcional sobre abstracciones. Esto vive 8 horas.

### 12.2 Milestones con verificación

| # | Entregable | Cómo sé que funciona |
|---|---|---|
| **0** | Docs verificados | `FINDINGS.md` con los nombres confirmados y si `transcript_path` existe |
| **1** | **Desplegado** | Abro la URL pública desde el celular y responde |
| **2** | Relay → servidor desplegado | Corro Claude Code en otro repo, hago una pregunta, y el evento llega **al servidor en la nube** |
| **3** | Estado + contador + **modo demo** | `POST /api/demo/start` y el contador sube. Sin agentes reales |
| **4** | PiP + personaje | La ventana flota sobre la terminal y la bola cambia de color |
| **5** | Escalera + peaje | Con reloj acelerado pasa por los 4 estados y aparece el bloqueo de 90s |
| **6** | Brief | Pago el peaje y recibo el ranking. **Corto la API key y sigue funcionando** (fallback) |
| **7** | Onboarding | En una máquina limpia: URL → comando → widget, en menos de 60 segundos |
| **8** | Ensayo | 3 corridas completas seguidas sin tocar código |

### 12.3 Configuración del hook (la escribe el relay)

En `~/.claude/settings.json`, para `Notification`, `Stop`, `SessionStart` y `SubagentStop`, un handler tipo `command` que invoque el relay pasándole el JSON por stdin.

> ⚠️ **Timeout de 2s y salida silenciosa siempre.** Un hook que cuelga te congela los agentes de verdad. Sería un final irónico para este proyecto.
>
> ⚠️ **Confirmar la forma exacta del bloque `hooks` contra los docs** — hay tres niveles de anidamiento (evento → matcher group → handler) que pueden variar por versión.

### 12.4 Prompt de arranque

```
Lee peaje-brief.md completo antes de escribir código.

8 horas, hackathon. Requisito de la competencia: al final debe quedar
DESPLEGADO y usable por terceros. Por eso desplegar es el Milestone 1,
no el último.

Trabaja milestone por milestone según §12.2. No avances al siguiente sin
pasar su verificación.

Empieza por el Milestone 0: consulta la documentación oficial de hooks de
Claude Code y confirma los nombres de eventos y campos que asume §10.3.
Escribe FINDINGS.md y dime si algo no coincide antes de tocar código.

No agregues nada fuera de Tier 0 y Tier 0.5. Si crees que falta algo,
propónlo primero.
```

---

## Fuentes

Verificadas por búsqueda web el 24 de julio de 2026.

- Hooks de Claude Code — https://code.claude.com/docs/en/hooks
- Agent View — https://code.claude.com/docs/en/agent-view
- Document PiP (MDN) — https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API
- Spec Document PiP (WICG) — https://wicg.github.io/document-picture-in-picture/ · https://github.com/WICG/document-picture-in-picture
- Electron, ventanas personalizadas — https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- AutoHotkey `WinSetAlwaysOnTop` — https://www.autohotkey.com/docs/v2/lib/WinSetAlwaysOnTop.htm
- `SetWindowPos` / HWND_TOPMOST (Microsoft) — https://learn.microsoft.com/windows/desktop/api/winuser/nf-winuser-setwindowpos
- Tauri, issues de alwaysOnTop — https://github.com/tauri-apps/tauri/issues/5638
- Competidores: `recon` https://github.com/gavraz/recon · ClaudeMon https://github.com/anipotts/claudemon · Claude-Code-Agent-Monitor https://github.com/hoangsonww/Claude-Code-Agent-Monitor · AgentsRoom https://agentsroom.dev/claude-code-hooks

**Nota:** los eventos de hook, sus tipos y el campo `transcript_path` provienen de documentación consultada hoy, parte de terceros. Claude Code se mueve rápido. **Verificar es el Milestone 0, no una precaución opcional.**
