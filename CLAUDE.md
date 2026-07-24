# Peaje — reglas del proyecto

Hackathon, 8 horas, un solo entregable desplegado. **Este código vive 8 horas.**

`CONTRACT.md` es la fuente de verdad. Si tu cambio lo contradice, para y avisa.

## Inviolables

- Código feo y funcional. CERO abstracciones, CERO capas, CERO genéricos, CERO helpers "por si acaso".
- Dependencias permitidas: `express`, `@anthropic-ai/sdk`, `dotenv`. **Ninguna más sin preguntar.**
- Nada de React, bundlers, TypeScript, ORM ni base de datos.
- No agregues features fuera del tier declarado. Si crees que falta algo, **propónlo, no lo construyas**.
- Toda la lógica del widget vive DENTRO de `public/widget.html`. La pestaña madre solo abre la PiP
  y se calla — los navegadores estrangulan los timers de pestañas en segundo plano.
- Hooks informativos SIEMPRE con `"async": true`. El único síncrono es `PermissionRequest`.
- Un módulo = un dueño. No edites archivos fuera de tu encargo.

## Entorno

- Windows. PowerShell **no soporta `&&`** — usa `;` o el Bash tool.
- Node 24. **Desplegado en https://platanus-build-night.onrender.com**
- **Verifica siempre contra la URL desplegada, no contra localhost.**

## Verificado en producción (no re-litigar)

- El proxy de Render **aguanta los 85 s** de retención: `200` vacío a los 85.15 s.
- La recomendación de la IA llega en ~4 s; el brief en ~5 s.
- Sin `ANTHROPIC_API_KEY` todo sigue funcionando con el fallback determinista.

## Antes de tocar el SDK de Anthropic

Carga la skill `claude-api` primero. No inventes model IDs ni parámetros.
Modelo elegido: `claude-sonnet-5`. Timeout 5 s → fallback determinista de `CONTRACT.md` §6.

## Verificación

Cada milestone termina con su comprobación ejecutable. No avances sin que pase.
Después de cada milestone verificado: **commit**.
