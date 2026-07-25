# Airlock

**Control de concurrencia para enjambres de agentes de código.**
Multi-repo. Multi-persona. Multi-agente.

> Git resuelve el conflicto en el merge. Para entonces ya perdiste dos horas de agente.
> Airlock hace control de versiones de la **intención**, no del código.

---

## 1. El problema

### 1.1 El síntoma

Un equipo pequeño (2 devs) construye dos productos acoplados: una app móvil y una plataforma web, en repos separados. Con desarrollo asistido por agentes, el estado real un martes cualquiera es:

- 5–6 agentes trabajando en paralelo
- ~15 PRs abiertos, ~30 issues
- PRs cruzados: cada dev abre issues y PRs en el repo del otro

Cada agente que arranca **no sabe qué están haciendo los demás**. No lee los 30 issues. No revisa comentarios de PRs. Resultado: trabajo duplicado, contratos rotos entre repos, y merges que explotan.

### 1.2 No es anecdótico

| Evidencia | Dato |
|---|---|
| **AgenticFlict** (arXiv 2604.03551) — 105.533 PRs de agentes en 59.412 repos | **27,67%** terminan en conflicto de merge. Media: 4,36 archivos y ~540 líneas en conflicto por PR |
| Tasa por agente (mismo estudio) | Copilot 15,43% · Cursor 20,06% · Devin 23,04% · Claude Code 26,86% · Codex 32,31% |
| **MAST** (arXiv 2503.13657, NeurIPS 2025) — 1.600+ trazas anotadas en 7 frameworks | 14 modos de fallo en 3 categorías. Dos de ellos son literalmente esto: *"ignorar el input de otros agentes"* y *"retener información crucial"* (categoría FC2, desalineación entre agentes) |

**Uno de cada cuatro PRs de agente choca. Y el número crece con cada agente que agregas.**

### 1.3 Problemas adyacentes (contexto, no scope)

Estos amplían el panorama del pitch pero **no se construyen**:

- **Conflictos semánticos.** Git detecta conflictos de línea. No detecta que dos cambios correctos en aislamiento se contradicen al componerse: compilan, pasan lint, fallan en runtime.
- **Cuello de botella de review.** El costo se movió de escribir a validar. Diffs pequeños con radio de impacto amplio, y el reviewer tiene que reconstruir la intención desde el diff porque el agente no la dejó escrita en ningún lado.
- **Quema de tokens por retrabajo.** Agentes re-investigando lo que otro agente ya descubrió hace 20 minutos. (Auditorías de vendors reportan que el contexto reenviado puede ser >60% de la factura — dato de marketing, tratar con pinzas, pero la dirección es correcta.)

### 1.4 El hueco real del mercado

Todo lo que existe hoy asume **un repo, una máquina, un humano**:

| Herramienta | Qué resuelve | Qué NO resuelve |
|---|---|---|
| Beads (`bd`) | Memoria e issues git-native para agentes, DAG de dependencias, IDs hash anti-colisión | Un repo. Es *pull*: el agente pregunta si se acuerda |
| Memorix / agentmemory / RepoMemory | Memoria persistente compartida vía MCP entre agentes | Recuperación pasiva. No bloquea, no sabe qué pasa *ahora* |
| Conductor / Claude Squad / Vibe Kanban | Paralelismo local con worktrees aislados | Una máquina, un humano. Aislamiento ≠ coordinación |
| GitHub Agent HQ / Mission Control | Asignar y monitorear agentes desde un solo lugar | Su recomendación oficial ante colisiones es *"particiona el trabajo con cuidado"* — o sea, resuélvelo tú. Y es un solo repo |

> **Nadie coordina el repo móvil de una persona con el repo web de otra.**
> *(Inferencia a partir de la documentación pública de cada herramienta, no de una revisión exhaustiva del ecosistema.)*

---

## 2. La solución

### 2.1 El insight

El conflicto de merge es un problema de **detección tardía**. Toda la industria invierte en *resolverlo mejor* (merge tools con IA, worktrees, particionado manual). Airlock lo mueve a la izquierda: **lo detecta cuando todavía es gratis**, porque nadie ha escrito código todavía.

*Shift-left del merge conflict.*

### 2.2 La primitiva única: el **claim**

Todo el producto es un objeto. Antes de escribir una línea, el agente declara qué va a tocar.

```json
{
  "id": "clm-a1b2",
  "agente": "diego/agent-3",
  "humano": "diego",
  "repo": "web-platform",
  "rama": "auth-refactor",
  "intencion": "añadir rotación de refresh token al interceptor",
  "superficie": ["auth/*", "api/client.ts", "POST /session"],
  "estado": "activo",
  "creado": "2026-07-24T14:02:00Z",
  "ttl": 3600
}
```

**La "superficie" es la clave del cross-repo.** No son solo rutas de archivo: son también **endpoints y contratos**. `POST /session` existe en los dos repos. Ese es el único mecanismo que permite que un claim en el repo web bloquee trabajo en el repo móvil.

### 2.3 Dos memorias, con vidas distintas

| | **Estado** | **Bitácora** |
|---|---|---|
| Qué guarda | Quién toca qué *ahora mismo* | Cuándo dos intenciones chocaron aquí y qué se decidió |
| Vida | Efímera (TTL) | Append-only, podada a 3–5 entradas por superficie |
| Autoridad | Total. No interpreta nada, se deriva de webhooks | Histórica. Razones, no especificaciones |
| Usa IA | No | Solo para redactar el resumen al resolver |

**Por qué NO se guarda "la última decisión vigente" por item:** para la mayoría de items la decisión vigente ya está guardada — *es el código mergeado*. Una copia en prosa crea una segunda fuente de verdad que se desincroniza en días, y deja al agente sin saber a cuál creerle.

**Lo que sí es irrecuperable del código son las alternativas descartadas y su razón.** Eso vive en PRs cerrados que nadie lee. Las especificaciones caducan en una semana; las razones envejecen bien.

### 2.4 Política de resolución (determinista, sin debate)

1. **Gana el primer claim.** Semántica de mutex. Sin ambigüedad.
2. **El segundo agente recibe un brief estructurado**, no una invitación a discutir: qué hace el otro, desde cuándo, qué superficie toca, y la bitácora de esa superficie.
3. **Tres salidas, ninguna conversacional:** `adaptar` / `esperar` / `--force` con razón registrada.
4. **Si hace `--force`, o si el brief no le alcanza → escala al humano.** No a otro agente.

> **Descartado explícitamente: debate entre agentes.** No es determinista (2 o 9 turnos, ruleta rusa en una demo de 3 min), los LLMs tienden a ceder por complacencia en vez de por argumento, y MAST advierte que los protocolos de comunicación por sí solos son insuficientes para fallos FC2. Un debate es lo que construyes cuando no te atreves a definir una política.

---

## 3. Features del MVP (lo que SÍ se construye)

### 3.1 Núcleo — 4 herramientas MCP, ni una más

| Herramienta | Entrada | Salida |
|---|---|---|
| `claim` | intención, superficie | `OK` \| `CONFLICTO(quién, qué, desde cuándo, bitácora)` |
| `board` | — | Estado del enjambre, comprimido |
| `note` | destinatario, mensaje | Recado asíncrono agente→agente |
| `release` | claim_id, resultado | Libera la superficie, escribe bitácora si hubo colisión |

### 3.2 Enforcement en dos capas

Un claim que el agente puede ignorar **no sirve de nada** — es el problema actual con otro nombre.

- **Hook local (`pre-edit` / `pre-commit`)** → bloquea si no hay claim activo. Rápido, sin red.
- **GitHub Action que falla el check del PR** → si no hay claim, o si la superficie choca con un claim activo **de otro repo**. Esta es la pieza cross-repo, la que no tiene competencia, y no requiere que nadie instale nada local.

> Una regla en `AGENTS.md` es una sugerencia. Un check de CI que falla es una restricción.

### 3.3 Detalles baratos que suman valor real

Todos cuestan minutos, no horas, y son lo que separa un demo de un producto:

- **TTL con auto-release.** Un agente que muere no deja la superficie bloqueada para siempre. Resuelve la objeción obvia de deadlock en una frase.
- **`--force` con razón obligatoria.** No bloqueas el trabajo urgente, pero queda auditado. Genera confianza en el jurado: no eres una herramienta que estorba.
- **Presupuesto de tokens como feature.** `board()` devuelve **<500 tokens** siempre. Si no cabe en el contexto del agente, no existe. Diferenciador directo contra las capas de memoria que inyectan todo.
- **Respuesta estructurada y accionable**, nunca prosa. El agente recibe campos que puede usar para replanificar, no un párrafo que tiene que interpretar.
- **IDs hash (`clm-a1b2`)** en vez de secuenciales — evita colisiones cuando varios agentes crean claims en paralelo desde ramas distintas. *(Patrón tomado de Beads.)*
- **Modo `observe` (dry-run).** Registra y advierte pero no bloquea. Es la ruta de adopción gradual de un equipo real, y es tu plan B si el detector falla en vivo.
- **Métrica de ROI en el dashboard:** `colisiones evitadas × tiempo medio de agente desperdiciado`. Un número grande y creciente en pantalla durante el pitch.
- **Poda automática de bitácora** a 3–5 entradas por superficie, cada una enlazada a un PR o commit. Sin evidencia enlazada, no se guarda.

### 3.4 Dashboard (solo para el jurado)

El producto es para agentes; **la demo es para humanos**. Vista en vivo del enjambre: claims activos, superficies, colisiones. Es maquillaje necesario. Si el tiempo aprieta, se corta antes que la GitHub Action.

---

## 4. Lo que explícitamente NO se construye

Decirlo en voz alta durante el pitch **suma puntos** — demuestra criterio de scope.

- ❌ Agente curador que deduplica semánticamente
- ❌ Vector DB, embeddings, grafo de conocimiento
- ❌ Kanban o UI de gestión para humanos
- ❌ Spawning u orquestación de agentes
- ❌ Reemplazo de GitHub Issues
- ❌ Debate / negociación entre agentes
- ❌ Detección de conflictos semánticos en el código
- ❌ Resolución automática de merges

La detección de conflicto es **una llamada LLM** comparando el claim nuevo contra los 5–10 claims activos. Punto. Es honesto decirlo.

---

## 5. Qué más podría incluir (roadmap, no scope)

### 5.1 Integraciones con lo que ya existe

La posición correcta es **complementario, no competidor**. Es la respuesta que desarma la objeción "¿esto no es X?".

| Herramienta | Cómo encaja |
|---|---|
| **Beads (`bd`)** | Backend de issues y dependencias *debajo* de Airlock. Beads sabe qué hay que hacer y en qué orden; Airlock sabe quién lo está haciendo ahora. Un claim podría referenciar un `bd-id` directamente |
| **Memorix / agentmemory** | Memoria de largo plazo *al lado*. Airlock es el estado caliente (minutos/horas); ellos son el conocimiento frío (meses). Airlock podría volcar bitácoras resueltas hacia allá |
| **GitHub Agent HQ** | Airlock como check obligatorio en el flujo de Mission Control. Ellos asignan, nosotros evitamos que se pisen |
| **Conductor / Claude Squad** | Aislamiento local + coordinación global. El worktree te separa físicamente; Airlock te coordina semánticamente |
| **Linear / Jira** | Sincronizar claims como estados de tarea, para que el humano vea lo mismo que el agente |

### 5.2 Features futuras (ordenadas por valor/costo)

1. **Detección de conflicto semántico de contrato.** Si un claim toca `POST /session` y otro repo consume ese endpoint, avisar aunque no compartan archivos. *(Extensión natural de "superficie"; alto valor, costo medio.)*
2. **Arbitraje asistido.** Cuando el `--force` es frecuente en una superficie, escalar al humano con un resumen de las posturas. Es el debate, pero con humano como árbitro y sin ser conversacional.
3. **Sugerencia de particionado.** Dado un issue grande, proponer cómo dividirlo en claims que no colisionen.
4. **Post-mortem automático.** Al cerrar un PR, comparar la intención declarada contra el diff real. Detecta scope drift, uno de los modos de fallo de MAST.
5. **Handoff explícito.** Un agente termina y le deja el contexto empaquetado al siguiente, en vez de que el siguiente lo reconstruya.
6. **Heatmap de superficies.** Qué archivos son "hotspots" de colisión. Le dice al equipo dónde su arquitectura tiene demasiado acoplamiento.

### 5.3 Modelo de negocio (por si el jurado pregunta)

- Open source el servidor MCP + hooks → adopción.
- Cloud pago para el estado compartido cross-repo y cross-organización → el valor real solo aparece cuando hay más de un humano.
- El precio se justifica en tokens ahorrados, no en asientos.

---

## 6. Plan de 10 horas

| Horas | Qué | Regla |
|---|---|---|
| 0–1 | Deploy público + túnel + webhook de GitHub llegando a un endpoint que hace `console.log` | **No pases de aquí sin esto funcionando.** Es el mayor riesgo de la noche |
| 1–3 | Modelo de claim + store + las 4 herramientas MCP, sin lógica de conflicto | |
| 3–5 | Detección de conflicto (una llamada LLM) + respuesta estructurada accionable | |
| 5–6.5 | GitHub Action que falla el check cross-repo | **Pieza diferenciadora. Protégela** |
| 6.5–8 | Dashboard de demo: el enjambre en vivo | Solo para el jurado |
| 8–9 | Ensayar la colisión **3 veces** + grabar el fallback | Innegociable |
| 9–10 | Pitch, slides, buffer | |

**Regla de corte:** si a la hora 6 vas retrasado, corta el dashboard antes que la Action. La Action es el producto; el dashboard es maquillaje.

**Riesgos técnicos concretos:**
- Webhooks fallando en vivo → ten el fallback grabado.
- Dependencia de red durante la demo → modo mock listo.
- Tiempo de setup de dos repos + dos agentes en escena → prepararlo antes, no durante.

---

## 7. Guion de demo (3 minutos)

**0:00–0:20** — La cifra del 27,67% en pantalla. *"Uno de cada cuatro PRs de agente termina en conflicto de merge."*

**0:20–1:00** — Setup en vivo: dos laptops, dos repos (móvil y web), dos agentes, dos humanos. *"Esta es mi startup el martes pasado."*

**1:00–2:00 — EL MOMENTO.**
Agente A (repo web) reclama: refactor del contrato de auth. Empieza.
Agente B (repo móvil, **otra persona, otra máquina**) intenta reclamar algo que consume ese contrato. Airlock lo frena:

```
BLOQUEADO
diego/agent-3 lleva 12 min en POST /session (repo web, rama auth-refactor).
Cambió la forma de la respuesta. Tu plan asume el contrato viejo.
→ adaptar | esperar | --force
```

**El agente B reajusta su plan solo, en vivo, sin que nadie escriba nada.**
El jurado ve a un agente cambiar de opinión por información que no tenía.

**2:00–2:30 — SEGUNDO ACTO (la bitácora).**
Un tercer agente reclama la misma superficie. Airlock responde en 200 ms, **sin llamar a ningún modelo**:

```
Esto ya se resolvió el martes: el móvil se queda en el contrato viejo hasta v2.1.
Se descartó migrar ambos a la vez porque rompía sesiones activas. PR #87.
```

*"El conflicto se resuelve una vez, no cada vez."*

**2:30–2:50** — Contraste grabado y acelerado: mismo escenario sin Airlock. Merge conflict, app rota, dos horas de agente a la basura.

**2:50–3:00** — Cierre: *"Esto funciona entre repos y entre personas. Ninguna herramienta que existe hoy hace eso."*

---

## 8. Objeciones del jurado

| Pregunta | Respuesta |
|---|---|
| **¿Esto no es Beads?** | Beads es memoria dentro de un repo, y es *pull*: el agente pregunta si se acuerda. Airlock es *push* y cross-repo: bloquea antes de escribir. Son complementarios — Beads es un buen backend de issues debajo nuestro |
| **¿No lo hace Agent HQ?** | Agent HQ deja asignar agentes desde un solo lugar, pero su recomendación oficial ante colisiones es particionar el trabajo tú mismo. Y es un solo repo. Nosotros somos la capa que falta |
| **¿Por qué no un buen `AGENTS.md`?** | Porque una regla en markdown es una sugerencia y un check de CI que falla es una restricción. Y ningún markdown sabe qué está haciendo el agente de otra persona ahora mismo |
| **¿Y si el agente no llama al claim?** | Por eso el enforcement está en el hook y en CI, no en la buena voluntad del modelo |
| **¿Y si el detector se equivoca?** | Existe `--force` con razón registrada. No bloqueamos trabajo, dejamos rastro |
| **¿No se llena de claims muertos?** | TTL con auto-release |

---

## 9. Decisiones abiertas

1. **¿Bloquear o solo advertir?**
   Recomendación: **bloquear, con `--force` visible**. Bloquear demuestra mejor y es más defendible conceptualmente, pero es más frágil en vivo. El `--force` es la salida de emergencia si el detector da un falso positivo frente al jurado.

2. **¿Dónde vive el estado?**
   Un servicio central es lo correcto (cross-repo, cross-persona lo exige) pero es infraestructura que puede caerse en la demo. Alternativa de bajo riesgo: repo dedicado + Action, más lento pero sin servidor propio.

3. **¿Se abre el claim manualmente o el agente lo infiere?**
   Que lo infiera del prompt es más mágico y demuestra mejor. Que sea explícito es más confiable. Sugerencia: inferir y mostrar en pantalla para confirmación implícita.

---

## Fuentes

Verificadas por búsqueda web el 24 de julio de 2026.

- AgenticFlict — dataset de conflictos de merge en PRs de agentes: https://arxiv.org/pdf/2604.03551
- MAST, *Why Do Multi-Agent LLM Systems Fail?* — https://arxiv.org/abs/2503.13657
- GitHub, orquestación con Mission Control — https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
- Beads — https://steveyegge.github.io/beads/ · https://github.com/steveyegge/beads
- Memorix (capa de memoria MCP) — https://mcpservers.org/servers/avids2/memorix
- Panorama de orquestadores 2026 (Addy Osmani) — https://addyosmani.com/blog/code-agent-orchestra/
- Patrones de coordinación en VCS para agentes (hooks pre-edit, atribución en commit) — https://www.perforce.com/blog/vcs/p4-vs-git-for-ai-coding-agents

**Nota sobre las cifras:** los porcentajes de AgenticFlict y la taxonomía MAST vienen de los papers citados. La afirmación de que ninguna herramienta actual cubre coordinación cross-repo y cross-persona es una **inferencia** a partir de la documentación pública de cada una, no de una revisión exhaustiva del ecosistema.
