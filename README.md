# Peaje

**Tus agentes te están esperando a ti. Peaje mide esa deuda y te deja saldarla sin volver a la terminal.**

> Históricamente el humano esperaba a la máquina.
> Ahora varios agentes te están esperando a ti, y nadie mide ese costo.
> **Tú eres el rate limiter.**

Hacker: Diego Alejandro Molano Roa ([@dmolanor](https://github.com/dmolanor)) — Platanus Build Night, Bogotá @ Buk

<img src="./project-logo.png" alt="Peaje" width="160" />

---

## El problema

El recurso escaso ya no es cómputo: es tu atención. Trabajas con varias sesiones de Claude Code y
la mitad están **paradas esperando que decidas algo**, mientras tú estás en el celular sintiéndote
productivo. Ya tienes dashboards. Los ignoras igual.

Todas las herramientas que existen **informan**. Ninguna **interviene**.

## Qué hace Peaje

1. **Cuenta los agent-minutos** que tus agentes pierden esperándote — pesados por agentes
   realmente parados: una sesión detenida con 3 subagentes son **4 agentes parados**, no 1.
2. **Escala la intervención** conforme crece la deuda: el personaje cambia de color, luego te
   habla, y al pasar el umbral **cobra peaje** y te bloquea la pantalla.
3. **El peaje se paga desbloqueando, no esperando.** Aprueba o deniega desde el widget flotante
   los permisos que tienen agentes congelados, con una recomendación del modelo sobre cada uno.
4. **Al salir recibes un brief** que reconstruye qué pasaba en cada sesión y cuál conviene matar
   por estar dando vueltas.

## Lo que lo hace posible

El hook `PermissionRequest` de Claude Code acepta que un handler responda `allow`/`deny`
**en nombre del usuario**. Peaje retiene esa petición mientras tú decides desde la ventana
flotante — o desde el celular, es la misma URL.

**Garantía dura:** si nadie decide en 85 s, el servidor responde vacío y Claude Code muestra el
prompt normal en la terminal. Un timeout de hook es un error *no bloqueante*. **Peaje nunca cuelga
un agente.** Y si estás en el teclado (deuda baja), ni siquiera interviene: pasa de largo.

## Instalación — sin instalar nada

1. Abre la URL desplegada → te da tu token.
2. Copia el bloque de hooks y pégalo en `~/.claude/settings.json`.
3. Clic en **Abrir widget** → la ventana flota sobre tu terminal.

Son hooks HTTP nativos de Claude Code. Sin `npx`, sin daemon local, sin binarios.

**Un token compartido es un equipo:** ambos ven la misma cola y cualquiera puede desbloquear al
agente del otro. Es la feature, no un bug — permisos por persona es el siguiente paso.

## Arquitectura

```
Claude Code (N sesiones, M repos, K personas)
   │  hooks type:"http"  →  POST /hook?token=…&who=…
   │  ← {allow|deny} solo en PermissionRequest retenido
   ▼
Servidor Node (un proceso)   estado en memoria por token · deuda · cola de permisos · IA
   │  SSE
   ▼
widget.html  →  ventana Document Picture-in-Picture  +  la misma URL en el celular
```

Sin relay local. Sin base de datos. Sin bundler. Estado en memoria con TTL de 2 h.

| Capa | Elección |
|---|---|
| Servidor | Node + Express, un solo proceso |
| Stream | SSE (reconecta solo) |
| Front | HTML + JS vanilla + SVG/CSS |
| IA | `@anthropic-ai/sdk`, `claude-opus-5`, structured outputs |

## La demo nunca depende de la red

Todo tiene fallback determinista. Sin `ANTHROPIC_API_KEY`, o si el modelo tarda, el ranking sale
de `waitedMs × blockedAgents × peso(motivo) × (1 + loops)` y los botones de permiso aparecen igual.
`POST /api/demo/start` siembra estado con reloj acelerado para recorrer los cuatro niveles en segundos.

## Correr local

```bash
npm install
cp .env.example .env      # opcional: ANTHROPIC_API_KEY
npm start                 # http://localhost:7777
```

## Qué viaja y qué no

**Nunca sale de tu máquina:** el transcript (solo recibimos su *ruta*; el servidor no puede leer
tu disco), tu repositorio, tus archivos en reposo, tus credenciales.

**Sí viaja:** los hooks HTTP mandan el payload nativo completo de cada evento, y no hay cliente
local que lo filtre. Eso incluye el prompt que escribes, el contenido de un archivo en un `Write`,
el diff de un `Edit`, el comando y su salida en un `Bash`, y la respuesta final del modelo.

**Se guarda una fracción:** título (80 chars), último prompt (90), último mensaje (600) y firmas de
herramienta (nombre + ruta, 120). El resto se descarta al llegar. Sin persistencia, sin logs, en
memoria, TTL de 12 h.

> **El tradeoff, dicho de frente:** cambiamos minimización de datos por instalación sin instalar
> nada. Un relay local podría filtrar en el origen — es justo lo que quitamos para que el
> onboarding fueran 30 segundos. El modo local es lo primero del roadmap.

## Qué sigue

- Permisos por persona dentro de un equipo
- Modo local sin nube
- PRs e issues que te esperan, en el mismo ranking: la deuda no es solo con tus agentes
- Versión de escritorio con bloqueo real

---

*Ver `CONTRACT.md` para los contratos de datos y `docs/peaje-brief (1).md` para el razonamiento
de producto.*
