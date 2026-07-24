# CONTRACT.md — fuente de verdad de Peaje

> Congelado en la hora 0. Si un cambio contradice este archivo, **para y avisa**.
> Todo agente que trabaje en una hoja recibe este archivo pegado en su prompt.

## 0. Vocabulario

- **deuda** — `totalWaitedMs`: suma de milisegundos que las sesiones llevan esperando al humano.
- **nivel** — `calm` | `nudge` | `angry` | `toll`. Deriva de la deuda.
- **permiso retenido** — un `PermissionRequest` que el servidor sostiene abierto mientras el
  humano decide desde el widget.
- **token** — unidad de multi-tenancy. Un token compartido = un equipo.

## 1. Umbrales (única definición, no duplicar)

| Nivel | Deuda total |
|---|---|
| `calm` | 0 (nadie esperando) |
| `nudge` | ≥ 2 min |
| `angry` | ≥ 5 min |
| `toll` | ≥ 10 min |

- Sesión `stale`: sin eventos por > 30 min. Deja de sumar deuda.
- TTL de token: 2 h sin eventos → se borra.
- Retención de permiso: **85 s** máximo (el hook tiene `timeout: 90`, dejamos 5 s de margen).

## 2. Hook → servidor

`POST /hook?token=<TOKEN>&who=<NOMBRE>`
Body: el payload nativo de Claude Code, sin modificar. **Guardar siempre el crudo.**

Campos que sí existen (verificados contra las docs oficiales):
`session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`.

| Evento | `async` | Campos que usamos |
|---|---|---|
| `SessionStart` | `true` | `cwd` → repo, `source`, `model` |
| `Notification` | `true` | `message`; matcher: `agent_needs_input`, `agent_completed`, `idle_prompt`, `permission_prompt` |
| `Stop` | `true` | `last_assistant_message` → insumo del brief |
| `PostToolUse` | `true` | `tool_name`, `tool_input` → detección de loop |
| `StopFailure` | `true` | `error_type` |
| `SubagentStop` | `true` | `agent_type` |
| `SessionEnd` | `true` | `exit_reason` |
| **`PermissionRequest`** | **`false`** | `tool_name`, `tool_input`, `tool_use_id`, `permission_type` |

**Regla dura:** todo evento informativo va con `"async": true` y el servidor responde `200` vacío
de inmediato. El único síncrono es `PermissionRequest`.

## 3. Respuesta a `PermissionRequest`

**Regla de retención.** El servidor responde **`200` con cuerpo vacío al instante** (→ Claude Code
muestra el prompt normal) **salvo** que la deuda del token esté en `nudge` o superior. Solo cuando
el humano está ausente se retiene.

Si retiene y el humano decide desde el widget, responde `200` con:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" } } }
```

`behavior`: `"allow"` | `"deny"`. Si nadie decide en 85 s → `200` vacío (cae al prompt normal).
**Nunca se cuelga un agente.**

## 4. Servidor → widget (SSE `GET /events?token=`, 1 msg/s)

```json
{
  "totalWaitedMs": 2820000,
  "level": "angry",
  "sessions": [
    { "sessionId": "abc-123", "repo": "buk-api", "who": "diego",
      "status": "waiting", "reason": "needs_input",
      "since": 1753372800000, "waitedMs": 1320000,
      "lastMessage": "Necesito confirmar antes de borrar…", "loopCount": 0 }
  ],
  "permits": [
    { "id": "p_1", "sessionId": "abc-123", "repo": "buk-api", "who": "diego",
      "tool": "Bash", "input": "rm -rf migrations/",
      "advice": { "verdict": "deny", "why": "borra migrations sin backup" },
      "expiresInMs": 62000 }
  ],
  "speak": null
}
```

- `status`: `working` | `waiting` | `done` | `stale`
- `reason`: `needs_input` | `permission` | `completed` | `idle` | `failed` | null
- `speak`: `null` salvo cuando hay algo nuevo que decir. El widget nunca repite lo ya dicho.
- `advice`: `null` si la IA no respondió a tiempo. El widget muestra los botones igual.

## 5. Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/hook?token=&who=` | Ingesta. Responde rápido. Único punto que puede retener |
| `GET` | `/events?token=` | SSE, 1 msg/s |
| `POST` | `/api/permit/:id?token=` | `{ "decision": "allow" \| "deny" }` → resuelve un permiso retenido. **El token es obligatorio**: sin él, 404 |
| `GET` | `/api/brief?token=` | Ranking + porqués. Con fallback determinista |
| `POST` | `/api/toll/complete?token=` | Peaje pagado, resetea la deuda |
| `POST` | `/api/demo/start?token=` | Estado sembrado + reloj acelerado |
| `GET` | `/api/state?token=` | Volcado crudo del estado (debug y verificación) |
| `GET` | `/api/token/new` | Token nuevo |
| `GET` | `/healthz` | `ok`. Lo pinga el widget cada 10 min (Render free duerme) |

## 6. Fallback determinista (obligatorio, se construye ANTES que la IA)

Si la IA falla o tarda > 5 s:

```
score = waitedMs × peso(reason) × (1 + loopCount)
peso: permission 3.0 · needs_input 2.5 · failed 2.0 · completed 1.5 · idle 1.0
```

Para `advice` de un permiso sin IA: `null` → el widget muestra Permitir/Denegar sin recomendación.
**La demo nunca puede depender de la red ni de la API key.**

## 7. Seguridad (decidido, no re-litigar)

Aprobar un permiso **ejecuta un comando en la máquina de alguien**. Por eso:

- El **token es la única credencial** y se genera con CSPRNG (`randomBytes`), nunca `Math.random`.
- Los **ids de permiso son impredecibles** (`randomBytes`), nunca un contador. Un id secuencial
  dejaría que un extraño adivine el siguiente y lo apruebe.
- `POST /api/permit/:id` **exige el token** y lo compara con `timingSafeEqual`. Sin él, 404.
- **Nada de `innerHTML`** con datos del stream: `repo`, `who`, `lastMessage`, `input` y `advice.why`
  vienen de payloads de hooks, y con token de equipo se renderizan datos de otra persona.
- **Tradeoff asumido:** el token viaja en la query string porque *es* el mecanismo de onboarding y
  de equipo. Queda en logs y en el `Referer`. Mitigación: TTL de 2h, token rotable desde la landing,
  y el servidor ya acepta `Authorization: Bearer` para migrar sin cambios.
- **Por diseño, quien tiene el token del equipo puede aprobar en la máquina de cualquiera del
  equipo.** Es la feature, no un bug. Permisos por persona es roadmap.

## 8. Reglas de código

- Feo y funcional. Cero abstracciones. Este código vive 8 horas.
- Deps permitidas: `express`, `@anthropic-ai/sdk`, `dotenv`. Ninguna más.
- Sin React, sin bundler, sin TypeScript, sin base de datos.
- **Toda la lógica del widget vive dentro de `widget.html`.** La pestaña madre solo abre la PiP
  y se calla (los navegadores estrangulan los timers de pestañas en segundo plano).
- Un módulo = un dueño. No edites archivos fuera de tu encargo.
