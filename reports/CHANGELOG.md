# CHANGELOG zabbix-codex

## 2026-06-23 - Hotfix post-reinicio informes diarios y MCP

- Causa raiz del informe diario: tras v0.21.0 el timer llamaba a `/api/dashboard/run-daily-report` sin sesion y recibia `HTTP 401`.
- Añadido bypass server-side seguro solo para `POST /api/dashboard/run-daily-report` mediante `INTERNAL_JOB_TOKEN`.
- `scripts/generateDailyDashboard.js` envia `X-Internal-Job-Token` si el token esta configurado.
- Añadido `EnvironmentFile=/etc/infra-agent-web/security.env` al servicio de informe diario para cargar el token interno.
- Causa adicional tras reinicio: `zabbix-infra-mcp.service` estaba instalado pero deshabilitado, por lo que no escuchaba en `127.0.0.1:8765`.
- Habilitado y arrancado `zabbix-infra-mcp.service` para que sobreviva reinicios.
- Validacion:
  - `mcp-infra-agent` responde en `/healthz` con auth.
  - `infra-agent-web-daily-report.service` finaliza correctamente.
  - Informe diario generado con 4 reportes; 3 desde OpenAI Responses y 1 con fallback local por error transitorio de OpenAI, no por falta de creditos.

## 2026-06-04 - infra-agent-web v0.21.0 Seguridad AD, RBAC y auditoria

### Objetivo

- Introducir autenticacion corporativa contra Active Directory, autorizacion por roles y auditoria de accesos sin crear usuarios propios en la app.

### Cambios

- Añadido login con Auth.js/NextAuth mediante proveedor de credenciales contra Active Directory por LDAPS.
- Añadidos modulos server-side:
  - `lib/security/adLdapClient.js`
  - `lib/security/authOptions.js`
  - `lib/security/apiAuth.js`
  - `lib/security/permissions.js`
  - `lib/security/roleMapping.js`
  - `lib/security/auditLogger.js`
  - `lib/security/rateLimit.js`
  - `lib/security/config.js`
- Añadido `middleware.js` para proteger paginas y APIs por sesion y permisos.
- Añadido endpoint publico seguro `GET /api/health`.
- Añadida pantalla `/login`, `SessionProvider` global y `AuthGate` de frontend.
- Añadido mapeo de grupos AD a roles internos `admin`, `operator`, `viewer`, `display`, `powerbi` y `auditor`.
- Añadida matriz de permisos con denegacion por defecto.
- Añadida auditoria JSONL para login correcto, login fallido, logout, accesos denegados, consultas al agente y consultas Power BI visuales.
- Añadido rate limiting basico en login.
- Añadido modo gradual `SECURITY_RBAC_ENFORCE=false` para auditar sin bloquear durante despliegue controlado.
- La pantalla `/agent-display` muestra version `v0.21.0` y oculta controles Dev a usuarios sin permisos operativos.

### Documentacion

- `docs/security/AD_SETUP.md`
- `docs/security/RBAC_MATRIX.md`
- `docs/security/DEPLOYMENT_CHECKLIST.md`
- `docs/security/AUDIT_LOGS.md`
- `docs/security/TROUBLESHOOTING.md`

### Validacion prevista

- `npm run test:security`
- `npm run build`
- Login AD con usuario de grupo permitido.
- API sin sesion devuelve `401`.
- API sin permiso devuelve `403` con `SECURITY_RBAC_ENFORCE=true`.
- Usuario `display` accede a `/agent-display` y no a funciones operativas.

### Compatibilidad

- Sin cambios destructivos en chat, Power BI funcional, Zabbix write paths ni endpoints de negocio.
- No se guardan credenciales de usuario, tokens, cookies, secretos ni connection strings en auditoria.

## 2026-06-03 - infra-agent-web v0.20.8 consultas Power BI sugeridas en Agent Display

### Objetivo

- Permitir ejecutar consultas Power BI sugeridas desde `/agent-display` con una ruta segura, reutilizando el motor existente.

### Cambios

- Nuevo endpoint `POST /api/agent-display/powerbi-query` para ejecutar solo preguntas permitidas desde la pantalla visual.
- Reutilizacion del flujo Power BI existente (`buildPowerBiAskLabPayload` + `runPowerBiControlledDaxLab`) sin crear un motor nuevo.
- La vista Power BI de `/agent-display` muestra preguntas sugeridas ejecutables, estado de consulta, resumen, highlights y resultado compacto.
- Las consultas quedan limitadas a la allowlist derivada de las preguntas sugeridas del modelo, sin permitir preguntas arbitrarias.
- Power BI sigue en segundo plano cuando infraestructura o informes tienen mayor prioridad.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios destructivos en Power BI funcional existente.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato base de `/api/agent-display/status`.

### Validacion

- `GET /api/agent-display/status` mantiene `powerbiSummary.status=connected` para `administracion_ventas`.
- `POST /api/agent-display/powerbi-query` acepta solo preguntas sugeridas y devuelve un resumen ejecutivo compacto.
- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.

## 2026-06-03 - infra-agent-web v0.20.7 Power BI executive view

### Objetivo

- Convertir la vista Power BI de `/agent-display` en una lectura ejecutiva útil y honesta.

### Cambios

- `powerbiSummary` enriquecido con `businessSummary` compatible y opcional.
- La vista Power BI muestra un resumen ejecutivo, KPIs reales del modelo, aspectos clave, elementos a vigilar y preguntas sugeridas.
- Los textos de Power BI pasan a lenguaje ejecutivo en lugar de mensajes puramente técnicos.
- La vista prioritaria solo puede ser Power BI cuando está conectado y aporta información útil, sin desplazar infraestructura crítica.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios destructivos en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato base de `/api/agent-display/status`.

### Validacion

- `GET /api/agent-display/status` mantiene `powerbiSummary.status=connected` para `administracion_ventas`.
- `powerbiSummary` expone KPIs, insights y lectura ejecutiva sin inventar métricas.
- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.

## 2026-06-03 - infra-agent-web v0.20.6.1 hotfix Power BI status

### Objetivo

- Dejar trazado el hotfix que corrige el flujo de estado de `/agent-display` sin añadir funcionalidad nueva.

### Cambios

- Corregido `await` faltante al resolver `buildPayload()` en `/api/agent-display/status`.
- Corregido el cálculo de KPIs Power BI usando el esquema real del catálogo (`tables`, `columns`, `measures`, `relationships`, `hierarchies`).
- Mantenido el fallback seguro si Power BI no responde o no hay modelo disponible.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional existente.
- Sin cambios en Zabbix write paths.
- Sin cambios en endpoints críticos.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `curl -s http://127.0.0.1:3010/api/agent-display/status` devuelve `ok=true`.

## 2026-06-02 - infra-agent-web v0.20.6 Power BI base for agent-display

### Objetivo

- Empezar a conectar Power BI real en `/agent-display` de forma segura y conservadora.
- Reutilizar la capa Power BI existente sin romper chat, Zabbix write paths ni APIs criticas.

### Cambios

- Nuevo helper server-side `agentDisplayPowerbi` para componer un resumen Power BI compatible con `/agent-display`.
- `powerbiSummary` enriquecido con estado, modelo, KPIs, insights y marca temporal, con fallback seguro.
- El panel Power BI del centro y de la columna derecha muestran un estado mas util cuando la integracion esta parcial o pendiente.
- La vista prioritaria solo puede ser `powerbi` cuando la integracion esta realmente conectada y aporta datos utiles.
- Si Power BI sigue pendiente, queda en segundo plano sin robar protagonismo a infraestructura, alertas o informes.

### Validacion

- `GET /api/agent-display/status` devuelve `powerbiSummary.status=connected` para `administracion_ventas`.
- El resumen incluye metadatos reales del modelo, 15 tablas, 2 medidas y 2 informes asociados.
- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.

### Compatibilidad

- Sin cambios destructivos en chat.
- Sin cambios en la logica funcional de Power BI existente.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato actual de `/api/agent-display/status`.

## 2026-06-02 - infra-agent-web v0.20.5.1 hotfix visual overview

### Objetivo

- Corregir la regresion visual de la vista `overview` en `/agent-display`.
- Eliminar solapamientos de textos y mejorar el aprovechamiento del panel central.

### Cambios

- Rejilla de `overview` simplificada y estable en 2x3.
- KPIs con ancho suficiente para evitar solapamiento entre estado y numero.
- Ajuste de fuentes, alturas y anchos de tarjetas para pantallas grandes.
- Mejor distribución del panel central y menor hueco visual a la derecha.
- Ajuste leve de la cabecera para reducir protagonismo y dejar mas espacio util.

### Compatibilidad

- Sin cambios en la logica del modo inteligente.
- Sin cambios en el contrato de `/api/agent-display/status`.
- Sin cambios en chat, Power BI funcional, Zabbix write paths ni `activeReport`.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `/agent-display` sirve `v0.20.5.1`.

## 2026-06-02 - infra-agent-web v0.20.5 director visual inteligente

### Objetivo

- Convertir el carrusel de `/agent-display` en una capa de presentacion inteligente.
- Priorizar automaticamente la vista central mas relevante segun el estado real de la infraestructura.

### Cambios

- Nuevo modo automatico inteligente para el panel central.
- La vista prioritaria se calcula con datos reales de:
  - informe ejecutivo,
  - alertas activas,
  - recomendaciones,
  - estado global de infraestructura,
  - estado de Power BI.
- La pantalla muestra ahora el motivo de la vista priorizada de forma discreta.
- `report` y `alerts` toman prioridad cuando el informe o las incidencias reales lo requieren.
- `overview` queda como vista de apoyo cuando el estado general o la ausencia de Power BI mandan.
- `powerbi` pendiente sigue en segundo plano y no domina la pantalla.
- Los controles de desarrollo mantienen modo manual, pausa y retorno al modo auto.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato de `/api/agent-display/status`.
- Fallback, carrusel e informe ejecutivo siguen intactos.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `/agent-display` sirve `v0.20.5`.
- `GET /api/agent-display/status` sigue devolviendo `ok=true`, `dataSource=real`, `agentStatus=alert`.

## 2026-06-02 - infra-agent-web v0.20.4 ajuste de jerarquia visual

### Objetivo

- Aprovechar mejor el espacio en pantalla grande.
- Reducir ruido visual y hacer que el centro de `/agent-display` pese mas.

### Cambios

- Cabecera compactada con menor altura y tipografia ligeramente mas contenida.
- Zona central reforzada para que el carrusel ocupe mejor el area principal.
- `overview` gana mas peso visual con KPIs mas equilibrados.
- `report` distribuye mejor resumen, riesgos y proximas acciones.
- `recommendations` y `alerts` aprovechan mejor el alto disponible.
- `powerbi` se muestra de forma mas discreta cuando sigue pendiente de conexion.
- Controles de desarrollo mas discretos y colapsables por defecto.
- Ajuste de nomenclatura visual en alertas segun severidad real.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato de `/api/agent-display/status`.
- Fallback, carrusel e informe ejecutivo siguen intactos.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `/agent-display` sirve `v0.20.4`.
- `GET /api/agent-display/status` sigue devolviendo `ok=true`, `dataSource=real`, `agentStatus=alert`.

## 2026-06-02 - infra-agent-web v0.20.3 avatar secundario y centro protagonista

### Objetivo

- Dejar `/agent-display` centrado en paneles informativos.
- Reducir el avatar a un elemento secundario compacto en la esquina superior izquierda.

### Cambios

- Avatar compactado arriba a la izquierda con etiqueta de estado breve.
- El centro de la pantalla gana más peso visual para el carrusel y los paneles activos.
- Se refuerza la jerarquía de:
  - `overview`,
  - `alerts`,
  - `report`,
  - `recommendations`,
  - `powerbi`.
- Se mantienen los controles de desarrollo discretos y fuera del foco principal.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato de `/api/agent-display/status`.
- Fallback, carrusel e informe ejecutivo siguen intactos.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `/agent-display` sirve `v0.20.3`.

## 2026-06-02 - infra-agent-web v0.20.2 avatar secundario en Agent Display

### Objetivo

- Reducir el protagonismo del avatar en `/agent-display`.
- Liberar la zona central para paneles informativos y el carrusel de vistas.

### Cambios

- Avatar recolocado a la esquina superior izquierda en formato compacto.
- El bloque central del avatar desaparece como elemento protagonista.
- La zona central pasa a priorizar `overview`, `alerts`, `report`, `recommendations` y `powerbi`.
- Se mantiene la reproducción de vídeo segun `agentStatus`, pero como presencia secundaria.
- La jerarquia visual del centro de control queda mas clara para monitor grande o TV.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Sin cambios en el contrato de `/api/agent-display/status`.
- Fallback y carrusel siguen funcionando.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `curl -I http://127.0.0.1:3010/agent-display` devuelve `200 OK`.
- `/agent-display` sirve `v0.20.2`.
- Revisión visual esperada:
  - avatar pequeño en la parte superior izquierda,
  - centro libre para contenido,
  - paneles protagonistas en la zona central.

## 2026-06-02 - infra-agent-web v0.20.1 pulido visual de Agent Display

### Objetivo

- Hacer `/agent-display` mas legible y comodo como pantalla grande o modo TV.
- Mantener la logica existente y el informe ejecutivo automatico sin añadir complejidad nueva.

### Cambios

- Ajuste visual de tipografia, espaciado y jerarquia en:
  - cabecera,
  - KPIs de `overview`,
  - `alerts`,
  - `report`.
- `overview` gana mas presencia visual con tarjetas mas grandes y cifras mas claras.
- `alerts` muestra menos ruido y mejor lectura de severidad y detalle.
- `report` conserva el informe ejecutivo protagonista, con mejor respiracion visual y listas mas limpias.
- Carrusel y transiciones mantenidos, con una lectura mas suave en pantalla grande.
- Controles de desarrollo siguen disponibles pero quedan discretos y fuera del foco visual.

### Compatibilidad

- Sin cambios en chat.
- Sin cambios en Power BI funcional.
- Sin cambios en Zabbix write paths.
- Fallback seguro intacto si faltan campos o el endpoint devuelve datos parciales.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `/agent-display` devuelve `200 OK`.
- `/api/agent-display/status` devuelve `ok=true`, `dataSource=real`, `agentStatus=alert` y `activeReport` informado.
- Logs recientes revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos,
  - tokens,
  - connection strings.

## 2026-06-01 - infra-agent-web v0.20.0 Agent Display informe ejecutivo

### Objetivo

- Mejorar la vista `report` de `/agent-display` para mostrar un primer informe ejecutivo automatico de infraestructura.
- Usar datos reales ya disponibles en `/api/agent-display/status` siempre que sea seguro.
- Mantener fallback controlado si Zabbix, informes estructurados o datos auxiliares no estan disponibles.

### Cambios

- Nuevo compositor server-side:
  - `infra-agent-web/lib/agentDisplayReport.js`.
- `/api/agent-display/status` integra ahora `activeReport` como informe ejecutivo estable.
- El informe incluye:
  - titulo,
  - fecha de generacion,
  - severidad,
  - resumen ejecutivo,
  - puntos destacados,
  - riesgos principales,
  - proximas acciones,
  - fuente `real` / `fallback` / `mock`.
- La vista `report` del carrusel muestra el informe de forma protagonista y legible para pantalla grande.
- Refuerzo visual cuando la severidad es critica, sin cambiar el flujo de alertas existente.

### Seguridad y compatibilidad

- No se llama a Zabbix desde navegador.
- No se han tocado chat, Power BI funcional, Zabbix write paths ni endpoints criticos existentes.
- El endpoint mantiene respuesta `ok=true` con fallback seguro siempre que pueda responder.
- No se exponen secretos, tokens, URLs sensibles ni cuerpos extensos.

### Validacion

- `npm run build` correcto.
- Produccion reiniciada correctamente con `systemctl restart infra-agent-web.service`.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `/agent-display` devuelve `200 OK` y sirve `v0.20.0`.
- `/api/agent-display/status` devuelve:
  - `ok=true`,
  - `dataSource=real`,
  - `agentStatus=alert`,
  - `activeReport.title=Informe ejecutivo de infraestructura`,
  - `activeReport.severity=critical`,
  - `activeReport.source=real`,
  - puntos destacados, riesgos y proximas acciones informados.
- Logs recientes revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos,
  - tokens,
  - connection strings.

## 2026-06-01 - infra-agent-web v0.19.9 Agent Display modo presentacion

### Objetivo

- Convertir `/agent-display` en un centro de control mas vivo para monitor grande o TV.
- Reutilizar el endpoint real `/api/agent-display/status` creado en v0.19.8 sin tocar chat, Power BI funcional, Zabbix write paths ni endpoints existentes.

### Cambios

- Anadido modo presentacion/carrusel dentro de `AgentDisplayShell`.
- Vistas automaticas:
  - `overview`,
  - `alerts`,
  - `recommendations`,
  - `report`,
  - `powerbi`.
- Intervalo automatico de carrusel cada 15 segundos.
- Nueva zona protagonista central que cambia de contenido sin abandonar la pantalla general.
- Priorizacion visual de alertas cuando `agentStatus=alert` y existen alertas criticas.
- Controles discretos de desarrollo para:
  - pausar/activar carrusel,
  - avanzar a la siguiente vista,
  - volver a modo automatico,
  - forzar estados visuales del agente.
- Indicadores siempre visibles de:
  - ultima actualizacion,
  - `dataSource`,
  - estado del agente,
  - vista activa.

### Robustez

- Defensas para campos nulos o vacios en:
  - `criticalAlerts`,
  - `recommendations`,
  - `activeReport`,
  - `powerbiSummary`,
  - `infrastructureSummary`.
- El avatar sigue usando reposo para `idle` y video hablando para `thinking`, `speaking`, `reporting` y `alert`.
- No se han anadido voz, TTS, STT, WebRTC ni sincronizacion labial.

### Validacion

- `npm run build` correcto.
- Produccion reiniciada correctamente con `systemctl restart infra-agent-web.service`.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `/agent-display` devuelve `200 OK`.
- `/api/agent-display/status` devuelve `ok=true`, `dataSource=real` y `agentStatus=alert`.
- Logs recientes revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos,
  - tokens,
  - connection strings.

## 2026-06-01 - infra-agent-web v0.19.8 Agent Display con estado dinamico

### Objetivo

- Convertir `/agent-display` en una interfaz viva que consuma un contrato server-side estable.
- Preparar la pantalla para infraestructura, alertas, informes y futuras integraciones sin tocar chat, Power BI, Zabbix write paths ni endpoints existentes.

### Cambios

- Nuevo endpoint:
  - `infra-agent-web/pages/api/agent-display/status.js`.
- Contrato JSON estable:
  - `ok`,
  - `generatedAt`,
  - `dataSource`,
  - `agentStatus`,
  - `headline`,
  - `agentMessage`,
  - `infrastructureSummary`,
  - `criticalAlerts`,
  - `powerbiSummary`,
  - `activeReport`,
  - `recommendations`.
- `AgentDisplayShell` consume `/api/agent-display/status`.
- Polling cliente cada 30 segundos.
- Modo automatico por endpoint y controles manuales de desarrollo para forzar estados visuales.
- Indicadores visibles de:
  - ultima actualizacion,
  - origen de datos `real` / `fallback` / `mock`.

### Datos usados

- Se reutilizan de forma conservadora helpers existentes:
  - `zabbixLiveClient.getLatestProblems`,
  - `dashboardComposer.composeLatestDashboard`.
- No se llama a Zabbix desde navegador.
- Si Zabbix, MCP o informes no responden, el endpoint devuelve fallback seguro con `ok=true` y estructura estable.
- Power BI queda como `not_connected` en esta pantalla, preparado para integracion posterior.

### Validacion

- `npm run build` correcto.
- Build incluye:
  - `/agent-display`,
  - `/api/agent-display/status`.
- Validado con servidor temporal en `127.0.0.1:3024`.
- Produccion reiniciada correctamente con `systemctl restart infra-agent-web.service`.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Produccion validada en `127.0.0.1:3010`:
  - `/agent-display` devuelve `200 OK`,
  - `/api/agent-display/status` devuelve `ok=true`,
  - `dataSource=real`,
  - `agentStatus=alert`,
  - resumen de infraestructura con problemas activos,
  - alertas criticas y recomendaciones.
- Logs recientes revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos,
  - tokens,
  - connection strings.

## 2026-06-01 - infra-agent-web v0.19.7 Agent Display / Command Center

### Objetivo

- Crear una nueva capa visual superior para el agente inteligente sin romper el chat, Power BI, APIs ni rutas existentes.
- Incorporar una pantalla full-screen tipo centro de control para monitor grande o TV.
- Preparar la base visual para futuras integraciones con infraestructura, Power BI, informes automaticos y voz.

### Cambios

- Nueva ruta:
  - `/agent-display`.
- Nuevo componente:
  - `infra-agent-web/components/AgentDisplayShell.js`.
- Nueva pagina:
  - `infra-agent-web/pages/agent-display.js`.
- Nueva carpeta publica para avatar:
  - `infra-agent-web/public/avatar/`.
- Documentacion de assets de avatar:
  - `infra-agent-web/public/avatar/README.md`.

### Avatar

- La pantalla espera estos archivos:
  - `public/avatar/avatar-en-reposo.mp4`,
  - `public/avatar/avatar-hablando.mp4`.
- `idle` usa el video de reposo.
- `thinking`, `speaking`, `alert` y `reporting` usan el video activo/hablando.
- Se anade transicion de opacidad entre videos.
- Si los MP4 no estan copiados todavia, la ruta carga con fallback visual y no rompe la UI.

### Estados visuales

- `idle`: Agente en reposo.
- `thinking`: Analizando datos.
- `speaking`: Mostrando respuesta.
- `alert`: Alerta critica.
- `reporting`: Generando informe.
- Controles discretos de desarrollo para cambiar estado manualmente y ocultarlos.

### Paneles iniciales

- Estado infraestructura.
- Alertas criticas.
- Power BI / Ventas.
- Ultimo informe.
- Consulta activa.
- Mensaje/recomendaciones del agente.

### Estructura preparada

- Datos mock organizados para evolucionar hacia:
  - `agentStatus`,
  - `currentMode`,
  - `activeReport`,
  - `infrastructureSummary`,
  - `powerbiSummary`,
  - `criticalAlerts`,
  - `agentMessage`.

### Validacion

- `npm run build` correcto.
- Next reconoce `/agent-display` como pagina server-rendered ligera para detectar assets de avatar.
- Validado con servidor temporal en `127.0.0.1:3023`.
- `GET /agent-display` devuelve `200 OK`.
- Como los MP4 no estan todavia en `public/avatar/`, el HTML no apunta a videos inexistentes y muestra fallback visual.
- Cuando se copien los dos MP4, la ruta los renderizara con `autoplay`, `muted`, `loop` y `playsInline`.
- Los controles de estado aparecen en la pantalla.
- No se reinicia el servicio de produccion.

### Cierre visual del avatar real

- Confirmados videos definitivos en:
  - `infra-agent-web/public/avatar/avatar-en-reposo.mp4`,
  - `infra-agent-web/public/avatar/avatar-hablando.mp4`.
- Validado que `AgentDisplayShell` usa exactamente:
  - `/avatar/avatar-en-reposo.mp4`,
  - `/avatar/avatar-hablando.mp4`.
- `npm run build` correcto tras incorporar los assets reales.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Produccion validada en `127.0.0.1:3010`:
  - `/agent-display` devuelve `200 OK`,
  - `/avatar/avatar-en-reposo.mp4` devuelve `200 OK` con `Content-Type: video/mp4`,
  - `/avatar/avatar-hablando.mp4` devuelve `200 OK` con `Content-Type: video/mp4`.
- HTML de `/agent-display` en produccion renderiza ambos videos con `autoplay`, `muted`, `loop` y `playsInline`.
- Logs recientes revisados sin `ReferenceError`, `TypeError`, `client-side exception`, `fetch failed`, errores ni secretos.

### Pendiente

- Validacion visual manual en navegador/monitor grande para comprobar encuadre fino del avatar en 1920x1080.

## 2026-06-01 - Productizacion segura sin tocar produccion

### Objetivo

- Preparar una zona de trabajo para convertir el proyecto en una plantilla comercial reutilizable.
- Mantener `infra-agent-web` y el servicio de produccion sin cambios.
- Evitar mezclar la plantilla comercial con `templates/`, que ya se usa para plantillas Zabbix.

### Cambios

- Creada carpeta pasiva `productization/`.
- Creado paquete comercial base:
  - `productization/commercial-template/`.
- Creada plantilla de configuracion por cliente:
  - `productization/tenant-template/tenant.config.example.json`.
- Creada plantilla `.env` sin secretos:
  - `productization/commercial-template/config/.env.template`.
- Creadas configuraciones ejemplo de branding y features.
- Creados datos demo sinteticos de incidencias, contactos y preguntas Power BI.
- Creado guion de demo comercial.
- Creada guia de demo:
  - `productization/demo-template/README.md`.
- Creado checklist de paquete comercial:
  - `productization/release-package/checklist.md`.
- Creado checklist de onboarding:
  - `productization/client-onboarding-checklist.md`.
- Creado generador de copia sanitizada:
  - `productization/scripts/create-sanitized-template.sh`.
- Generada copia inicial:
  - `productization/dist/infra-agent-web-template`.
- Generado paquete exportable portable:
  - `productization/dist/infra-agent-web-template-portable-demo.tar.gz`.
- Creado kit de demo portable:
  - `productization/portable-demo/`.
- Creada demo offline sin backend:
  - `productization/portable-demo/offline-clickthrough/index.html`.
- Creado perfil generico para empresas con Zabbix, otros sistemas o sin monitorizacion:
  - `productization/portable-demo/profiles/generic-demo.env`.
- Anadidas instrucciones de instalacion en otro equipo:
  - `productization/portable-demo/docs/install-on-laptop.md`.
- Anadido posicionamiento de conectores:
  - `productization/portable-demo/docs/connector-positioning.md`.
- Anadido soporte Docker de demo:
  - `Dockerfile.demo`,
  - `docker-compose.demo.yml`.
- La copia generada reemplaza `config/powerbi-models.json` por un modelo demo placeholder.
- La copia generada deja `data/` vacio salvo `.gitignore`.

### Seguridad

- No se modifica `infra-agent-web`.
- No se modifica `systemd`.
- No se copian secretos.
- No se copian bases de datos reales.
- No se crean scripts que se ejecuten automaticamente ni se integran con el servicio.
- No se toca funcionalidad de produccion.
- La copia generada excluye `.env.local`, `.next`, `node_modules`, SQLite real y logs.
- El generador revisa patrones de secretos antes de aceptar la copia.
- Validado que la copia no incluye IDs reales conocidos de Power BI ni bases de datos reales.
- Validado que el paquete portable incluye demo offline, Docker demo y perfil generico.

## 2026-05-28 12:07 CEST - infra-agent-web v0.19.6 Power BI rankings avanzados y orden mensual

### Objetivo

- Mejorar el modulo Power BI existente sin crear rutas ni componentes paralelos.
- Mantener las mejoras v0.19.x de:
  - `powerbiNlqInterpreter`,
  - `powerbiDaxLab`,
  - `powerbiChatRouter`,
  - `powerbiVoiceRouter`,
  - Ask Lab / DAX Lab,
  - endpoints `ask/preview` y `ask/execute`,
  - `PowerBiChatResultView`.
- No se tocan Comunicaciones, email, Microsoft Graph, Zabbix, SharePoint ni permisos Power BI.

### Correccion aplicada

- Top N exacto:
  - se reconocen numeros escritos en espanol: `uno`, `una`, `dos`, `tres`, `cuatro`, `cinco`, `diez`, `veinte`,
  - se reconocen expresiones como `top dos`, `las dos variedades`, `los cinco clientes principales`,
  - `las dos variedades mas vendidas en 2024` se interpreta como `Top 2`, no como `Top 10`.
- Producto / variedad:
  - `variedad`, `producto`, `articulo` y `nombre de variedad` siguen priorizando `articulos[nombre]`,
  - no se usa `especie` salvo peticion explicita del usuario.
- Bottom N / menos vendidos:
  - se reconocen `menos vendidos`, `menor venta`, `menores ventas`, `peores`, `bottom`, `ultimos por ventas`, `con menos ventas`, `con menos unidades`,
  - se genera ranking ascendente con etiqueta `Bottom N`,
  - por defecto se excluyen blancos, nulos, importes 0, unidades 0 y valores negativos para evitar productos sin movimiento o devoluciones distorsionando el ranking.
- DAX controlado:
  - Bottom N usa `FILTER(SUMMARIZECOLUMNS(...), NOT ISBLANK([Metrica]) && [Metrica] > 0)` antes de `TOPN(... ASC)`,
  - series mensuales ordenan por `MonthStart` ascendente y no por texto de mes ni orden de llegada.
- Comparativas:
  - el resumen natural pasa a redacciones como `He comparado ventas de 2025 contra 2024`,
  - las filas muestran periodos legibles `2025` y `2024`, no fechas tecnicas.
- UI:
  - la interpretacion semantica muestra orden de ranking ascendente/descendente.
- Router Power BI:
  - se enrutan expresiones de `bottom`, `peores`, `productos menos vendidos`, `clientes con menos ventas` y variantes con numeros escritos.

### Validacion real

- Validado contra el modulo Power BI existente con `previewStatus=200`, `executeStatus=200` y `executeOk=true`.
- Casos principales:
  - `las dos variedades mas vendidas en 2024` -> `Top 2`, `articulos[nombre]`, 2 filas, orden descendente por ventas.
  - `productos menos vendidos en 2025` -> `Bottom 10`, `articulos[nombre]`, ventas positivas mas bajas, sin nulos ni ceros.
  - `los cinco productos menos vendidos en 2025` -> `Bottom 5`, 5 filas, orden ascendente.
  - `clientes con menos ventas este ano` -> `Bottom 10`, `clientes[nombre]`, ventas positivas mas bajas.
  - `paises con menos unidades en 2025` -> `Bottom 10`, `clientes[pais]`, metrica unidades.
  - `ventas por mes en 2025` -> 12 meses ordenados de enero a diciembre mediante `MonthStart`.
  - `comparar ventas 2025 contra 2024` -> periodos `2025` y `2024`, diferencia absoluta y porcentual.
- Regresion comprobada:
  - `producto mas vendido en 2025`,
  - `nombre de variedad mas vendido en abril de 2025`,
  - `top 10 clientes por ventas en 2025`,
  - `ventas por pais en 2025`,
  - `unidades por pais en 2025`,
  - `ventas por cliente`,
  - `cuanto hemos vendido este ano`,
  - `cuanto se vendio en enero`,
  - `ventas por articulo`.

### Validacion tecnica

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Validacion ejecutada contra el servicio real `127.0.0.1:3010` tras reinicio.
- Logs revisados desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - `POWERBI_CLIENT_SECRET`,
  - `access_token`,
  - `Authorization`,
  - `Bearer`,
  - `tokens`,
  - `connection strings`,
  - `SQLITE_ERROR`,
  - errores de Comunicaciones.

## 2026-05-28 10:58 CEST - infra-agent-web v0.19.5 Power BI diccionario funcional del informe

### Objetivo

- Mejorar el interprete Power BI existente usando el diccionario funcional detectado en el informe.
- Reutilizar sin duplicar:
  - `powerbiNlqInterpreter`,
  - `powerbiDaxLab`,
  - `powerbiChatRouter`,
  - `powerbiVoiceRouter`,
  - Ask Lab / DAX Lab,
  - endpoints `ask/preview` y `ask/execute`,
  - `PowerBiChatResultView`.
- No se tocan Comunicaciones, email, Microsoft Graph, Zabbix, SharePoint, MCPs ni permisos Power BI.

### Diccionario funcional incorporado

- Paginas logicas:
  - `PRODUCTOS €` / `PRODUCTOS UDS`,
  - `CLIENTES €` / `CLIENTES UNDS`,
  - `REPRESENTANTES €` / `REPRESENTANTES UDS`,
  - `PAISES €` / `PAISES UDS`.
- Jerarquia de producto:
  - `Especie -> Tipo -> Nombre`.
- Regla principal:
  - `producto`, `articulo`, `variedad`, `nombre de variedad`, `nombre de producto` y `referencia` priorizan `articulos[nombre]`.
  - `especie` solo usa especie cuando el usuario lo pide explicitamente.
  - `tipo` solo usa tipo cuando el usuario lo pide explicitamente.
- Metricas:
  - `ventas`, `vendido`, `importe`, `euros`, `facturacion` -> `ventas_eur`.
  - `unidades`, `cantidad`, `uds`, `piezas`, `kilos`, `kg` -> `unidades`.

### Correccion aplicada

- `powerbiNlqInterpreter`:
  - anade dimension `pais`,
  - normaliza paginas logicas del informe,
  - interpreta `variedad` como nombre de producto/articulo, no como especie,
  - detecta Top N desde `dos`, `cinco`, `principales`, `mejores`, `peores`,
  - detecta `que pais tiene mas ventas` y `que pais factura mas` como Top 1,
  - soporta comparativas `2025 contra 2024` y `entre 2024 y 2025`,
  - detecta filtros funcionales como `PIMIENTO`, `ALCACHOFA`, `HORTISEMILLAS`, `ES`, `Portugal`, `Espana`.
- `powerbiDaxLab`:
  - admite `pais` como dimension controlada,
  - resuelve `pais` con `clientes[pais]`,
  - usa columnas relacionadas para filtros de valor: `articulos[especie]`, `articulos[tipo]`, `clientes[pais]`, `clientes[nombre]`, `representantes[representante]`,
  - resume comparativas con valor actual, valor anterior, diferencia absoluta y diferencia porcentual.
- `powerbiBusinessDictionary`:
  - agrega dimension funcional `pais -> clientes[pais]` si existe en el catalogo.
- `PowerBiChatResultView` / Ask Lab:
  - muestra pagina logica sugerida en la interpretacion semantica.
- `powerbiCapabilities` y `powerbiChatRouter`:
  - exponen paises y paginas logicas en ayuda, ejemplos y routing.

### Validacion real

- Ejecutado contra el servicio real `127.0.0.1:3010` tras reinicio.
- Todas las consultas devolvieron `previewStatus=200`, `executeStatus=200`, `executeOk=true`, sin 400 ni `fetch failed`.
- Productos:
  - `producto mas vendido en 2025` -> Top 1, `articulos[nombre]`, pagina `PRODUCTOS €`.
  - `nombre de variedad mas vendido en abril de 2025` -> Top 1, `articulos[nombre]`, abril 2025.
  - `las dos variedades mas vendidas en 2024` -> Top 2, `articulos[nombre]`.
  - `ventas por especie en 2025` -> `articulos[especie]`.
  - `unidades por especie en 2026` -> `articulos[especie]`, metrica unidades.
- Clientes:
  - `top 10 clientes por ventas en 2025` -> `clientes[nombre]`, pagina `CLIENTES €`.
  - `top 10 clientes por unidades en 2025` -> `clientes[nombre]`, pagina `CLIENTES UNDS`.
  - `clientes que mas compraron PIMIENTO en 2025` -> filtro `articulos[especie] contains PIMIENTO` y ranking por cliente.
- Representantes:
  - `ventas por representante en 2025` -> `representantes[representante]`.
  - `top 5 representantes por unidades` -> Top 5, metrica unidades.
- Paises:
  - `ventas por pais en 2025` -> `clientes[pais]`, pagina `PAISES €`.
  - `unidades por pais en 2025` -> `clientes[pais]`, pagina `PAISES UDS`.
  - `que pais tiene mas ventas este ano` -> Top 1, `clientes[pais]`.
  - `que pais factura mas` -> Top 1, `clientes[pais]`.
  - `ventas de Portugal en 2025` -> filtro funcional `pais=PT`.
- Comparativas:
  - `comparar ventas 2025 contra 2024` -> valor 2025, valor 2024, diferencia absoluta y porcentaje.
  - `comparar unidades 2025 contra 2024` -> valor 2025, valor 2024, diferencia absoluta y porcentaje.
  - `ventas por mes en 2025` -> serie mensual con fecha principal `cabeceraFactura[fecha]`.

### Validacion tecnica

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - `POWERBI_CLIENT_SECRET`,
  - `access_token`,
  - `Authorization`,
  - `Bearer`,
  - `tokens`,
  - `connection strings`,
  - errores de Comunicaciones.

## 2026-05-28 09:50 CEST - infra-agent-web v0.19.4 hotfix Power BI dimensiones de negocio

### Objetivo

- Corregir la resolucion de dimensiones `variedad` / `especie` / `producto` / `familia` sin crear modulos ni rutas paralelas.
- Mantener el flujo existente:
  - `powerbiNlqInterpreter`,
  - `powerbiDaxLab`,
  - `powerbiChatRouter`,
  - `powerbiVoiceRouter`,
  - endpoints `ask/preview` y `ask/execute`,
  - `PowerBiChatResultView`.
- No se tocan Comunicaciones, Zabbix, SharePoint, Microsoft Graph ni permisos Power BI.

### Causa raiz

- El diccionario de negocio permitia dimensiones correctas a nivel logico, pero algunas apuntaban a columnas poco utiles:
  - `especie -> especies[codigoEspecie]`,
  - `tipo -> tipos[codigoTipo]`,
  - `articulo -> articulos[unidadVenta]`.
- Al agrupar por tablas desconectadas, Power BI devolvia el total global repetido en cada grupo.
- El resultado parecia un ranking valido, pero no filtraba ventas por la dimension elegida.

### Correccion aplicada

- `powerbiBusinessDictionary` prioriza columnas de visualizacion:
  - `nombre`,
  - `descripcion`,
  - `nombreEspecie`,
  - `nombreTipo`,
  - `nombreSeedTek`.
- Se penalizan columnas tecnicas:
  - `id`,
  - `codigo`,
  - `cod`,
  - `key`,
  - `fecha`,
  - `date`,
  - `numero`,
  - `orden`,
  - `index`.
- `powerbiDaxLab` crea candidatos reales de dimension y los valida con una muestra read-only antes de aceptar el ranking.
- Para `variedad`, el candidato validado es `articulos[nombre]`, porque esta relacionado con ventas y devuelve valores legibles.
- Si una dimension devuelve el mismo importe en todos los grupos, se bloquea con:
  - `type=dimension_validation_failed`,
  - mensaje claro de dimension desconectada.
- Se ordenan las filas de ranking en el backend por metrica para que Top N se vea en orden descendente.
- Se corrige el parser de Top N en lenguaje natural:
  - `las dos variedades mas vendidas` -> `Top 2`,
  - `producto mas vendido` -> `Top 1`,
  - `top 5 familias` -> `Top 5`.
- Preview muestra:
  - columna real usada para agrupar,
  - estado de validacion de dimension.

### Validacion real

- `que nombre de variedad se vendio mas en abril de 2025?`:
  - `intent=top_dimension_by_metric`,
  - `metric=ventas_eur`,
  - `dateRange=abril 2025`,
  - `ranking=Top 1`,
  - `dimensionField='articulos'[nombre]`,
  - fila legible: `CORERA`,
  - sin valores tipo `1/1/01, 0:00`.
- `las dos variedades mas vendidas en 2024?`:
  - `ranking=Top 2`,
  - `dimensionField='articulos'[nombre]`,
  - 2 filas,
  - ventas diferentes y ordenadas por importe.
- `producto mas vendido en 2026`:
  - usa `articulos[nombre]`,
  - columna legible,
  - ventas no repetidas artificialmente.
- `familia mas vendida este año`:
  - se bloquea como resultado no fiable,
  - motivo: `familias[nombre]` devuelve el total repetido y no parece relacionada con ventas.
- `ventas por especie en 2024`:
  - usa `articulos[especie]`,
  - valores legibles,
  - ventas no repetidas artificialmente.
- Regresion:
  - `ventas por cliente este año` sigue funcionando con `clientes[nombre]`.

### Validacion tecnica

- `rm -rf .next && npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos, tokens, `Authorization`, `Bearer` o connection strings.

## 2026-05-28 09:10 CEST - infra-agent-web v0.19.3 hotfix Power BI NLQ natural

### Objetivo

- Corregir regresiones del interprete semantico Power BI sin crear rutas ni modulos paralelos.
- Mantener la integracion existente:
  - `powerbiNlqInterpreter`,
  - `powerbiChatRouter`,
  - `powerbiVoiceRouter`,
  - Ask Lab / DAX Lab,
  - endpoints `ask/preview` y `ask/execute`,
  - `PowerBiChatResultView`.
- No se tocan Comunicaciones, Zabbix, SharePoint, Microsoft Graph ni permisos Power BI.

### Correccion aplicada

- Se añade normalizacion linguistica previa para preguntas sin tildes o con variantes verbales:
  - `vendio` / `vendió` -> `vendido`,
  - `se vendio` -> `se ha vendido`,
  - `cuanto se vendio` -> `cuanto se ha vendido`,
  - `cuanto hemos vendido` -> `cuanto se ha vendido`.
- Se mantiene el soporte de meses con año relativo:
  - `abril de este año`,
  - `en abril de este año`,
  - meses concretos del año actual.
- Se endurece el manejo de errores de Ask Lab para no mostrar `fetch failed` crudo al usuario.
- Se amplian los patrones de ranking por `mas vendido`:
  - `que X hemos vendido mas`,
  - `producto mas vendido`,
  - `familia mas vendida`,
  - `variedad mas vendida`,
  - variantes sin acentos.
- `variedad` y `clase` se resuelven como dimension equivalente `especie` cuando no existe una dimension formal `variedad` en el catalogo controlado.
- En rankings por `mas vendido`, la metrica por defecto vuelve a ser ventas/importe salvo que el usuario pida unidades explicitamente.
- El router de chat/voz se amplia para enrutar frases naturales como:
  - `cuanto se vendio en enero`,
  - `que variedad hemos vendido mas`.

### Validacion del interprete

- `cuanto se vendio en enero?`:
  - normaliza a `cuanto se ha vendido en enero`,
  - `intent=total_metric`,
  - `metric=ventas_eur`,
  - `dateRange=enero 2026`.
- `cuanto se ha vendido en abril de este año`:
  - `intent=total_metric`,
  - `metric=ventas_eur`,
  - `dateRange=abril 2026`.
- `que variedad hemos vendido mas en 2026?`:
  - `intent=top_dimension_by_metric`,
  - `metric=ventas_eur`,
  - `dimension=especie`,
  - `ranking=Top 1`,
  - aviso: `He interpretado variedad como especie.`
- `producto mas vendido en 2026`:
  - ranking por producto, no total generico.
- `familia mas vendida este año`:
  - ranking por familia con filtro de año actual.

### Validacion tecnica

- `rm -rf .next && npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Validacion real contra endpoints existentes:
  - `POST /api/powerbi/models/administracion_ventas/ask/preview` OK para enero, abril de este año y rankings.
  - `POST /api/powerbi/models/administracion_ventas/ask/execute` OK para los mismos casos.
  - `preview` y `execute` mantienen el mismo plan semantico.
- Logs revisados sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `fetch failed`,
  - secretos, tokens, `Authorization`, `Bearer` o connection strings.

## 2026-05-27 16:22 CEST - infra-agent-web v0.19.2 interprete semantico Power BI

### Objetivo

- Mejorar la inteligencia de consultas Power BI sobre el modelo semantico `administracion_ventas`.
- Reutilizar el motor existente:
  - `powerbiNlqInterpreter`,
  - `powerbiDaxLab`,
  - `powerbiChatRouter`,
  - `powerbiVoiceRouter`,
  - endpoints `ask/preview` y `ask/execute`,
  - `PowerBiChatResultView`.
- No se crea modulo paralelo ni rutas nuevas.

### Correccion aplicada

- `interpretPowerBiQuestion` pasa a devolver un plan semantico enriquecido:
  - `intent`,
  - `metric`,
  - `aggregation`,
  - `dimensions`,
  - `filters`,
  - `dateRange`,
  - `ranking`,
  - `comparison`,
  - `granularity`,
  - `ambiguity`,
  - `missingInfo`,
  - `confidence`.
- Se mantienen los campos historicos para compatibilidad:
  - `intent`,
  - `metric`,
  - `dimension`,
  - `timeRange`,
  - `topN`.
- Fechas relativas y compuestas soportadas:
  - `hoy`,
  - `ayer`,
  - `esta semana`,
  - `semana pasada`,
  - `este mes`,
  - `mes pasado`,
  - `este trimestre`,
  - `trimestre pasado`,
  - `este año`,
  - `año pasado`,
  - `últimos N días`,
  - `últimos N meses`,
  - meses concretos del año actual,
  - meses con año explicito,
  - rangos `de enero a marzo`,
  - trimestres ordinales,
  - años explicitos.
- La frase `cuánto hemos vendido este año en enero` se interpreta como:
  - metrica `ventas_eur`,
  - intent `total_metric`,
  - periodo `enero 2026`,
  - no como todo el año.
- Resolucion de metricas ampliada:
  - ventas, vendido, facturacion, importe, ingresos, euros vendidos,
  - unidades, cantidad, piezas, articulos vendidos.
- Resolucion de dimensiones ampliada:
  - cliente/comprador,
  - articulo/referencia/SKU,
  - producto,
  - familia/categoria/grupo,
  - representante/comercial/vendedor,
  - tipo,
  - especie.
- Rankings ampliados:
  - `top N`,
  - `mejores`,
  - `mas vendidos`,
  - `peores`,
  - `bottom N`,
  - orden ascendente/descendente segun corresponda.
- Comparativas basicas soportadas:
  - `ventas este mes vs mes pasado`,
  - `ventas este año vs año pasado`,
  - `comparar enero con febrero`.
- Filtros textuales seguros soportados para patrones como:
  - `ventas del cliente X`,
  - `ventas de la familia X`,
  - `ventas del representante X`.
- Si se pide una dimension no existente, por ejemplo `ventas por provincia`, la respuesta es HTTP 200 recuperable con mensaje claro y dimensiones disponibles.

### DAX controlado

- `powerbiDaxLab` consume el plan semantico:
  - `dateRange`,
  - `filters`,
  - `ranking`,
  - `comparison`,
  - `granularity`.
- Se mantiene DAX read-only generado internamente.
- Patrones cubiertos:
  - total con `CALCULATE`,
  - agrupacion por dimension con `SUMMARIZECOLUMNS`,
  - ranking con `TOPN`,
  - serie mensual/anual,
  - comparativa con `UNION` de periodos controlados.
- `ask/preview` devuelve:
  - plan semantico,
  - DAX,
  - fecha real usada del modelo (`cabeceraFactura[fecha]`),
  - validacion.
- `ask/execute` puede reutilizar el `daxLabPayload` de preview para evitar divergencia entre previsualizacion y ejecucion.

### UI

- Ask Lab muestra un bloque `Interpretacion semantica` con:
  - metrica,
  - periodo,
  - agrupacion,
  - resultado esperado,
  - ranking,
  - fecha usada,
  - comparacion o filtros si aplican.
- La vista principal Power BI tambien muestra esa interpretacion cuando existe.
- Las aclaraciones siguen devolviendo HTTP 200 recuperable, no 400 tecnico.

### Voz y chat

- `powerbiChatRouter` sigue siendo el router existente y se amplia para reconocer:
  - `ventas ...`,
  - `unidades ...`,
  - `mejores clientes`,
  - `productos mas vendidos`,
  - `peores/bottom`.
- `powerbiVoiceRouter` reutiliza el mismo router y añade respuesta breve para:
  - series anuales,
  - comparativas.
- La descripcion Realtime de `voice_powerbi_query` se actualiza con ejemplos de fechas, rankings y comparativas.

### Validacion realizada por API real

- `cuánto hemos vendido este año en enero`:
  - HTTP 200,
  - `intent=total_metric`,
  - `metric=ventas_eur`,
  - `dateRange=enero 2026`,
  - 1 fila.
- `cuánto hemos vendido este año`:
  - año completo 2026,
  - 1 fila.
- `ventas por cliente este año`:
  - tabla por cliente,
  - filtro año 2026.
- `top 10 clientes por ventas este año`:
  - ranking Top 10,
  - filtro año 2026.
- `cuántas unidades hemos vendido en enero`:
  - metrica `unidades`,
  - periodo enero 2026.
- `ventas por artículo en marzo`:
  - dimension `articulo`,
  - periodo marzo 2026.
- `ventas este mes vs mes pasado`:
  - `comparison_metric`,
  - 2 periodos.
- `ventas por provincia`:
  - HTTP 200,
  - `ok=false`,
  - `recoverable=true`,
  - mensaje de dimension no encontrada.
- Regresion OK:
  - `ventas por cliente`,
  - `ventas por artículo`,
  - `top 10 clientes por ventas`,
  - `top 10 artículos por ventas`,
  - `cuánto hemos vendido`,
  - `cuántas unidades hemos vendido`.

### Limites

- Validacion visual interactiva en navegador real pendiente en este entorno: no hay Playwright, Chromium, Firefox ni Chrome instalados.
- No se toca Comunicaciones, Microsoft Graph, Zabbix, SharePoint write paths ni permisos Power BI.

## 2026-05-27 15:56 CEST - infra-agent-web v0.19.1 hotfix Power BI Ask/Execute

### Causa

- La regresion venia del router `powerbiNlqInterpreter`: frases con fecha relativa como `este año` se clasificaban como filtro temporal no soportado.
- `ask/preview` y `ask/execute` devolvian HTTP 400 para una pregunta recuperable de negocio, provocando ruido repetido en consola.
- `powerbiCapabilities` seguia documentando `timeRange=all_time` como unica opcion, aunque el modelo ya tenia fecha de negocio por defecto:
  - tabla `cabeceraFactura`,
  - columna `fecha`.
- Los warnings TMDL de inventario (`cultures/es-ES.tmdl`, `database.tmdl`, `model.tmdl`) eran de calidad/catalogo y no debian bloquear preguntas basicas.

### Correccion aplicada

- Se reutiliza la integracion Power BI existente; no se crea modulo paralelo.
- `powerbiNlqInterpreter` ahora reconoce fechas relativas en español:
  - `este año`,
  - `este mes`,
  - `este trimestre`,
  - `ultimos 12 meses`,
  - `año pasado`,
  - `mes pasado`,
  - `hoy`,
  - `ayer`.
- `powerbiDaxLab` genera DAX controlado con filtro temporal sobre la fecha por defecto del diccionario de negocio.
- `ask/preview` y `ask/execute` devuelven HTTP 200 con `ok=false` y `recoverable=true` en aclaraciones recuperables, evitando 400 tecnicos para preguntas normales.
- La UI de Power BI muestra el error o aclaracion en el panel de resultado compartido, en lugar de quedarse en `Sin consulta ejecutada todavía`.
- Se añaden guardas de carga en Ask Lab para no lanzar preview/execute mientras ya hay una operacion Power BI en curso.
- `capabilities` se actualiza para documentar los rangos temporales soportados y ejemplos como:
  - `Cuánto hemos vendido este año`,
  - `Ventas este año`,
  - `Cuántas unidades hemos vendido este año`.
- La descripcion de la herramienta de voz Power BI se actualiza para incluir consultas con fechas relativas.

### Seguridad y limites

- No se toca Comunicaciones, Graph Mail.Send, Zabbix, SharePoint write paths ni permisos Entra ID.
- No se abre DAX libre ni DAX manual.
- Los logs nuevos son seguros: longitud de pregunta, intent, metrica, dimension, timeRange y estado de enrutado; no imprimen tokens ni respuestas extensas.
- Los warnings TMDL quedan como warnings de inventario/calidad y no bloquean Ask/Execute.

### Validacion realizada

- `POST /api/powerbi/models/administracion_ventas/ask/interpret` para `cuantas ventas ha habido este año?`:
  - HTTP 200,
  - `intent=total_metric`,
  - `metric=ventas_eur`,
  - `timeRange=current_year`.
- `POST /api/powerbi/models/administracion_ventas/ask/preview` para la misma pregunta:
  - HTTP 200,
  - `ok=true`,
  - DAX generado internamente.
- `POST /api/powerbi/models/administracion_ventas/ask/execute` OK para:
  - `cuantas ventas ha habido este año?`,
  - `cuánto hemos vendido este año`,
  - `ventas por cliente`,
  - `top 10 clientes por ventas`,
  - `cuantas unidades hemos vendido este año`,
  - `ventas por mes`,
  - `ventas este mes`,
  - `ventas este trimestre`,
  - `ventas últimos 12 meses`,
  - `ventas año pasado`,
  - `ventas mes pasado`,
  - `ventas hoy`,
  - `ventas ayer`.
- `ventas entre enero y marzo` devuelve HTTP 200 con `ok=false`, `recoverable=true` y mensaje controlado; no genera 400.
- `GET /api/powerbi/models/administracion_ventas/capabilities` muestra los rangos temporales soportados y mantiene los warnings TMDL como no bloqueantes.

## 2026-05-27 15:31 CEST - infra-agent-web v0.19.0 mejora incremental Power BI existente

### Inventario realizado

- Se reutiliza la integracion Power BI existente; no se crea arquitectura paralela.
- Archivos principales detectados:
  - `infra-agent-web/config/powerbi-models.json`,
  - `infra-agent-web/lib/powerbiAuth.js`,
  - `infra-agent-web/lib/powerbiClient.js`,
  - `infra-agent-web/lib/powerbiCatalog.js`,
  - `infra-agent-web/lib/powerbiDaxLab.js`,
  - `infra-agent-web/lib/powerbiNlqInterpreter.js`,
  - `infra-agent-web/lib/powerbiChatRouter.js`,
  - `infra-agent-web/lib/powerbiVoiceRouter.js`,
  - `infra-agent-web/lib/powerbiCapabilities.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`.
- Endpoints existentes reutilizados:
  - `GET /api/powerbi/status`,
  - `GET /api/powerbi/models`,
  - `GET /api/powerbi/models/:modelKey/status`,
  - `GET /api/powerbi/models/:modelKey/dataset`,
  - `GET /api/powerbi/models/:modelKey/reports`,
  - `GET /api/powerbi/models/:modelKey/schema`,
  - `GET/POST /api/powerbi/models/:modelKey/catalog*`,
  - `GET/POST /api/powerbi/models/:modelKey/business-dictionary*`,
  - `GET /api/powerbi/models/:modelKey/capabilities`,
  - `GET /api/powerbi/models/:modelKey/capabilities/examples`,
  - `POST /api/powerbi/models/:modelKey/ask/interpret`,
  - `POST /api/powerbi/models/:modelKey/ask/preview`,
  - `POST /api/powerbi/models/:modelKey/ask/execute`,
  - `GET/POST /api/powerbi/models/:modelKey/dax-lab/*`.
- Variables `.env` existentes detectadas sin exponer valores:
  - `POWERBI_ENABLED`,
  - `POWERBI_TENANT_ID`,
  - `POWERBI_CLIENT_ID`,
  - `POWERBI_CLIENT_SECRET`.
- Modelo avanzado vigente:
  - `administracion_ventas`.
- Capacidades vigentes:
  - metricas `ventas_eur`, `unidades`,
  - dimensiones `cliente`, `articulo`, `producto`, `familia`, `representante`, `tipo`, `especie`, `mes`,
  - intents `total_metric`, `metric_by_dimension`, `top_dimension_by_metric`, `metric_by_month`,
  - `timeRange=all_time`,
  - `topNMax=20`, `rowLimitMax=50`.

### Diagnostico funcional

- `GET /api/powerbi/status` OK:
  - Power BI habilitado,
  - configuracion OK,
  - token OK,
  - 5 modelos configurados y activos.
- `GET /api/powerbi/models` OK con 5 modelos.
- `GET /api/powerbi/models/administracion_ventas/capabilities` OK.
- `POST /api/powerbi/models/administracion_ventas/ask/execute`:
  - `Cuanto hemos vendido` OK, 1 fila, DAX generado internamente.
  - `Consulta ventas por cliente` OK, 10 filas devueltas, DAX generado internamente.
  - `Power BI: margen por cliente` rechazo seguro.
- La voz sigue usando `voice_powerbi_query` y `powerbiVoiceRouter`, que reutiliza `powerbiChatRouter` y capabilities.
- El chat general sigue pasando por `handlePowerBiChatMessage` y `powerbiChatRouter`.

### Mejoras aplicadas

- `powerbiChatRouter` deja de reducir el resultado a una muestra de 5 filas y conserva todas las filas devueltas por el endpoint limitado.
- El resultado estructurado Power BI conserva ahora:
  - `rowLimit`,
  - `rows`,
  - `columns`,
  - `dax`,
  - `daxLabPayload`,
  - `naturalSummary`,
  - `summary`.
- `PowerBiChatResultView` se mantiene como componente comun para texto y voz, y se mejora con:
  - tabla con scroll vertical/horizontal,
  - cabecera sticky,
  - valores con formato español,
  - nombres largos con wrap,
  - acciones `Copiar resultado`,
  - `Descargar CSV`,
  - `Ver/Ocultar DAX` sin mostrar DAX por defecto.
- Se añade un panel grande estable dentro de la vista Power BI:
  - zona de pregunta,
  - ejemplos rapidos,
  - resultado principal ampliado,
  - historial corto de consultas,
  - reapertura del resultado desde historial.
- Las ejecuciones desde Ask Lab actualizan tambien el resultado compartido usado por texto/voz.
- Las consultas Power BI detectadas desde chat general abren la vista Power BI y la pestaña local Power BI en lugar de dejar el resultado solo en el lateral.
- Los resultados Power BI por voz se añaden al historial corto y mantienen el resultado visible en el panel.

### Seguridad y no cambios

- No se toca Comunicaciones, Graph Mail.Send, Zabbix, SharePoint write paths, MCPs ni permisos Entra ID.
- No se abre DAX libre ni DAX manual.
- El DAX solo se muestra bajo accion explicita `Ver DAX`.
- No se imprimen tokens ni secretos.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/powerbi/status` OK tras reinicio.
- `POST /api/powerbi/models/administracion_ventas/ask/execute` OK para:
  - `Cuanto hemos vendido`,
  - `Consulta ventas por cliente`.
- `GET /` devuelve el bundle Next actualizado.
- `GET /api/communications/drafts` sigue respondiendo; no se modifica Comunicaciones.
- Logs desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`,
  - `SQLITE_ERROR`,
  - `POWERBI_CLIENT_SECRET`,
  - `GRAPH_CLIENT_SECRET`,
  - `access_token`,
  - `Authorization`,
  - `Bearer`,
  - `client_secret`,
  - `connection string`.

### Limitaciones pendientes

- Validacion visual interactiva pendiente en navegador real: el servidor no tiene Playwright, Chromium, Firefox ni Chrome instalados.
- Mantener `/communications` fuera de alcance de esta fase.

## 2026-05-27 13:58 CEST - infra-agent-web v0.18.1.27 eleccion por voz tras crear borrador

### Causa

- La voz ya podia crear borradores y resolver destinatarios, pero despues de crear un borrador no habia una decision conversacional guiada.
- Una orden como `envialo directamente` podia confundirse con una ruta de envio inmediato o con la apertura del panel, sin un estado claro entre:
  - revisar antes,
  - solicitar envio directo,
  - confirmacion final.

### Correccion aplicada

- Nuevo estado conversacional en voz:
  - `pendingVoiceDraftDecision`,
  - `pendingVoiceSendConfirmation`.
- Nueva herramienta Realtime:
  - `voice_communication_draft_decision`.
- Tras crear un borrador por voz, la respuesta hablada pasa a:
  - `Borrador #ID creado para {destinatario}. No se ha enviado todavia. Quieres enviarlo directamente o prefieres revisarlo antes?`
- Si el usuario elige revisar/editar/abrir/no enviar:
  - se mantiene Comunicaciones abierto,
  - no se envia nada,
  - se limpia la decision pendiente.
- Si el usuario elige enviar directamente:
  - se carga el borrador por ID,
  - se valida destinatario, dominio, asunto, cuerpo y no enviado,
  - se pide confirmacion verbal final.
- La confirmacion final exige una frase con `confirmo`; `si`, `vale` u `ok` no bastan.
- Nuevo endpoint para enviar un borrador existente:
  - `POST /api/communications/drafts/:id/direct-send`.
- La voz ya no usa `voice-draft` para enviar un draft existente; usa la ruta especifica de direct-send del borrador.
- En Comunicaciones se muestra un banner operativo con:
  - `Enviar directamente`,
  - `Revisar antes`,
  - y, si procede, `Confirmar envio directo` / `Cancelar`.
- La decision pendiente caduca a los 5 minutos.

### Seguridad mantenida

- No envia si falta `recipient_email`.
- No envia si el dominio no esta permitido.
- No envia si falta asunto o cuerpo.
- No envia si el borrador ya esta enviado.
- No envia sin `draft_id`.
- No envia sin confirmacion explicita con `confirmo`.
- No se toca Microsoft Graph `sendMail`; se reutiliza el flujo existente con prepare/send y auditoria.
- No se modifica Power BI, Zabbix ni SharePoint.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `POST /api/communications/voice-draft` simulando `envia directamente un correo para Fernando` con confirmacion diferida:
  - creo `draft_id=81`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`,
  - estado `draft`,
  - `send_status=not_sent`.
- `POST /api/communications/drafts/81/direct-send` sin `confirm_direct_send=true`:
  - devuelve `400`,
  - `confirm_direct_send debe ser true para enviar directamente`,
  - no envia.
- Borrador sin email `draft_id=82`:
  - `POST /api/communications/drafts/82/direct-send` con `confirm_direct_send=true` devuelve `400`,
  - `recipient_email es obligatorio para enviar correo`,
  - `send_status=not_sent`,
  - `sent_at=false`.
- No se ejecuto envio real durante la validacion tecnica para evitar mandar correo a Fernando sin una prueba interactiva confirmada por usuario.
- Logs desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`,
  - `POST /api/communications/draft-from-template`,
  - `SQLITE_ERROR`,
  - secretos/tokens/connection strings.

### Aceptacion visual final

- Confirmado visualmente:
  - la creacion de borradores por voz funciona,
  - la libreta corporativa resuelve correctamente el destinatario,
  - `recipient_name` y `recipient_email` se rellenan automaticamente,
  - Comunicaciones muestra destinatario, asunto y cuerpo,
  - si falta email, el envio queda bloqueado,
  - tras crear por voz se ofrece `Revisar antes` o `Enviar directamente`,
  - `Revisar antes` deja el borrador abierto sin enviar,
  - `Enviar directamente` pide confirmacion final antes del envio real,
  - no se envia nada sin confirmacion explicita,
  - se mantienen bloqueos por dominio, asunto, cuerpo y reenvio,
  - no aparece `draft-from-template` desde voz,
  - no aparecen errores de `allowedDomains`, `SQLITE_ERROR`, `ReferenceError` ni `TypeError`.
- v0.18.1.27 queda aceptada visualmente.

## 2026-05-27 13:35 CEST - infra-agent-web v0.18.1.26.2 propagacion obligatoria de contacto resuelto a borrador

### Causa

- La voz podia resolver correctamente un contacto de Libreta corporativa, incluyendo `displayName` y email, pero el cliente no reenviaba siempre `recipient_email` al endpoint de creacion del borrador.
- El endpoint `/api/communications/voice-draft` no aceptaba de forma canonica objetos ya resueltos como `resolvedRecipient`, `matchedContact`, `contact` o `person`.
- La insercion en SQLite normalizaba `recipient_label`, pero no aceptaba todos los aliases canónicos (`recipient_name`, `recipientEmail`, `toEmail`), lo que dejaba una ruta abierta a perder el contacto antes del insert.

### Correccion aplicada

- `VoiceAgentPanel` construye y envia `voiceResolvedRecipient` con:
  - `recipient_name`,
  - `recipient_email`,
  - `recipient_source`,
  - `recipient_confidence`.
- `/api/communications/voice-draft` canoniza el contacto recibido desde:
  - `resolvedRecipient`,
  - `matchedContact`,
  - `directoryRecipient`,
  - `contact`,
  - `person`,
  - aliases directos `recipient_name`/`recipient_email`.
- `resolveCommunicationRecipient()` acepta `resolvedRecipient`; si contiene email, lo devuelve como `directory_unique_match` y no aplica fallback generico.
- `reportsDb.normalizeCommunicationDraft()` acepta aliases de entrada:
  - `recipient_name`,
  - `recipientName`,
  - `recipientLabel`,
  - `toName`,
  - `recipientEmail`,
  - `toEmail`.
- Se mantiene `recipient_label` como columna SQLite historica, pero GET/listado exponen tambien `recipient_name`.
- Se anadio log seguro `voice_draft_final_recipient` antes de insertar, con dominio y flags de presencia, sin cuerpo del correo ni secretos.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Caso contacto ya resuelto por voz/libreta:
  - payload con `recipient_name=Fernando Martinez` y `recipient_email` presente,
  - creo `draft_id=77`,
  - respuesta `/api/communications/voice-draft` trae `recipient_name` y `recipient_email`,
  - GET `/api/communications/drafts/77` trae `recipient_name=Fernando Martinez` y `recipient_email` presente,
  - dominio `ramiroarnedo.com`.
- Caso frase con contenido:
  - `dile a Fernando que manana Moises trae el almuerzo`,
  - creo `draft_id=78`,
  - GET devuelve `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - cuerpo contiene `almuerzo`,
  - el destinatario no queda como texto de la tarea.
- Caso creador de incidencia:
  - `prepara email al creador` con incidencia `214`,
  - creo `draft_id=79`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - `source_incident_id=214`.
- Total de borradores paso de `75` a `78` durante la validacion final.
- Logs desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `POST /api/communications/draft-from-template`,
  - `SQLITE_ERROR`,
  - secretos/tokens/connection strings.

## 2026-05-27 13:20 CEST - infra-agent-web v0.18.1.26.1 propagacion estructurada de destinatario resuelto

### Causa

- La resolucion semantica ya podia detectar a Fernando para redactar el cuerpo del correo, pero no siempre propagaba ese contacto al contrato estructurado del borrador.
- En el flujo de voz Realtime, el destinatario podia llegar separado como `recipient_label`/`requestedRecipientName` y la transcripcion contener solo la tarea, por ejemplo `manana Moises traera el almuerzo`.
- Al no priorizar ese destinatario separado, el fallback generico podia sobrescribir el contacto resuelto con `Equipo interno` o con texto de la tarea.
- El GET/listado de borradores devolvia `recipient_label`, pero no siempre exponia `recipient_name`, lo que hacia que el panel dependiera de aliases inconsistentes.

### Correccion aplicada

- Se consolido el contrato de resolucion para devolver siempre:
  - `recipient_name`,
  - `recipient_email`,
  - `recipient_source`,
  - `recipient_confidence`,
  - `needs_clarification`,
  - `candidates`.
- `resolveCommunicationRecipient()` prioriza `requestedRecipientName` limpio antes de aplicar fallbacks genericos.
- El parser separa destinatario y contenido en frases tipo:
  - `dile a Fernando que manana Moises traera el almuerzo`,
  - `avisa a Fernando de que ...`.
- Si existe `recipient_email` resuelto, no se sobrescribe con:
  - `Equipo interno`,
  - texto libre de tarea,
  - valores por defecto de plantilla.
- `/api/communications/voice-draft` acepta y propaga `requestedRecipientName`, `recipient_label`, `recipient_query`, `toName` y aliases equivalentes.
- `VoiceAgentPanel` envia a `voice-draft` el destinatario separado cuando Realtime lo proporciona.
- `getCommunicationDraft()` y `listCommunicationDrafts()` decoran el resultado con `recipient_name = recipient_name || recipient_label`.
- Se anadieron logs seguros de creacion con:
  - `recipient_source`,
  - presencia de nombre/email,
  - dominio,
  - `source_incident_id`,
  sin imprimir cuerpo ni secretos.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo en `127.0.0.1:3010`.
- Voz/API `prepara correo para Fernando`:
  - creo `draft_id=66`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`,
  - `recipient_source=directory_unique_match`,
  - `recipient_confidence=0.95`.
- Voz/API `dile a Fernando que manana Moises traera el almuerzo`:
  - creo `draft_id=67`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - el cuerpo contiene el mensaje del almuerzo,
  - el destinatario no queda como texto de la tarea.
- Voz/API simulando Realtime con `requestedRecipientName=Fernando` y transcripcion `manana Moises traera el almuerzo`:
  - creo `draft_id=68`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - el cuerpo contiene el mensaje del almuerzo.
- Voz/API `prepara email al creador` con contexto de incidencia `214`:
  - creo `draft_id=69`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - `source_incident_id=214`,
  - `recipient_source=incident_creator`.
- Voz/API `prepara correo para PersonaInexistente`:
  - creo `draft_id=70`,
  - `recipient_name=PersonaInexistente`,
  - `recipient_email` vacio,
  - envio bloqueado por falta de email.
- Total de borradores paso de `64` a `69` durante la validacion.
- Logs desde el reinicio sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`,
  - `POST /api/communications/draft-from-template`,
  - `SQLITE_ERROR`,
  - secretos/tokens/connection strings.

## 2026-05-27 12:52 CEST - infra-agent-web v0.18.1.26 autorrelleno de destinatarios en Comunicaciones

### Causa

- El flujo de Comunicaciones ya bloqueaba correctamente el envio sin `recipient_email`, pero la resolucion/autorrelleno del destinatario seguia repartida entre voz, chat, creador de incidencia y plantillas.
- Algunos comandos de voz/chat terminaban creando borradores con nombre generico o sin email aunque la libreta corporativa o la incidencia tuvieran datos suficientes.
- `draft-from-incident` dependia demasiado de que el cliente enviara `recipient_email`; si solo llegaba `incident_id`, no resolvia el creador por lectura live.

### Correccion aplicada

- Nuevo helper servidor:
  - `infra-agent-web/lib/communicationRecipientResolver.js`.
- Prioridad de resolucion:
  - email explicito en la frase,
  - creador de incidencia con lectura live si falta informacion en contexto,
  - coincidencia unica en Libreta corporativa,
  - destinatario generico sin email.
- El helper devuelve:
  - `recipient_name`,
  - `recipient_email`,
  - `source`,
  - `confidence`,
  - `needs_clarification`,
  - `candidates`,
  - `source_incident_id`.
- Rutas conectadas al helper:
  - `/api/communications/voice-draft`,
  - `/api/communications/draft-from-incident`,
  - `/api/communications/direct-send-from-incident`,
  - `/api/ops/query` para creacion de borrador al creador,
  - chat textual visible para comandos de comunicacion antes de ChatKit.
- `draft-from-incident` puede resolver creador/email usando solo `incident_id`; si el email no existe, crea borrador de revision con email vacio y el envio queda bloqueado.
- Envio directo desde incidencia exige email resuelto antes de crear/enviar.
- El panel de revision muestra aviso de resolucion:
  - creador de incidencia,
  - libreta/email explicito,
  - falta email destinatario o creador.
- Se mantiene sin cambios el bloqueo de envio sin email, doble confirmacion, token y bloqueo de reenvio.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/send-config` devuelve:
  - `allowed_domains=["ramiroarnedo.com"]`,
  - `from_user_configured=true`.
- Voz/API `prepara email al creador` con `incidentId=214`:
  - creo `draft_id=45`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`,
  - `source_incident_id=214`.
- Voz/API `prepara correo para Fernando`:
  - creo `draft_id=46`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`.
- Voz/API `prepara correo para prueba@ramiroarnedo.com`:
  - creo `draft_id=47`,
  - `recipient_name=prueba`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`.
- Voz/API `prepara correo para PersonaInexistenteXYZ`:
  - creo `draft_id=48`,
  - `recipient_name=PersonaInexistenteXYZ`,
  - `recipient_email` vacio,
  - envio bloqueado.
- `prepare-send` sobre `draft_id=48` revisado devuelve:
  - `recipient_email es obligatorio para enviar correo`,
  - no envia nada.
- Voz/API `envia directamente correo a PersonaInexistenteXYZ`:
  - devuelve `400`,
  - no crea envio,
  - error seguro por falta de email.
- `POST /api/communications/draft-from-incident` solo con `incident_id=214`:
  - creo `draft_id=49`,
  - resolvio `Fernando Martinez`,
  - `recipient_email` presente,
  - `source_incident_id=214`.
- Chat/API `prepara email al creador de esta incidencia` con contexto `incidentId=214`:
  - creo `draft_id=50`,
  - `recipient_name=Fernando Martinez`,
  - `recipient_email` presente,
  - `source_incident_id=214`.
- Total de borradores paso de `43` a `48` durante las cinco creaciones verificadas.
- No se ejecuto envio directo real a Fernando para evitar mandar correo durante validacion tecnica.
- Logs recientes sin:
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`,
  - `POST /api/communications/draft-from-template` desde voz,
  - `SQLITE_ERROR`,
  - secretos/tokens/connection strings.

## 2026-05-27 12:22 CEST - infra-agent-web v0.18.1.25 estabilizacion Comunicaciones y destinatarios por voz

### Causa

- `CommunicationsView` usaba `allowedDomains` sin declararlo en su scope, provocando `ReferenceError: allowedDomains is not defined` al entrar en Comunicaciones.
- La configuracion de dominios permitidos no tenia un fallback estructurado en estado; si fallaba la carga, el panel podia quedarse sin datos seguros para validar envio.
- La resolucion de destinatario por voz concatenaba transcripcion y accion interna. Para frases como `prepara correo para Fernando`, el extractor capturaba texto tecnico adicional (`voice_prepare_communication_draft`) y no encontraba el contacto aunque la libreta corporativa lo tuviera.

### Correccion aplicada

- `CommunicationsView` recibe `allowedDomains` como prop con valor por defecto y deriva `safeAllowedDomains` antes de usarlo.
- Se sustituyo el estado suelto por configuracion defensiva:
  - `communicationSendConfig = { allowedDomains: [], hasFromUser: false }`.
- `loadCommunicationSendConfig()` ahora cae a `allowedDomains=[]` sin tumbar Comunicaciones si `/api/communications/send-config` falla.
- `getCommunicationSendReadiness(draft, { allowedDomains })` normaliza dominios internamente y muestra blocker claro:
  - `Falta email destinatario`,
  - `Dominio no permitido`,
  - `No se pudieron cargar dominios permitidos`,
  - `Falta preparacion de envio`.
- La voz separa transcripcion y accion interna al extraer destinatarios y filtra falsos destinatarios como `esta tarde`.
- La resolucion en libreta corporativa elige coincidencia unica por:
  - email/nombre exacto,
  - prefijo,
  - contenido unico,
  - fallback unico con email.
- Las respuestas de voz para borradores sin email ya indican que falta email antes de enviar.

### Validacion realizada

- `rm -rf .next && npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/send-config` devuelve:
  - `allowed_domains=["ramiroarnedo.com"]`,
  - `from_user_configured=true`.
- Libreta corporativa:
  - `GET /api/directory/search?q=Fernando` devuelve una coincidencia unica:
    - `Fernando Martinez`,
    - email con dominio `ramiroarnedo.com`.
- Voz/API `prepara correo para Fernando`:
  - creo `draft_id=41`,
  - `recipient_label=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`.
- Voz/API `prepara email al creador` con `incidentId=214`:
  - creo `draft_id=42`,
  - `source_incident_id=214`,
  - `recipient_label=Fernando Martinez`,
  - `recipient_email` presente,
  - dominio `ramiroarnedo.com`.
- Total de borradores paso de `39` a `41` durante las dos creaciones verificadas.
- Borrador generico sin email:
  - creo `draft_id=43`,
  - `recipient_email` ausente,
  - `prepare-send` devuelve `400` con `recipient_email es obligatorio para enviar correo`,
  - no envia nada.
- Logs recientes sin:
  - `ReferenceError: allowedDomains is not defined`,
  - `TypeError`,
  - `client-side exception`,
  - `POST /api/communications/draft-from-template` durante voz,
  - `SQLITE_ERROR`,
  - secretos/tokens/connection strings.

### Pendiente de comprobacion visual

- No hay navegador local ni Playwright instalado en el servidor para hacer Ctrl+F5 desde esta sesion.
- Debe verificarse en navegador real:
  - entrar en Comunicaciones sin `ReferenceError`,
  - abrir borrador sin email y ver `Falta email destinatario`,
  - guardar email permitido y ver `Dominio permitido OK`,
  - voz real `prepara correo para Fernando`,
  - voz real `prepara email al creador`.

## 2026-05-27 11:50 CEST - infra-agent-web v0.18.1.24 readiness de envio y UX de destinatario

### Causa

- Los borradores creados por voz podian existir sin `recipient_email` y aun asi el panel no guiaba claramente el bloqueo de envio.
- La UI calculaba el checklist, `Preparar envio`, `Confirmar y enviar` y envio directo con logicas separadas.
- `Confirmar y enviar` podia quedar visible como accion principal aunque no existiera token de confirmacion ni destinatario valido.
- El bloque de aprobacion ocupaba demasiado espacio y no explicaba que un borrador puede revisarse aunque siga bloqueado para envio por falta de email.

### Correccion aplicada

- Nuevo helper unico en cliente:
  - `getCommunicationSendReadiness(draft, { preparation, allowedDomains })`.
- El helper gobierna:
  - checklist visual,
  - `Preparar envio`,
  - `Confirmar y enviar`,
  - envio directo,
  - validaciones previas en handlers.
- Se carga configuracion segura con:
  - `GET /api/communications/send-config`,
  - devuelve solo `allowed_domains` y `from_user_configured`, sin secretos.
- Reglas aplicadas:
  - sin `recipient_email`: blocker `Falta email destinatario`,
  - sin dominio: `Sin dominio`,
  - dominio fuera de `EMAIL_ALLOWED_DOMAINS`: blocker `Dominio no permitido`,
  - sin asunto/cuerpo: blockers especificos,
  - sin `reviewed`: `Debe estar revisado`,
  - sin `confirmation_token`: `Falta preparacion de envio`,
  - enviado o enviando: bloqueado.
- `Confirmar y enviar` solo se activa si:
  - hay preparacion de envio para el mismo borrador,
  - el snapshot preparado coincide con email, asunto y cuerpo actuales,
  - existe `confirmation_token`,
  - el borrador no esta enviado.
- El panel compacta el paso de aprobacion:
  - mensaje claro si falta email,
  - mensaje claro si esta revisado pero bloqueado,
  - envio y checklist quedan juntos en la columna derecha.
- `recipient_email` se normaliza en cliente al guardar.
- `voice-draft` mejora destinatarios nombrados:
  - busca persona en libreta corporativa,
  - si hay una coincidencia unica con email, rellena destinatario,
  - si no hay email para envio directo, bloquea con error claro,
  - `Equipo interno` queda como borrador no enviable si no hay email configurado.
- Las instrucciones Realtime distinguen:
  - `envialo` ambiguo: no envio real,
  - `envia directamente` / `sin revisar`: flujo directo con validacion servidor.

### Validacion realizada

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/send-config` devuelve:
  - `allowed_domains=["ramiroarnedo.com"]`,
  - `from_user_configured=true`.
- Borrador por voz sin email:
  - `voice-draft` con `crear correo ejecutivo` creo `draft_id=36`,
  - `recipient_email=null`,
  - total paso de `34` a `35`.
- Email al creador por voz:
  - `voice-draft` con `prepara email al creador` y contexto `incidentId=214` creo `draft_id=37`,
  - `recipient_email` presente,
  - `source_incident_id=214`,
  - total paso de `35` a `36`.
- Borrador sin email revisado:
  - `draft_id=39`,
  - `prepare-send` devuelve `400` con `recipient_email es obligatorio para enviar correo`,
  - no envia nada.
- Borrador con email permitido:
  - `draft_id=36` actualizado con `fernando.martinez@ramiroarnedo.com`,
  - `prepare-send` genera preparacion y token,
  - no se ejecuto envio real.
- `send-email` sin token devuelve `400` con `confirmation_token es obligatorio`.
- Logs recientes sin:
  - `SQLITE_ERROR`,
  - `35 values`,
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`,
  - `GRAPH_CLIENT_SECRET`,
  - `POWERBI_CLIENT_SECRET`,
  - `access_token`,
  - `Authorization`,
  - `client_secret`,
  - `Bearer`,
  - `tokens`,
  - `connection strings`.

### Pendiente de aceptacion visual

- En navegador, confirmar:
  - borrador sin email muestra `Falta email destinatario`,
  - `Preparar envio` y `Confirmar y enviar` quedan deshabilitados,
  - al guardar email permitido se activa `Preparar envio`,
  - `Confirmar y enviar` solo se activa despues de `Preparar envio`.

## 2026-05-27 11:21 CEST - infra-agent-web v0.18.1.23 voice-draft unico y correccion INSERT SQLite

### Causa real

- La voz real seguia pudiendo entrar por el flujo local `voice_prepare_communication_draft`.
- Ese flujo generaba un evento generico de borrador que `InfraChatClient` convertia en llamada a `POST /api/communications/draft-from-template`.
- Aunque el servidor ya bloqueaba algunos casos, el navegador seguia mostrando el POST 400 porque el iniciador seguia existiendo en el bundle.
- El error `SQLITE_ERROR: 35 values for 37 columns` venia de `createCommunicationDraft()` en `lib/reportsDb.js`: el `INSERT INTO communication_drafts` listaba 37 columnas pero solo tenia 35 placeholders.

### Correccion aplicada

- Nuevo endpoint unico de voz:
  - `POST /api/communications/voice-draft`.
- La voz usa `voice-draft` para:
  - `prepara email al creador`,
  - borradores genericos de voz como `crear correo ejecutivo`,
  - envio directo explicito con `directSendRequested`.
- `VoiceAgentPanel.js`:
  - deja de despachar `infra-agent:communication-draft` para `voice_prepare_communication_draft`,
  - llama directamente a `/api/communications/voice-draft`,
  - para envio directo explicito tambien usa `voice-draft` y no plantillas cliente,
  - mantiene error controlado si no hay incidencia en contexto.
- `InfraChatClient.js`:
  - añade `fetchCommunicationJson(...)` como guardia cliente,
  - bloquea cualquier intento de `draft-from-template` con `source/action` de voz antes de hacer `fetch`,
  - mantiene `draft-from-template` solo para botones manuales no voz.
- `pages/api/communications/draft-from-template.js`:
  - devuelve `voice_must_use_voice_draft_endpoint` para cualquier payload marcado como voz.
- `lib/reportsDb.js`:
  - sustituye el `INSERT` manual por `insertCommunicationDraft(...)`,
  - genera columnas/placeholders/valores desde `COMMUNICATION_DRAFT_INSERT_COLUMNS`,
  - elimina la desalineacion 35/37.

### Validacion realizada

- `.next` eliminado y `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Guardia servidor:
  - `POST /api/communications/draft-from-template` con `source=voice` devuelve `409` y:
    - `error=voice_must_use_voice_draft_endpoint`,
    - `expected_endpoint=/api/communications/voice-draft`.
- Creacion generica por voz:
  - `POST /api/communications/voice-draft` con `crear correo ejecutivo` creo `draft_id=31`,
  - total paso de `29` a `30`.
- Creacion desde incidencia por voz:
  - `POST /api/communications/voice-draft` con `prepara email al creador` y contexto `incidentId=214` creo `draft_id=33`,
  - `source_incident_id=214`,
  - `recipient_email` presente,
  - total paso de `31` a `32`.
- Boton/manual de plantilla:
  - `POST /api/communications/draft-from-template` sin voz creo `draft_id=32`, confirmando que el flujo manual queda operativo tras corregir el `INSERT`.
- Envio directo sin contexto:
  - `POST /api/communications/voice-draft` con `envía directamente un correo al creador` sin contexto devuelve error controlado y no crea/envia.
- Creacion generica adicional por voz:
  - `draft_id=34`,
  - total paso de `32` a `33`.
- Logs recientes sin:
  - `SQLITE_ERROR`,
  - `35 values`,
  - `GRAPH_CLIENT_SECRET`,
  - `POWERBI_CLIENT_SECRET`,
  - `access_token`,
  - `Authorization`,
  - `client_secret`,
  - `Bearer`,
  - `tokens`,
  - `connection strings`,
  - `ReferenceError`,
  - `TypeError`,
  - `client-side exception`,
  - `conversation_already_has_active_response`.

### Pendiente de aceptacion visual

- Validacion real en navegador con Ctrl+F5 y DevTools Network:
  - `prepara email al creador` por voz debe mostrar `POST /api/communications/voice-draft`,
  - no debe aparecer `POST /api/communications/draft-from-template`,
  - el panel de Comunicaciones debe abrir el borrador nuevo,
  - el contador debe subir,
  - no debe aparecer `SQLITE_ERROR`.

## 2026-05-27 10:50 CEST - infra-agent-web v0.18.1.22 corte definitivo de draft-from-template en voz creador/incidencia

### Causa real

- La ruta real de voz podia seguir entrando en `VoiceAgentPanel.runInternalTool()` por `voice_prepare_communication_draft`.
- Si el payload no traia suficientes pistas (`source_type=incident`, `source_incident_id`, `prepare_creator_email`, etc.), caia en el flujo generico local y el dashboard terminaba llamando a `POST /api/communications/draft-from-template`.
- Ademas, `voice_ops_query` trataba primero cualquier frase de creador como preparacion de borrador, incluso frases de envio directo, en vez de dejar pasar esas frases al router operativo.

### Correccion aplicada

- `VoiceAgentPanel.js`:
  - amplia la deteccion de frases y payloads de `email/correo al creador`, `email/correo de esta incidencia`, `avisa al creador`, `manda/envia correo al creador` y variantes directas,
  - detecta `direct_send_creator_email`, `send_creator_email` y `communication_direct_send_request`,
  - enruta `voice_prepare_communication_draft` sospechoso de creador/incidencia hacia `draft-from-incident` o hacia el router operativo de envio directo,
  - elimina la busqueda automatica de "ultima incidencia" para `prepara email al creador` sin contexto: si no hay incidencia activa, no crea borrador,
  - evita declarar exito por voz si no hay `draft_id` verificable.
- `InfraChatClient.js`:
  - endurece el listener `infra-agent:communication-draft` para bloquear payloads de voz de creador/incidencia antes de llamar a plantillas,
  - añade metadatos `source`, `action`, `voice_intent` y `communication_action` al payload de plantilla para trazabilidad segura cuando el flujo sea realmente de plantilla.
- `pages/api/communications/draft-from-template.js`:
  - mantiene una barrera de servidor para devolver `invalid_route_for_incident_creator_email` si alguna ruta de voz/creador vuelve a intentar usar plantillas,
  - aplica la barrera antes de validar `template_id`, para detectar tambien payloads incompletos de voz.
- `lib/opsIntentRouter.js`:
  - propaga `action: communication_direct_sent` en envios directos para que el cliente pueda abrir el borrador enviado.

### Validacion tecnica

- `.next` limpiado y `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Prueba de guardia servidor:
  - `POST /api/communications/draft-from-template` con `source=voice_tool`, `action=prepare_creator_email`, `source_type=incident` devuelve:
    - `ok=false`,
    - `error=invalid_route_for_incident_creator_email`,
    - `expected_endpoint=/api/communications/draft-from-incident`.
- `/communications/drafts/21` devuelve `200`.
- Escaneo de logs reciente sin `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, `ReferenceError`, `TypeError`, `client-side exception` ni `conversation_already_has_active_response`.

### Pendiente de aceptacion visual

- Repetir en navegador con Ctrl+F5 y DevTools Network:
  - `prepara email al creador` por voz debe mostrar `draft-from-incident` y no `draft-from-template`,
  - `envia directamente un correo al creador` por voz debe mostrar `direct-send-from-incident` y no `draft-from-template`,
  - sin contexto no debe crear borrador ni llamar endpoints de creacion.

## 2026-05-27 10:05 CEST - infra-agent-web v0.18.1.21 voz de Comunicaciones sin draft-from-template para creador

### Causa

- La ruta de voz para comunicaciones seguia entrando por el listener de borradores genericos y acababa intentando `POST /api/communications/draft-from-template`.
- Para frases del tipo `prepara email al creador`, esa ruta es incorrecta: debe usar `draft-from-incident` o el helper persistente `createCommunicationDraftFromIncident(...)`.
- El resultado visible era un `400` en Network y una falsa sensacion de exito por voz.

### Correccion aplicada

- Se reforzo el routing de voz para que las intenciones:
  - `prepare_creator_email`,
  - `send_creator_email`,
  - `direct_send_creator_email`,
  - `email_to_incident_creator`
  no puedan caer en `draft-from-template`.
- `pages/api/realtime/session.js` ahora indica explicitamente que:
  - `prepara email al creador`,
  - `envía directamente un correo al creador`
  van por `voice_ops_query`, no por `voice_prepare_communication_draft`.
- `VoiceAgentPanel.js` añade metadatos de voz al evento de comunicaciones (`voice_intent`, `communication_action`) para trazar el routing.
- `InfraChatClient.js` intercepta los eventos de voz de comunicaciones:
  - si el caso es creador/incidencia, fuerza `createIncidentCreatorDraftAndNavigate(...)` o bloquea la ruta de plantilla como invalida,
  - si la ruta es invalida, deja registro seguro con `invalid_voice_route_for_incident_email`,
  - evita el 400 de `draft-from-template` en el flujo de voz del creador.
- La respuesta de voz ya no declara exito si no existe `draft_id` verificado.

### Ficheros modificados

- `infra-agent-web/components/InfraChatClient.js`
- `infra-agent-web/components/VoiceAgentPanel.js`
- `infra-agent-web/pages/api/realtime/session.js`
- `reports/CHANGELOG.md`

### Validacion tecnica

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.

### Seguridad

- No se imprimen secretos, tokens, cuerpos completos ni connection strings.
- No se toca Graph sendMail, Power BI, Zabbix ni SharePoint write paths.

## 2026-05-27 09:54 CEST - infra-agent-web v0.18.1.20 estados y acciones de Comunicaciones

### Causa

- Un borrador ya enviado seguia mostrando una mezcla de acciones de revision, aprobacion y envio que no correspondian a su estado.
- La UX permitia ver bloques grandes de aprobacion/envio incluso cuando el borrador ya estaba en `sent`, lo que confundia el flujo operativo.
- Habia riesgo de disparar acciones incorrectas de creacion/edicion sobre un borrador existente si la interfaz no distinguia bien entre crear, editar, aprobar y enviar.

### Solucion aplicada

- Se definio explicitamente el estado `sent` como modo solo lectura.
- Para borradores enviados se ocultan o deshabilitan:
  - Guardar cambios,
  - Marcar listo para revision,
  - Marcar revisado,
  - Preparar envio,
  - Confirmar y enviar,
  - Enviar directamente.
- Para borradores enviados se muestran solo:
  - Copiar asunto,
  - Copiar cuerpo,
  - Copiar todo,
  - Descargar Markdown,
  - Descargar HTML,
  - Duplicar borrador,
  - Abrir pagina dedicada,
  - Cerrar revision.
- Se redujo el bloque de aprobacion a una tarjeta compacta en los estados no enviados.
- El bloque de envio se ajusto para mostrar el mensaje de estado correcto segun `draft`, `ready_for_review`, `reviewed`, `prepared` o `sent`.
- Se evito que el flujo de edicion/aprobacion/envio toque `draft-from-template`; ese endpoint queda solo para crear borradores nuevos desde plantilla.

### Ficheros modificados

- `infra-agent-web/components/InfraChatClient.js`
- `infra-agent-web/styles/globals.css`
- `reports/CHANGELOG.md`

### Validacion tecnica

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.

### Seguridad

- El envio real sigue pasando por `prepare-send` + `confirm-send` + token + doble confirmacion.
- No se altera el bloqueo de reenvio.
- No se imprimen secretos, tokens, cuerpos completos ni connection strings.

## 2026-05-27 09:39 CEST - infra-agent-web v0.18.1.19 modo directo de envio en Comunicaciones

### Causa

- El flujo de Comunicaciones ya permitia revisar y enviar con seguridad, pero el modo alternativo de `Enviar directamente` no quedaba expuesto de forma clara y separada del flujo de revision.
- La importacion del helper de envio directo estaba cruzada entre modulos, lo que provocaba warnings de build y podia romper el envio directo si no se corregia.

### Solucion aplicada

- Se separaron de forma visible dos modos en el panel de revision:
  - `Modo 1 · Revisar borrador`
  - `Modo 2 · Enviar directamente`
- El modo directo se muestra en su propia tarjeta con advertencia explicita y confirmacion manual previa al envio real.
- Se elimino el boton directo duplicado de la barra superior para reducir ruido visual.
- Se corrijio `lib/communicationDirectSend.js` para importar:
  - `createCommunicationDraftFromIncident` desde `communicationDraftCreator`
  - `getCommunicationDraft`, `getCommunicationDraftSummary` y `updateCommunicationDraft` desde `reportsDb`
- Se limpio el estado de preparacion de envio cuando entra un flujo de envio directo, para no dejar una preparacion colgada tras el envio.
- El flujo de voz/chat sigue abriendo Comunicaciones con el borrador enviado directamente y mantiene el bloqueo de reenvio.

### Ficheros modificados

- `infra-agent-web/lib/communicationDirectSend.js`
- `infra-agent-web/components/InfraChatClient.js`
- `infra-agent-web/components/VoiceAgentPanel.js`
- `infra-agent-web/styles/globals.css`
- `reports/CHANGELOG.md`

### Validacion tecnica

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.

### Seguridad

- El envio directo sigue requiriendo confirmacion explicita.
- El flujo normal de revision mantiene la doble confirmacion.
- No se imprimen secretos, tokens, cuerpos completos ni connection strings.

## 2026-05-26 18:35 CEST - infra-agent-web v0.18.1.18 panel interno de revision/edicion de borradores

### Causa

- La pagina dedicada `/communications/drafts/:id` funcionaba como fallback, pero rompia la continuidad del dashboard y de la sesion voz/chat.
- El editor legacy de Comunicaciones sigue existiendo para creacion manual, pero no es fiable como vista principal de revision de borradores creados por el agente.
- El flujo aceptable requiere revisar y editar dentro de Comunicaciones sin depender del editor legacy, iframe, modal ni pagina dedicada como ruta principal.

### Solucion aplicada

- Se creo un panel interno independiente:
  - `CommunicationDraftReviewEditor`
- El panel depende solo de:
  - `draftId`,
  - `GET /api/communications/drafts/:id`,
  - `PATCH /api/communications/drafts/:id`,
  - endpoints existentes `prepare-send` y `send-email`.
- El panel muestra:
  - `Borrador #ID`,
  - estado,
  - tipo,
  - plantilla,
  - destinatario,
  - asunto,
  - fuente incidencia/informe,
  - fechas,
  - cuerpo Markdown editable,
  - cuerpo texto editable,
  - notas de revision,
  - aviso `No se ha enviado nada`.
- El panel permite:
  - editar destinatario/email, asunto, cuerpo Markdown, cuerpo texto y notas,
  - guardar cambios por `PATCH`,
  - copiar asunto/cuerpo/todo,
  - descargar Markdown/HTML si existe,
  - marcar listo para revision,
  - marcar revisado,
  - duplicar,
  - descartar,
  - abrir en pagina dedicada como fallback.
- El bloque de envio real se muestra en el panel interno, manteniendo las reglas existentes:
  - solo `type=email`,
  - requiere `status=reviewed`,
  - requiere destinatario, asunto y cuerpo,
  - `prepare-send` genera token,
  - `send-email` requiere confirmacion/token,
  - no se envia por voz,
  - no se salta la doble confirmacion.
- Los botones `Ver` y `Abrir borrador por ID` en Comunicaciones abren ahora el panel interno, no navegan fuera del dashboard.
- `/communications/drafts/:id` se mantiene como fallback.
- El enlace `Volver a Comunicaciones` de la pagina dedicada vuelve a:
  - `/?view=communications&draftId=ID`
- El dashboard soporta:
  - `/?view=communications&draftId=ID`
  - abre Comunicaciones y carga el panel interno.
- La voz/chat, al crear un borrador, ya no salen del dashboard:
  - se emite el evento `communication_draft_created`,
  - `InfraChatClient` abre Comunicaciones,
  - `CommunicationDraftReviewEditor` carga el borrador por ID.
- La respuesta de voz queda:
  - `Borrador #ID creado. Lo he abierto en Comunicaciones para revision. No se ha enviado nada.`

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /?view=communications&draftId=26` devuelve `200`.
- `GET /communications/drafts/26` devuelve `200` y el enlace de vuelta contiene `view=communications&draftId=26`.
- `GET /api/communications/drafts/26` devuelve:
  - `id = 26`,
  - `subject = Seguimiento de incidencia`,
  - `status = draft`,
  - `send_status = not_sent`,
  - `source_incident_id = 214`.
- `PATCH /api/communications/drafts/26` con el mismo asunto devuelve OK y no envia nada.
- `GET /api/communications/drafts` devuelve OK.
- Logs revisados sin `client-side exception`, `ReferenceError`, `TypeError`, `conversation_already_has_active_response`, `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni cuerpos extensos.

### Pendiente de aceptacion visual

- No hay navegador headless ni Playwright instalado en el servidor, por lo que queda pendiente validacion manual real:
  - voz crea nuevo borrador y abre panel interno sin salir del dashboard,
  - chat crea nuevo borrador y abre panel interno,
  - `Ver` abre el panel interno,
  - `Abrir por ID` abre el panel interno,
  - editar/guardar se ve en pantalla,
  - marcar revisado y preparar envio mantienen la doble confirmacion.

## 2026-05-26 17:27 CEST - infra-agent-web v0.18.1.17 hotfix Realtime voz email al creador

### Causa raiz real aislada

- La validacion por `/api/ops/query` no cubria el flujo real de voz Realtime.
- En Realtime, la frase `prepara email al creador` podia entrar por dos rutas:
  - `voice_ops_query`,
  - `voice_prepare_communication_draft`.
- La ruta `voice_prepare_communication_draft` era local y preparaba un payload visual, pero no garantizaba persistencia en SQLite ni devolvia `draft_id` navegable.
- Ademas, `summarizeForVoice(...)` descartaba `payload.draft`, por lo que el evento cliente `infra-agent:communication-draft` podia salir sin borrador util.
- Resultado: la voz podia confirmar semanticamente el borrador sin que existiera un nuevo `draft_id` persistido ni navegacion automatica.

### Solucion aplicada

- `VoiceAgentPanel` ahora fuerza la creacion persistente para email al creador en ambas rutas Realtime:
  - `voice_ops_query`,
  - `voice_prepare_communication_draft` cuando el payload corresponde a `seguimiento_incidencia`/incidencia/creador.
- Ambas rutas llaman a:
  - `POST /api/communications/draft-from-incident`
- Si Realtime elige `voice_prepare_communication_draft` sin pasar `source_incident_id`, el cliente intenta resolver primero la ultima incidencia live antes de crear el borrador.
- Tras el `INSERT`, el cliente verifica:
  - `GET /api/communications/drafts/:id`
- El resultado del tool de voz queda normalizado como:
  - `ok: true`,
  - `action: communication_draft_created`,
  - `draft_id`,
  - `view_url`,
  - `recipient_email`,
  - `subject`,
  - `status`,
  - `source_incident_id`.
- Al recibir `action=communication_draft_created` y `draft_id`, el cliente ejecuta navegacion dura:
  - `window.location.href = /communications/drafts/:draft_id`
- Se anadio evento defensivo:
  - `infra-agent:communication-draft-created`
  - `InfraChatClient` tambien navega a la pagina dedicada si recibe ese evento.
- Para evitar `conversation_already_has_active_response` en este flujo, si el tool ya creo borrador y arranco navegacion no se crea una segunda `response.create` Realtime.
- La sesion Realtime ahora instruye explicitamente que:
  - `prepara email al creador`,
  - `prepara un email al creador de esta incidencia`,
  - `prepara correo al creador`
  usen `voice_ops_query`.
- Tambien se acepta el intent estructurado `prepare_creator_email` si el modelo lo envia en argumentos del tool.
- Se mantienen trazas seguras de validacion en cliente con:
  - `voice_tool_name`,
  - `transcript_intent`,
  - `incident_id`,
  - `has_current_incident_context`,
  - `has_creator_email`,
  - `recipient_domain`,
  - `endpoint_called`,
  - `draft_insert_attempted`,
  - `draft_created`,
  - `draft_id`,
  - `view_url`,
  - `navigation_requested`.
- No se imprimen cuerpos de correo, tokens ni secretos.

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/voice/incidents-in-progress` devuelve `200` y no interfiere con Comunicaciones.
- `GET /communications/drafts/26` renderiza correctamente:
  - `Borrador #26`,
  - destinatario,
  - asunto,
  - `source_incident_id = 214`,
  - cuerpo Markdown/texto,
  - aviso `No se ha enviado nada`.
- `GET /api/communications/drafts` devuelve total `25`, ultimo `draft_id = 26`.
- Logs del servicio revisados sin `client-side exception`, `ReferenceError`, `TypeError`, `conversation_already_has_active_response`, `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni cuerpos extensos.

### Pendiente de aceptacion real

- No se ha creado un nuevo borrador desde voz real en navegador desde esta sesion de terminal.
- Criterio pendiente para aceptar:
  - decir por voz `prepara email al creador`,
  - comprobar que se crea un nuevo `draft_id`,
  - confirmar que el total sube,
  - confirmar navegacion automatica a `/communications/drafts/:nuevo_id`.

## 2026-05-26 17:10 CEST - infra-agent-web v0.18.1.16 creacion persistente de email al creador

### Causa raiz real

- El visor dedicado `/communications/drafts/:id` funcionaba, pero algunos flujos de chat/voz respondian semanticamente que el borrador estaba preparado sin garantizar un `INSERT` real previo en SQLite.
- En voz, el flujo `prepara email al creador` emitia un evento cliente con un payload y la respuesta hablada podia confirmar el borrador antes de que existiera un `draft_id` persistido.
- En rutas semanticas de operaciones, `prepare_creator_email` podia devolver una intencion visual sin crear borrador ni propagar `draft_id`.

### Solucion aplicada

- Se creo `infra-agent-web/lib/communicationDraftCreator.js` con una ruta unica de servidor:
  - `createCommunicationDraftFromIncident(...)`
- Se creo el endpoint:
  - `POST /api/communications/draft-from-incident`
- La funcion unica:
  - valida `source_incident_id`,
  - valida `recipient_email`,
  - aplica validacion de dominio permitido si `EMAIL_ALLOWED_DOMAINS` esta configurado,
  - inserta en SQLite,
  - verifica el borrador por ID con `getCommunicationDraft`,
  - devuelve `draft_id`, `draft`, `view_url`, destinatario, asunto, estado, `source_incident_id`, `total_before` y `total_after`,
  - no envia ningun email.
- Se conectaron a esta funcion:
  - chat textual con `prepara email al creador`,
  - voz `prepara email al creador`,
  - boton `Email al creador`,
  - `POST /api/ops/query` cuando la intencion semantica es `prepare_creator_email`.
- El cliente mantiene navegacion dura:
  - `window.location.href = /communications/drafts/:draft_id`
- Se ampliaron las detecciones para aceptar tambien `correo al creador`, no solo `email al creador`.
- Las trazas seguras registran solo:
  - action,
  - incident_id,
  - has_creator_email,
  - recipient_domain,
  - draft_created,
  - draft_id,
  - total_before/total_after,
  - error seguro si falla.
- No se imprimen cuerpos de correo ni tokens.

### Validacion real

- Total de borradores antes de la prueba directa: `23`.
- `POST /api/communications/draft-from-incident` con incidencia `214` y creador Fernando Martinez:
  - creo `draft_id = 25`,
  - `recipient_email = fernando.martinez@ramiroarnedo.com`,
  - `source_incident_id = 214`,
  - `subject = Seguimiento de incidencia`,
  - `status = draft`,
  - `view_url = /communications/drafts/25`,
  - `total_before = 23`,
  - `total_after = 24`.
- `GET /api/communications/drafts/25` OK.
- `GET /communications/drafts/25` renderiza:
  - `Borrador #25`,
  - destinatario,
  - asunto,
  - `source_incident_id = 214`,
  - cuerpo Markdown/texto,
  - aviso `No se ha enviado nada`,
  - acciones seguras.
- `POST /api/ops/query` simulando chat con contexto de incidencia `214`:
  - creo `draft_id = 26`,
  - `view_url = /communications/drafts/26`,
  - `total_before = 24`,
  - `total_after = 25`,
  - devuelve `spokenResponse = Borrador #26 creado. No se ha enviado nada. Abriendo la revisión del borrador.`
- `GET /communications/drafts/26` renderiza el borrador completo.

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/voice/incidents-in-progress` sigue devolviendo `200` con fallback seguro.
- Logs revisados sin `client-side exception`, `ReferenceError`, `TypeError`, `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni cuerpos extensos.
- Validacion visual interactiva de navegacion automatica pendiente de navegador real: no hay Playwright ni navegador headless instalado en el servidor.

## 2026-05-26 16:55 CEST - infra-agent-web v0.18.1.15 navegacion dura tras crear borradores

### Causa raiz

- La pagina dedicada `/communications/drafts/:id` funcionaba correctamente, pero el flujo de creacion desde chat/voz no forzaba una navegacion real despues de recibir el `draft_id`.
- La navegacion basada en estado React o `router.push` no era suficientemente fiable en los eventos de voz/chat y el usuario podia quedarse en la pantalla anterior sin ver el borrador.
- El error `favicon.ico 404` no esta relacionado y no se investigo en este hotfix.

### Solucion aplicada

- Tras crear un borrador, el cliente ahora:
  - obtiene `draft_id`,
  - valida el borrador con `GET /api/communications/drafts/:id`,
  - calcula `view_url = /communications/drafts/:id`,
  - ejecuta navegacion directa con `window.location.href = view_url`.
- Se anadio traza segura antes de navegar:
  - `console.debug("[communications] navigating to draft", { draftId, url })`
  - no imprime asunto, cuerpo ni datos sensibles.
- Las APIs de borradores devuelven ahora de forma explicita:
  - `ok`,
  - `draft_id`,
  - `draft`,
  - `view_url`.
- Se cubren los flujos centralizados:
  - chat textual,
  - voz via `infra-agent:communication-draft`,
  - boton `Email al creador`,
  - creacion desde payload,
  - creacion desde plantilla.
- Si no hay `draft_id`, el flujo falla con mensaje claro y no afirma que el borrador este visible.

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/24` devuelve:
  - `ok = true`,
  - `draft_id = 24`,
  - `view_url = /communications/drafts/24`.
- `GET /communications/drafts/24` renderiza el borrador completo con destinatario, asunto, `source_incident_id`, cuerpo y aviso `No se ha enviado nada`.
- `GET /api/voice/incidents-in-progress` sigue devolviendo `200` con fallback seguro.
- Logs revisados sin `client-side exception`, `ReferenceError`, `TypeError`, `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni cuerpos extensos.
- Validacion visual interactiva pendiente de navegador real: no hay Playwright ni navegador headless instalado en el servidor.

## 2026-05-26 16:27 CEST - infra-agent-web v0.18.1.14 visor dedicado como flujo principal de borradores

### Causa raiz

- La pantalla Comunicaciones y su editor legacy no eran fiables como visor integrado de borradores creados por el agente.
- `GET /api/communications/drafts/:id` funcionaba y `/communications/drafts/:id` mostraba el borrador, pero el panel integrado en `/?view=communications&draftId=ID` no aparecia de forma consistente.
- El estado de Comunicaciones seguia demasiado acoplado a rutas legacy como editor, filtros, paneles embebidos y estado de seleccion.

### Decision final

- `/communications/drafts/:id` pasa a ser la vista principal de revision de borradores.
- La pestaña Comunicaciones deja de intentar embeber el borrador creado o abierto.
- El editor legacy queda solo para creacion manual.

### Cambios aplicados

- En la lista de borradores, `Ver` ahora es un enlace real a:
  - `/communications/drafts/:id`
- `Abrir borrador por ID` navega directamente a:
  - `/communications/drafts/ID`
- La creacion desde chat/voz:
  - crea el borrador,
  - obtiene `draft_id`,
  - valida con `GET /api/communications/drafts/:id`,
  - refresca la lista,
  - navega automaticamente a `/communications/drafts/:id`,
  - devuelve mensaje con `draft_id`, destinatario, asunto, estado, ruta y `No se ha enviado nada`.
- La pagina dedicada muestra:
  - ID,
  - estado,
  - tipo,
  - plantilla,
  - destinatario,
  - asunto,
  - fuente incidencia ID,
  - fuente informe ID,
  - fecha de creacion,
  - fecha de actualizacion,
  - cuerpo Markdown,
  - cuerpo texto,
  - cuerpo HTML si existe,
  - aviso `No se ha enviado nada`.
- Acciones seguras mantenidas en la pagina dedicada:
  - copiar asunto,
  - copiar cuerpo,
  - copiar todo,
  - descargar Markdown,
  - descargar HTML si existe,
  - marcar listo para revision,
  - marcar revisado,
  - volver a Comunicaciones.
- No se anadio envio directo nuevo ni se modifico `prepare-send/send-email`.
- El endpoint `/api/voice/incidents-in-progress` se aislo frente a timeouts de IncidenciasTI live:
  - ya no devuelve `500` por timeout del MCP,
  - responde `200` con `missing_data` y mensaje de fallback,
  - no interfiere con la preparacion de borradores.

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/24` OK.
- `GET /communications/drafts/24` OK y renderiza:
  - `Borrador #24`,
  - `fernando.martinez@ramiroarnedo.com`,
  - `source_incident_id = 214`,
  - `Asunto: Seguimiento de incidencia`,
  - cuerpos Markdown/texto,
  - `No se ha enviado nada`,
  - acciones de revision/copiar/descarga.
- `GET /api/voice/incidents-in-progress` devuelve `200` con fallback seguro en vez de `500`.
- Logs revisados sin `client-side exception`, `ReferenceError`, `TypeError`, `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni cuerpos extensos.
- Validacion visual interactiva pendiente de navegador real: el servidor no tiene Playwright ni navegador headless instalado.

## 2026-05-26 16:03 CEST - infra-agent-web v0.18.1.13 panel de revision independiente para borradores

### Causa raiz

- El editor legacy de Comunicaciones estaba desacoplado del borrador creado o abierto.
- La API y la ruta dedicada funcionaban, pero la pantalla principal no tenia una ruta estable para mostrar el contenido del borrador dentro de Comunicaciones.
- Los intentos anteriores dependian de modal, iframe, estado legacy u otros estados de apertura que no siempre se renderizaban en la vista visible.

### Solucion aplicada

- Se creo `CommunicationDraftReviewPanel`, un panel independiente dentro de Comunicaciones.
- El panel depende solo de:
  - `reviewDraftId`,
  - `GET /api/communications/drafts/:id`,
  - `reviewDraft`, `reviewDraftLoading` y `reviewDraftError`.
- `Ver` en la lista de borradores ya no intenta rellenar el editor legacy: establece `reviewDraftId` y carga el panel superior.
- `Abrir borrador por ID` usa el mismo flujo de revision por ID y mantiene el boton habilitado salvo durante carga.
- La creacion desde chat/voz valida el borrador por `GET /api/communications/drafts/:id` antes de anunciar que queda abierto para revision.
- Se anadio soporte para abrir directamente:
  - `/?view=communications&draftId=ID`
  - al cargar esa URL, se activa Comunicaciones y se carga el panel de revision del borrador.
- La ruta dedicada `/communications/drafts/:id` se mantiene como fallback y ahora carga el borrador en SSR por lectura directa read-only de SQLite, evitando el fallo de `fetch` HTTPS interno.
- El editor legacy queda solo para creacion manual y ya no es la via principal para revisar borradores creados por el agente.
- Se eliminaron de la vista los diagnosticos temporales que confundian al usuario: modo de editor, campos presentes y estados legacy.

### Panel de revision

- Muestra:
  - Borrador `#ID`,
  - estado,
  - tipo,
  - plantilla,
  - destinatario,
  - asunto,
  - fuente de incidencia,
  - fuente de informe,
  - fechas de creacion y actualizacion,
  - cuerpo Markdown,
  - cuerpo texto,
  - aviso `No se ha enviado nada`.
- Acciones seguras disponibles:
  - copiar asunto,
  - copiar cuerpo,
  - copiar todo,
  - descargar Markdown,
  - descargar HTML si existe,
  - marcar listo para revision,
  - marcar revisado,
  - abrir en pestana nueva,
  - cerrar panel.
- No se anadio envio directo ni se modifico `prepare-send/send-email`.

### Validacion tecnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/24` OK:
  - `recipient_email = fernando.martinez@ramiroarnedo.com`,
  - `source_incident_id = 214`,
  - `subject = Seguimiento de incidencia`,
  - `status = draft`.
- `GET /communications/drafts/24` OK y renderiza el contenido del borrador desde SSR.
- `GET /?view=communications&draftId=24` OK como entrada cliente para activar Comunicaciones y cargar el panel por `reviewDraftId`.
- Logs revisados sin `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, `ReferenceError` ni `TypeError`.
- Validacion visual interactiva pendiente de navegador real: el servidor no tiene Playwright ni navegador headless instalado.

## 2026-05-26 15:42 CEST - infra-agent-web v0.18.1.12 hotfix de contención para Comunicaciones

### Causa raíz

- La pestaña Comunicaciones introdujo un visor embebido/inline que terminó rompiendo el render cliente.
- El resultado era un `client-side exception` al entrar en la vista, bloqueando toda la pantalla.

### Solución aplicada

- Se añadió un boundary local para Comunicaciones:
  - `CommunicationsPanelBoundary`
  - si algún subcomponente falla, la app muestra un mensaje local y no cae toda la interfaz.
- Se desactivó temporalmente el visor embebido/iframe dentro de Comunicaciones.
- Se mantuvo únicamente la ruta directa y los enlaces HTML normales:
  - `/communications/drafts/[id]`
  - `Abrir en nueva pestaña`
- `Ver` y `Abrir por ID` quedaron reducidos a un flujo seguro con la URL directa, sin intentar montar el visor embebido.
- Comunicaciones vuelve a cargar de forma estable y el editor legacy queda intacto para borrador manual.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /communications/drafts/21` sigue funcionando como fallback directo.
- Logs revisados sin secretos, tokens, connection strings, `ReferenceError`, `TypeError` ni errores Realtime.

## 2026-05-26 15:35 CEST - infra-agent-web v0.18.1.11 visor inline garantizado para Comunicaciones

### Causa raíz

- El estado del visor se actualizaba y la ruta dedicada seguía siendo válida, pero el modal/iframe no quedaba visible dentro de la pantalla legacy.
- El usuario veía mensajes de apertura, pero no un panel real con el borrador.
- La creación del borrador no quedaba validada por `GET /api/communications/drafts/:id` antes de anunciarse como visible.

### Solución aplicada

- Se sustituyó el enfoque modal por un visor inline permanente dentro de Comunicaciones.
- El panel inline carga directamente el visor dedicado mediante `iframe` apuntando a `/communications/drafts/:id`.
- Si el iframe no carga, el mismo panel mantiene el resumen del borrador cargado por API.
- La apertura por `Ver` y `Abrir borrador por ID` usan el mismo flujo de carga y muestran el panel inline.
- La creación desde chat/voz:
  - devuelve `draft_id`,
  - valida con `GET /api/communications/drafts/:id`,
  - actualiza el panel inline,
  - refresca la lista,
  - y solo entonces informa de que el borrador está creado y abierto.
- Se añadieron diagnósticos visibles:
  - último draft creado por agente,
  - último draft abierto en visor,
  - estado de GET por ID,
  - totales antes/después de crear,
  - última carga de borradores.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /communications/drafts/21` sigue funcionando como fallback directo.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 15:10 CEST - infra-agent-web v0.18.1.10 visor embebido automático para borradores de Comunicaciones

### Causa raíz

- El visor dedicado por URL funcionaba, pero obligaba al usuario a abrir `/communications/drafts/:id` manualmente.
- El estado y el editor legacy de Comunicaciones seguían desacoplados del flujo visual que el usuario esperaba.
- `Ver` y `Abrir por ID` no abrían una vista garantizada dentro de la app.

### Solución aplicada

- Se añadió un visor embebido automático en Comunicaciones, basado en el visor dedicado ya validado:
  - `CommunicationDraftEmbeddedViewerModal`
  - `iframe` apuntando a `/communications/drafts/:id`
  - aislado del editor legacy roto
  - con cierre, enlace para abrir en pestaña nueva y carga automática.
- `Ver` en cada borrador abre el visor embebido.
- `Abrir borrador por ID` abre el visor embebido sin depender del editor manual.
- Al crear un borrador desde chat o voz, la UI abre el visor embebido automáticamente con `draft_id`.
- Se mantiene el enlace directo `/communications/drafts/:id` como fallback y para revisión manual.
- La lista de borradores ahora ofrece además un acceso explícito a abrir en una pestaña nueva.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /communications/drafts/21` sigue funcionando como fallback directo.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 14:34 CEST - infra-agent-web v0.18.1.9 visor dedicado por URL para borradores de Comunicaciones

### Causa raíz

- La pantalla legacy de Comunicaciones seguía sin reflejar de forma fiable el borrador abierto aunque la API y la persistencia funcionaran.
- El editor y el bloque de borrador abierto dependían del mismo estado roto de la jerarquía legacy.
- El usuario no podía ver el contenido del borrador por una vía garantizada.

### Solución aplicada

- Se creó una ruta dedicada:
  - `/communications/drafts/[draftId]`
- La página carga directamente `GET /api/communications/drafts/:id`.
- La lista de borradores y el formulario `Abrir por ID` navegan al visor dedicado.
- El botón `Ver` de cada borrador navega al visor dedicado.
- La respuesta de creación de borrador incluye:
  - `draft_id`,
  - destinatario,
  - asunto,
  - estado,
  - enlace visible al visor.
- La página dedicada muestra:
  - ID,
  - estado,
  - tipo,
  - plantilla,
  - destinatario,
  - asunto,
  - fuente incidencia,
  - fuente informe,
  - fechas,
  - cuerpo Markdown,
  - cuerpo texto,
  - HTML opcional,
  - aviso de que no se ha enviado nada.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/21` devuelve el borrador esperado.
- La nueva ruta `/communications/drafts/21` queda disponible para revisión directa.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 14:05 CEST - infra-agent-web v0.18.1.8 visor independiente por draft_id para Comunicaciones

### Causa raíz

- El editor legacy de Comunicaciones seguía desacoplado del borrador real abierto por `draft_id`.
- El formulario visible podía permanecer en `Nuevo borrador` aunque el borrador existiera por API y en lista.
- La única forma fiable de ver el contenido era depender de un estado heredado que no reflejaba la apertura real.

### Solución aplicada

- Se añadió un visor/modal independiente de borrador:
  - `CommunicationDraftViewerModal`
  - alimentado directamente por `GET /api/communications/drafts/:id`
  - sin depender del editor legacy.
- `Abrir por ID` y `Ver` cargan el borrador por ID y abren el visor garantizado.
- Al crear un borrador desde chat/voz, la UI ahora abre el visor por `draft_id`.
- Se mantiene el editor manual para creación/edición legacy, pero deja de ser la única vía de visualización.
- Se añadió un bloque persistente de “Último borrador abierto” y un modal global con:
  - ID,
  - estado,
  - tipo,
  - plantilla,
  - destinatario,
  - asunto,
  - fuente incidencia ID,
  - fechas,
  - cuerpo markdown/texto,
  - opción de ver HTML,
  - aviso explícito de que no se ha enviado nada.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/21` devuelve el borrador esperado.
- `GET /api/communications/drafts/23` devuelve el borrador nuevo creado desde la incidencia 214.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 13:43 CEST - infra-agent-web v0.18.1.7 formulario real por ID y editor único para borradores de Comunicaciones

### Causa raíz

- El input visible de apertura por ID y el editor visible no estaban conectados de forma fiable al mismo flujo.
- La UI dependía de estado intermedio roto para decidir si podía abrir un borrador y para pintar el formulario.
- Los contadores mostraban total global y visibles con etiquetas invertidas, generando confusión.

### Solución aplicada

- Se sustituyó la apertura por ID por un formulario real:
  - `onSubmit`
  - `FormData`
  - `openCommunicationDraftById(id)` como ruta única
- El botón `Abrir por ID` solo depende de `loading`, no del estado anterior del input.
- `Ver` en cada tarjeta usa exactamente la misma ruta que `Abrir por ID`.
- Se reforzó la apertura con trazas seguras:
  - petición de apertura
  - carga del borrador
  - población del editor
- Se añadió un estado de editor único y una ruta de volcado controlada hacia el formulario visible.
- Se corrigieron los contadores para distinguir:
  - total global
  - total visibles
- Se mantiene un panel de fallback visible con el borrador abierto.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/21` y `GET /api/communications/drafts/23` siguen devolviendo los borradores esperados.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 13:31 CEST - infra-agent-web v0.18.1.6 editor visible de Comunicaciones y apertura por ID con diagnóstico

### Causa raíz encontrada

- El borrador existía y se podía resolver por API, pero la UI visible seguía comportándose como si estuviera en modo `new`.
- El campo visible de apertura por ID dependía de un control numérico y el estado del editor no quedaba demostrado en pantalla.
- Había dos fuentes de verdad implícitas en la UI: el borrador seleccionado y el formulario visible.

### Corrección aplicada

- Se reforzó el editor visible con:
  - `communicationDraftEditorMode`
  - `populateCommunicationEditor(draft)`
  - estado controlado para `Abrir borrador por ID`
- `Ver` y `Abrir por ID` usan la misma ruta: cargar por ID y poblar el editor.
- Se añadió diagnóstico visible temporal:
  - modo de editor
  - ID seleccionado
  - presencia de destinatario / asunto / cuerpo
  - valor de apertura por ID
- Se añadió un bloque de respaldo visible con los datos del borrador abierto, para demostrar el estado aunque el formulario se comporte mal.
- `Nuevo` vuelve a limpiar el formulario y el modo del editor.

### Validación técnica

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/communications/drafts/21` y `GET /api/communications/drafts/23` devuelven los borradores esperados con metadatos completos.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 11:43 CEST - infra-agent-web v0.18.1.5 modo edit y carga completa de borradores en Comunicaciones

### Causa raíz

- El borrador existía y se podía abrir por ID, pero la UI no volcaba de forma fiable el objeto completo al editor.
- `Ver` y `Abrir borrador por ID` dependían de un objeto de lista parcial o de un reset posterior, dejando el editor en modo vacío.

### Solución aplicada

- Se introdujo `communicationDraftEditorMode` con estados explícitos:
  - `new`
  - `edit`
- Se añadió `populateCommunicationEditor(draft)` para normalizar y cargar el borrador completo en el formulario.
- `Ver` ahora resuelve el borrador por ID y carga el editor completo.
- `Abrir borrador por ID` carga el borrador por `GET /api/communications/drafts/:id`, lo inserta/actualiza en el estado local y abre el editor en modo edición.
- La cabecera del editor ya distingue claramente:
  - `Nuevo borrador`
  - `Editando borrador #ID`
- Se conservaron los flujos de `Marcar listo para revisión`, `Marcar revisado`, `prepare-send` y `send-email`.

### Validación real

- `GET /api/communications/drafts/21` devuelve el borrador persistido con:
  - `status = draft`
  - `recipient_email = fernando.martinez@ramiroarnedo.com`
  - `source_incident_id = 214`
  - `subject = Seguimiento de incidencia`
  - `created_at` y `updated_at` presentes
- `GET /api/communications/drafts/23` devuelve el nuevo borrador creado desde la incidencia 214 con los campos correctos.
- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin secretos, tokens, connection strings, cuerpos extensos ni `ReferenceError`.

## 2026-05-26 11:28 CEST - infra-agent-web v0.18.1.4 apertura directa de borradores de comunicaciones por ID

### Causa raíz real

- El borrador sí persistía en SQLite, pero la UI dependía de la lista filtrada y del estado de selección para mostrarlo.
- Si el borrador quedaba fuera de la vista actual, no se abría de forma garantizada aunque existiera por API.

### Solución aplicada

- Se añadió carga directa por ID con `GET /api/communications/drafts/:id`.
- Tras crear un borrador, la UI lo abre por `draft_id` en vez de depender solo de la lista.
- La vista de Comunicaciones puede abrir manualmente un borrador por ID aunque no aparezca en el listado filtrado.
- Si el borrador existe pero la lista actual no lo muestra, se abre igualmente por ID y se avisa al usuario.
- Se mantienen `Limpiar filtros`, el contador visible `Mostrando N de M borradores` y el detalle seleccionado con scroll.

### Validación real

- `GET /api/communications/drafts/21` devuelve el borrador persistido con:
  - `status = draft`
  - `recipient_email = fernando.martinez@ramiroarnedo.com`
  - `source_incident_id = 214`
  - `subject = Seguimiento de incidencia`
- Se creó un nuevo borrador real desde la incidencia 214:
  - `draft_id = 23`
  - `status = draft`
  - `recipient_email = fernando.martinez@ramiroarnedo.com`
  - `source_incident_id = 214`
  - `subject = Seguimiento de incidencia`
- `GET /api/communications/drafts/23` lo devuelve correctamente por ID.
- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin `GRAPH_CLIENT_SECRET`, `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, cuerpos extensos ni `ReferenceError`.

## 2026-05-26 11:12 CEST - infra-agent-web v0.18.1.3 hotfix visibilidad/verificabilidad borradores de comunicaciones

### Causa raíz

- El flujo de creación de borradores sí persistía en SQLite, pero la UI no siempre refrescaba y seleccionaba el borrador recién creado.
- Si había filtros activos, el borrador podía quedar oculto sin aviso claro.
- La vista de detalle no tenía una referencia estable para llevar el nuevo borrador a pantalla.

### Corrección aplicada

- `loadCommunicationDrafts()` ahora devuelve también `{ drafts, summary }` para poder verificar visibilidad tras la creación.
- `revealCommunicationDraft()` selecciona el borrador recién creado, recarga la lista y, si queda oculto por filtros, los limpia y avisa al usuario.
- Se añadió `Limpiar filtros` en Comunicaciones y un indicador de `Mostrando N de M borradores`.
- La vista de detalle del borrador seleccionado ahora recibe una `ref` estable y se desplaza a pantalla al abrir un borrador nuevo.
- La respuesta del agente al crear un borrador expone `draft_id`, destinatario y estado, sin afirmar éxito si la persistencia falla.

### Validación real

- Borrador creado y persistido en SQLite:
  - `draft_id = 21`
  - `recipient_email = fernando.martinez@ramiroarnedo.com`
  - `source_incident_id = 214`
  - `subject = Seguimiento de incidencia`
  - `status = draft`
- `GET /api/communications/drafts?status=draft&limit=5` devuelve el borrador nuevo.
- La UI refresca la lista y puede mostrar el borrador recién creado incluso si había filtros activos.
- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin secretos, tokens, connection strings, `ReferenceError` ni errores Realtime.

## 2026-05-26 11:00 CEST - infra-agent-web v0.18.1.2 acceptance final creator/email en IncidenciasTI

### Matriz de aceptación

| Prueba | Resultado | Fuente | Observaciones |
| --- | --- | --- | --- |
| `cuál es la última incidencia` | OK | IncidenciasTI / SharePoint | Devuelve ID 214, título, creador y email cuando existen. |
| `quién creó la última incidencia` | OK | IncidenciasTI / SharePoint | Responde `creator_name` y `creator_email`. |
| `email del creador de la última incidencia` | OK | IncidenciasTI / SharePoint | Devuelve `creator_email`. |
| `dime la anterior` con contexto ID 214 | OK | IncidenciasTI / SharePoint | Navegación live, mantiene creador/email. |
| `quién creó esta incidencia` con `currentIncidentContext` | OK | IncidenciasTI / SharePoint | Usa contexto activo y muestra creador/email. |
| `quién creó la última incidencia` por voz | OK | IncidenciasTI / SharePoint | Misma normalización que en chat. |
| `email del creador` por voz con contexto | OK | IncidenciasTI / SharePoint | Usa `currentIncidentContext`. |
| `prepara un email al creador de esta incidencia` | OK | IncidenciasTI / SharePoint | Prepara borrador, no envía, mantiene confirmación visual. |

### Validación

- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin secretos, tokens, connection strings, datos personales extensos, `ReferenceError` ni errores Realtime.

## 2026-05-26 10:34 CEST - infra-agent-web v0.18.1.1 hotfix creador/email en IncidenciasTI

### Realizado

- Se normalizaron y propagaron `creator_name` y `creator_email` en IncidenciasTI desde campos live y de detalle:
  - `fields_raw.CreadoPorNombre`
  - `fields_raw.CreadoPorEmail`
  - `list_item_raw.createdBy.user.displayName`
  - `list_item_raw.createdBy.user.email`
- La navegación y los resúmenes live ahora muestran creador y email cuando existen, y dejan de afirmar que no hay visibilidad directa.
- Se corrigió la ruta de `email del creador` para usar la incidencia correcta en contexto y preparar borrador seguro sin envío automático.
- La voz y el chat consumen los mismos campos normalizados para creator/email.

### Validación

- `getIncidentByIdLive(214)` normaliza `creator_name = Fernando Martinez` y `creator_email = fernando.martinez@ramiroarnedo.com`.
- `quién creó la última incidencia` devuelve el creador y su email.
- `prepara un email al creador de esta incidencia` prepara borrador seguro y no envía automáticamente.
- `npm run build` OK.
- `systemctl restart infra-agent-web.service` OK.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin secretos, tokens, connection strings ni `ReferenceError`.

## 2026-05-26 10:00 CEST - infra-agent-web v0.18.1 navegacion contextual live en IncidenciasTI

### Realizado

- Se añadió navegación contextual live sobre IncidenciasTI:
  - `última incidencia` usa `created desc / id desc`.
  - `incidencia anterior` y `siguiente incidencia` navegan en vivo desde la incidencia activa.
  - `última incidencia modificada` usa `modified desc / id desc`.
  - `anterior modificada` / `siguiente modificada` usan `modified desc / id desc` cuando el contexto activo procede de esa vista.
- El contexto activo de incidencia se guarda para navegar sin mezclar con Zabbix.
- Se incorporaron las columnas nuevas:
  - `CreadoPorNombre`
  - `CreadoPorEmail`
- La búsqueda por creador ahora consulta live y soporta:
  - `incidencias creadas por Fernando`,
  - `incidencias de Fernando`,
  - `incidencias abiertas de Fernando`,
  - `incidencias creadas por correo`.
- El resumen y la ficha de incidencia muestran:
  - creador,
  - email del creador cuando existe,
  - fuente,
  - criterio de orden,
  - live read.
- La acción `Email al creador` prepara borrador con el flujo seguro de comunicaciones, sin envío automático.
- `IncidenciasTI` sigue separada de `Zabbix`; no se afirma causalidad sin evidencia.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Validacion real con datos:
  - `última incidencia` -> `ID 214`, orden `created desc / id desc`.
  - `dime la anterior` desde `ID 214` -> `ID 213`.
  - `última incidencia modificada` -> `ID 213`, orden `modified desc / id desc`.
  - `dime la anterior modificada` desde `ID 213` -> `ID 214`.
  - `incidencias creadas por Fernando` -> búsqueda live correcta, sin duplicar `por`.
  - `qué es lo más urgente` -> bloques separados de Zabbix e IncidenciasTI.
- Logs revisados sin secretos, tokens, connection strings ni errores Realtime.

## 2026-05-26 09:17 CEST - infra-agent-web v0.18.0 separacion estricta IncidenciasTI / Zabbix

### Realizado

- Separadas las fuentes operativas para evitar mezclar tickets de usuario con problemas de monitorización.
- `IncidenciasTI` pasa a consultarse en directo para:
  - `última incidencia`, `último ticket`, `incidencia más reciente`, `última incidencia de usuario`, `última incidencia TI`,
  - `última incidencia modificada` / `última actualizada`.
- Criterio corregido:
  - `última incidencia` usa `created desc / id desc`,
  - `última incidencia modificada` usa `modified desc / id desc`.
- `Zabbix` queda como fuente separada para:
  - `último problema`,
  - `alertas activas`,
  - `problemas activos`,
  - `problemas Zabbix`,
  - `monitorización`,
  - `host caído`,
  - `latencia`,
  - `disco`,
  - `NAS`,
  - `backup`,
  - `UPS/SAI`.
- `qué es lo más urgente` devuelve dos bloques separados:
  - `Zabbix / Monitorización`,
  - `IncidenciasTI / SharePoint`.
- La correlación explícita entre incidencias y Zabbix:
  - etiqueta evidencia,
  - muestra fuente Zabbix y fuente IncidenciasTI,
  - no afirma causalidad.
- La voz reutiliza `voice_ops_query` para estas consultas separadas.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Validacion real con datos:
  - `última incidencia` -> `ID 214 - Probando columnas nuevas` desde IncidenciasTI live, orden `created desc / id desc`.
  - `última incidencia modificada` -> `ID 213 - Impresora Zebra no Funciona`, orden `modified desc / id desc`.
  - `último problema Zabbix` -> problemas live de monitorización, sin mezclar tickets.
  - `qué es lo más urgente` -> dos bloques separados.
  - `cruza Zebra con Zabbix` -> posible relación con evidencia, sin causalidad confirmada.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, `ReferenceError` ni errores Realtime.

## 2026-05-26 08:17 CEST - infra-agent-web v0.17.8.1 visualizacion unificada Power BI voz/texto

### Realizado

- Unificada la visualización de resultados Power BI entre texto y voz usando el mismo resultado estructurado y el mismo componente `PowerBiChatResultView`.
- El router de voz `voice_powerbi_query` devuelve ahora estados diferenciados:
  - `ok + handled + unsupported=false` para consultas soportadas,
  - `ok + handled + unsupported=true` para rechazos seguros,
  - `ok=false` solo para error técnico real.
- La UI de Power BI conserva el último resultado compartido y muestra:
  - tarjeta KPI cuando corresponde,
  - tabla legible y preview,
  - banner de consulta lanzada por voz,
  - botón de modal ampliado.
- La voz no lee tablas completas, no expone DAX y no amplía capacidades.
- `administracion_ventas` sigue siendo el único modelo avanzado.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Revisión de logs sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, `ReferenceError` ni errores Realtime.

### Confirmacion final

- Confirmación visual y de voz realizada:
  - `cuánto hemos vendido` por voz responde con resumen breve.
  - La pantalla muestra KPI Power BI con el mismo componente visual que texto.
  - `ventas por cliente` por voz muestra resultado tabular en pantalla.
  - La voz no lee tablas completas.
  - El modal ampliado funciona también con resultados lanzados por voz.
  - `margen por cliente` devuelve rechazo seguro, no error técnico.
  - Ya no aparece `La herramienta falló` para consultas Power BI controladas.
  - Consulta local Power BI por texto sigue funcionando.
  - ChatKit en Agente general sigue funcionando.
  - `administracion_ventas` sigue siendo el único modelo avanzado.
  - No hay DAX libre ni DAX manual.

## 2026-05-25 19:43 CEST - infra-agent-web v0.17.8.1 aceptacion voz Power BI

### Realizado

- Validada la ruta de voz Power BI controlada para `administracion_ventas` reutilizando el mismo router y capabilities que el texto.
- Integrado el tool Realtime `voice_powerbi_query` para que la voz pueda lanzar consultas soportadas sin DAX libre.
- La UI de Power BI recibe el resultado lanzado por voz y muestra:
  - banner de consulta por voz,
  - resumen hablado,
  - resultado visual,
  - acceso al modal ampliado.
- La voz no lee tablas completas ni expone DAX.
- Las preguntas no soportadas devuelven rechazo seguro y no llaman a Execute Queries.
- No se ha ampliado el catálogo ni el alcance del modelo.

### Matriz de aceptacion

| Frase | Resultado real | Observaciones |
| --- | --- | --- |
| `cuánto hemos vendido` | OK | Detecta Power BI, ejecuta consulta controlada, devuelve resumen breve y resultado visual. |
| `ventas por cliente` | OK | Ejecuta consulta tabular controlada y muestra el resultado en pantalla. |
| `unidades por producto` | OK | Ejecuta consulta controlada y devuelve resumen breve. |
| `margen por cliente` | Rechazo seguro | No entra en Power BI; devuelve ayuda con capacidades soportadas. |
| `ejecuta este DAX EVALUATE clientes` | Rechazo seguro | Bloqueado sin llamar a Execute Queries. No se muestra DAX. |
| `qué es lo más urgente hoy` | Flujo normal | No entra en Power BI; mantiene el comportamiento de voz existente. |

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Revisión de logs sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings`, `ReferenceError` ni errores Realtime.

## 2026-05-25 17:54 CEST - infra-agent-web v0.17.8 consultas Power BI por voz

### Realizado

- Añadido el tool de voz `voice_powerbi_query` para consultar Power BI con el mismo router controlado y las mismas capabilities que el texto.
- Integradas en la instrucción Realtime las consultas soportadas por voz:
  - totales de ventas y unidades,
  - ventas o unidades por cliente, producto, familia, representante, tipo, especie y mes,
  - top 10 por ventas o unidades,
  - `Unidades por mes` solo si el catálogo/capabilities lo permiten.
- Creado el helper compartido `lib/powerbiVoiceRouter.js` para:
  - detectar intención Power BI,
  - reutilizar el router controlado existente,
  - generar una respuesta hablada breve,
  - exponer el resultado visual para la UI.
- La voz no lee tablas completas: solo resume y deja el detalle visual en pantalla.
- La UI de Power BI muestra ahora un banner de resultado lanzado por voz con enlace al modal ampliado.
- El panel Power BI sigue siendo el único modelo avanzado: `administracion_ventas`.
- No se ha añadido DAX libre ni consultas fuera de capabilities.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Revisión de logs sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni `ReferenceError`.

## 2026-05-25 16:35 CEST - infra-agent-web v0.17.7.5 hotfix modal global Power BI

### Realizado

- Corregido el modal ampliado de Power BI para que se renderice como overlay global independiente del drawer:
  - `position: fixed`,
  - centrado real,
  - dimensiones amplias y responsivas,
  - cierre por fondo y botón visible,
  - sin recorte por `overflow` o `transform` del drawer.
- El modal usa un portal a `document.body`, por lo que ya no depende del ancho ni del clipping del contenedor lateral.
- Se mantiene el resto del diseño de pestañas internas:
  - `Agente general`,
  - `Power BI`.
- Sin cambios funcionales en backend, Ask Lab, DAX Lab, emails, Zabbix, SharePoint, MCPs o workflow.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Consulta Power BI real verificada de nuevo tras el hotfix.
- Confirmación visual final: el modal ampliado se abre centrado, con fondo oscurecido, tabla legible y cierre correcto.
- Logs revisados sin secretos, tokens ni errores de render.
- El modal ampliado queda centrado y aislado del drawer por portal a `document.body`.

## 2026-05-25 16:20 CEST - infra-agent-web v0.17.7.5 pestañas internas para ChatKit y Power BI

### Realizado

- Separado el drawer del chat textual en dos pestañas internas:
  - `Agente general`
  - `Power BI`
- `Agente general` mantiene ChatKit visible y usable, sin bloque Power BI encima.
- `Power BI` contiene la consulta local controlada para `administracion_ventas`, ayuda rápida plegable, último resultado compacto y apertura a vista ampliada.
- El modal ampliado queda fuera del flujo de ChatKit y no fuerza resultados analíticos dentro de la columna del chat general.
- Se mantiene el alcance:
  - sin DAX libre,
  - sin DAX manual,
  - sin ampliar capacidades,
  - sin tocar backend Power BI, emails, Zabbix, SharePoint, MCPs ni workflow.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `POST /api/powerbi/models/administracion_ventas/ask/execute` sigue respondiendo correctamente para consultas soportadas.
- Logs revisados sin secretos, tokens ni errores de render.

## 2026-05-25 16:05 CEST - infra-agent-web v0.17.7.3 mejora visual de resultados Power BI

### Realizado

- Mejorada la visualización de `PowerBiChatResultView` para que los resultados de `administracion_ventas` se lean como respuesta de negocio y no como salida técnica:
  - título claro de la consulta,
  - resumen natural destacado,
  - fuente visible `Power BI / administracion_ventas`,
  - `rowCount`,
  - `truncated`,
  - fecha/hora,
  - notas de límite cuando aplica.
- Para consultas `total_metric` se muestra una tarjeta KPI en lugar de una tabla de una sola columna.
- Las consultas por dimensión muestran ahora una tabla legible con:
  - encabezados humanizados,
  - importes con formato español,
  - enteros sin decimales cuando corresponde,
  - wrap de texto para nombres largos,
  - tooltip en celdas.
- Añadido botón `Ver resultado ampliado` que abre un modal/panel más ancho reutilizando el mismo resultado, sin nueva consulta ni exportación.
- El bloque `Consultas soportadas` del panel Power BI quedó plegable para reducir ruido visual.
- Mantiene el alcance actual:
  - solo `administracion_ventas`,
  - sin DAX libre,
  - sin ampliar métricas o dimensiones,
  - sin tocar Power BI, emails, Zabbix, SharePoint, MCPs ni workflow.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin secretos, tokens ni errores de render.
- Se conserva el catálogo de capacidades y el Ask Lab que ya estaban validados en v0.17.7.2.

## 2026-05-25 15:29 CEST - infra-agent-web v0.17.7.2 catalogo formal de consultas Power BI

### Realizado

- Añadido `lib/powerbiCapabilities.js` como fuente formal de capacidades para `administracion_ventas`.
- Expuestos los endpoints:
  - `GET /api/powerbi/models/administracion_ventas/capabilities`
  - `GET /api/powerbi/models/administracion_ventas/capabilities/examples`
- El catálogo formal reutiliza el diccionario de negocio, el DAX Lab y la allowlist actual:
  - métricas: `ventas_eur`, `unidades`,
  - dimensiones: `cliente`, `articulo`, `producto`, `familia`, `representante`, `tipo`, `especie`, `mes`,
  - intents: `total_metric`, `metric_by_dimension`, `top_dimension_by_metric`, `metric_by_month`,
  - tiempo: `all_time`,
  - límites: `topN <= 20`, `rowLimit <= 50`.
- La UI del panel Power BI y el bloque `Consulta local Power BI` muestran ahora:
  - métricas disponibles,
  - dimensiones disponibles,
  - consultas soportadas por intent,
  - ejemplos rápidos clicables,
  - consultas no soportadas todavía,
  - ayuda visible para voz.
- El rechazo seguro reutiliza ahora la ayuda formal de capacidades para responder de forma corta y consistente.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- `GET /api/powerbi/models/administracion_ventas/capabilities` OK.
- `GET /api/powerbi/models/administracion_ventas/capabilities/examples` OK.
- `POST /api/powerbi/models/administracion_ventas/ask/interpret` sigue interpretando:
  - `Cuánto hemos vendido`,
  - `Total de ventas`,
  - `Unidades por producto`,
  - `Top 10 clientes por unidades`,
  - `Ventas por mes`,
  - y rechaza de forma segura `margen por cliente`.
- Logs revisados sin secretos, tokens ni datos de negocio extensos.

## 2026-05-25 13:12 CEST - infra-agent-web v0.17.7 integracion controlada de Ask Lab en el chat

### Realizado

- Añadido el router `lib/powerbiChatRouter.js` para derivar consultas claramente Power BI desde la capa de envío del chat.
- La integración solo activa Power BI cuando el texto encaja con activadores explícitos y seguros:
  - `power bi ...`
  - `consulta power bi ...`
  - `pregunta a power bi ...`
  - `consulta ventas ...`
  - `pregunta a ventas ...`
  - `ventas por ...`
  - `top ... por ventas`
  - `cuánto hemos vendido`
  - `cuántas unidades hemos vendido`
- El router resuelve únicamente `administracion_ventas` y reutiliza el Ask Lab limitado de v0.17.6.
- El resto de preguntas sigue el flujo normal del agente.
- La UI muestra un bloque de respuesta Power BI con:
  - fuente `Power BI / administracion_ventas`,
  - `rowCount`,
  - `truncated`,
  - tabla limitada de resultados,
  - sin mostrar DAX por defecto.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Matriz de aceptacion del router:

| Pregunta | Route Power BI | Resultado | Observaciones |
| --- | --- | --- | --- |
| `Power BI: cuánto hemos vendido` | Sí | OK | Devuelve ventas totales para `administracion_ventas`. |
| `Consulta ventas por cliente` | Sí | OK | Devuelve ventas por cliente con tabla limitada. |
| `Pregunta a ventas top 10 clientes por ventas` | Sí | OK | Devuelve top 10 clientes por ventas. |
| `Power BI: margen por cliente` | Sí | KO seguro | Rechazo con mensaje claro de margen/rentabilidad no soportado. |
| `Power BI: ventas de este año` | Sí | KO seguro | Rechazo con limitación temporal explicada. |
| `Power BI: top 100 clientes por ventas` | Sí | KO seguro | Rechazo por superar el máximo de `topN`. |
| `Cruza Zabbix e IncidenciasTI` | No | No aplica | No deriva a Power BI y sigue el flujo normal del agente. |
- Pruebas del router en entorno local:
  - `Power BI: cuánto hemos vendido` -> ruta Power BI OK, respuesta OK.
  - `Consulta ventas por cliente` -> ruta Power BI OK, respuesta OK.
  - `Pregunta a ventas top 10 clientes por ventas` -> ruta Power BI OK, respuesta OK.
  - `Power BI: margen por cliente` -> ruta Power BI OK, rechazo/aclaración segura.
  - `Cruza Zabbix e IncidenciasTI` -> no entra en Power BI.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni datos reales extensos.

### Seguridad

- No hay chat libre Power BI.
- No hay DAX manual.
- No se guarda resultado real en SQLite.
- No se toca Power BI, emails v0.16.1, Zabbix, SharePoint, MCPs ni workflow.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

## 2026-05-25 12:55 CEST - infra-agent-web v0.17.6 Ask Lab limitado para administracion_ventas

### Realizado

- Añadida la capa de interpretación de preguntas naturales limitada para `administracion_ventas`.
- Implementado el módulo:
  - `lib/powerbiNlqInterpreter.js`
- Implementados los endpoints:
  - `POST /api/powerbi/models/administracion_ventas/ask/interpret`
  - `POST /api/powerbi/models/administracion_ventas/ask/preview`
  - `POST /api/powerbi/models/administracion_ventas/ask/execute`
- La interpretación solo traduce a intents controlados del DAX Lab:
  - `total_metric`
  - `metric_by_dimension`
  - `top_dimension_by_metric`
  - `metric_by_month`
- Métricas soportadas:
  - `ventas_eur`
  - `unidades`
- Dimensiones soportadas:
  - `cliente`
  - `articulo`
  - `producto`
  - `familia`
  - `representante`
  - `tipo`
  - `especie`
- Tiempo soportado:
  - `all_time`
- La UI del panel Power BI incluye ahora `Ask Lab`, con:
  - interpretar,
  - previsualizar consulta,
  - ejecutar en laboratorio,
  - mostrar confidence, intent, métrica, dimensión, topN, DAX generado, validación, resultado limitado y resumen natural.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Matriz de aceptacion real del Ask Lab:

| Prueba | Interpret | Preview | Execute | Observaciones |
| --- | --- | --- | --- | --- |
| Cuánto hemos vendido | OK | OK | OK | Mapea a `total_metric / ventas_eur`. |
| Cuántas unidades hemos vendido | OK | OK | OK | Mapea a `total_metric / unidades`. |
| Ventas por cliente | OK | - | - | Mapea a `metric_by_dimension / ventas_eur / cliente`. |
| Top 10 clientes por ventas | OK | OK | OK | Mapea a `top_dimension_by_metric / ventas_eur / cliente`. |
| Unidades por producto | OK | OK | OK | Mapea a `metric_by_dimension / unidades / producto`. |
| Ventas por familia | OK | OK | OK | Mapea a `metric_by_dimension / ventas_eur / familia`. |
| Ventas por representante | OK | OK | OK | Mapea a `metric_by_dimension / ventas_eur / representante`. |
| Ventas por mes | OK | OK | OK | Mapea a `metric_by_month / ventas_eur`. |
| margen por cliente | KO | KO | KO | Rechazo por métrica no soportada. |
| rentabilidad por producto | KO | KO | KO | Rechazo por métrica no soportada. |
| ventas de este año | KO | KO | KO | Rechazo por filtro temporal no soportado. |
| comparativa con el año pasado | KO | KO | KO | Rechazo por comparación temporal no soportada. |
| dame todos los clientes | KO | KO | KO | Rechazo por solicitud masiva fuera de alcance. |
| exporta todos los datos | KO | KO | KO | Rechazo por exportación masiva fuera de alcance. |
| ejecuta este DAX: EVALUATE clientes | KO | KO | KO | Rechazo por DAX manual no permitido. |
| top 100 clientes por ventas | KO | KO | KO | Rechazo por `topN` fuera del máximo permitido. |
| pregunta vacía | KO | KO | KO | Rechazo por pregunta vacía. |
| pregunta demasiado larga | KO | KO | KO | Rechazo por longitud excesiva. |
| modelKey distinto de `administracion_ventas` | KO | KO | KO | Rechazo por allowlist cerrada. |
- `POST /api/powerbi/models/administracion_ventas/ask/interpret`:
  - `Cuánto hemos vendido` -> `total_metric / ventas_eur` con confidence `0.85`.
  - `Top 10 clientes por ventas` -> `top_dimension_by_metric / ventas_eur / cliente` con confidence `0.99`.
- `POST /api/powerbi/models/administracion_ventas/ask/interpret`:
  - `Cuántas unidades hemos vendido` -> `total_metric / unidades` con confidence `0.85`.
- `POST /api/powerbi/models/administracion_ventas/ask/preview`:
  - `Ventas por mes` -> previsualización válida, DAX generado y validación OK.
- `POST /api/powerbi/models/administracion_ventas/ask/execute`:
  - `Unidades por producto` -> ejecución OK, `rowCount=10`, `truncated=false`.
  - `Top 10 clientes por ventas` -> ejecución OK, `rowCount=10`, `truncated=false`.
- Rechazos confirmados:
  - `margen por cliente`,
  - `ventas de este año`,
  - `dame todos los clientes`,
  - `top 100 clientes por ventas`,
  - `ejecuta este DAX: EVALUATE clientes`,
  - `modelKey` distinto de `administracion_ventas`.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni datos reales extensos.

### Seguridad

- No hay DAX libre.
- No hay chat libre Power BI.
- No se guardan resultados en SQLite.
- No se toca Power BI, emails v0.16.1, Zabbix, SharePoint, MCPs ni workflow.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

## 2026-05-25 12:25 CEST - infra-agent-web v0.17.5.1 aceptacion real DAX Lab administracion_ventas

### Resultado general

- Aceptacion funcional completa del laboratorio DAX controlado para `administracion_ventas`.
- El laboratorio sigue siendo interno, read-only y sin chat libre.
- No se guarda ningun resultado real en SQLite.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

### Matriz de aceptacion

- `GET /api/powerbi/models/administracion_ventas/dax-lab/status`:
  - OK
  - score `71`
  - `available=true`
  - `rowLimit=50`
- `build total_metric ventas_eur`:
  - OK
  - DAX generado de longitud `34`
- `build total_metric unidades`:
  - OK
  - DAX generado de longitud `34`
- `build metric_by_dimension ventas_eur by cliente`:
  - OK
  - DAX generado de longitud `118`
- `build metric_by_dimension unidades by producto`:
  - OK
  - DAX generado de longitud `134`
- `build top_dimension_by_metric ventas_eur by cliente`:
  - OK
  - DAX generado de longitud `118`
- `build top_dimension_by_metric unidades by familia`:
  - OK
  - DAX generado de longitud `118`
- `build metric_by_month ventas_eur`:
  - OK
  - DAX generado de longitud `318`
- `validate total_metric ventas_eur`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate total_metric unidades`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate metric_by_dimension ventas_eur by cliente`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate metric_by_dimension unidades by producto`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate top_dimension_by_metric ventas_eur by cliente`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate top_dimension_by_metric unidades by familia`:
  - OK
  - `validation=true`
  - warnings `1`
- `validate metric_by_month ventas_eur`:
  - OK
  - `validation=true`
  - warnings `0`
- `execute total_metric ventas_eur`:
  - OK
  - `rowCount=1`
  - `truncated=false`
  - `validation=true`
- `execute metric_by_dimension ventas_eur by cliente`:
  - OK
  - `rowCount=10`
  - `truncated=false`
  - `validation=true`
- `execute top_dimension_by_metric ventas_eur by cliente`:
  - OK
  - `rowCount=10`
  - `truncated=false`
  - `validation=true`
- `execute metric_by_dimension unidades by producto`:
  - OK
  - `rowCount=10`
  - `truncated=false`
  - `validation=true`
- `execute metric_by_month ventas_eur`:
  - OK
  - `rowCount=10`
  - `truncated=false`
  - `validation=true`

### Rechazos de seguridad confirmados

- `modelKey` distinto de `administracion_ventas`:
  - rechazado con `v0.17.5 solo permite administracion_ventas.`
- `metric` no permitida:
  - rechazado con `Métrica no permitida para el laboratorio DAX.`
- `dimension` no permitida:
  - rechazado con `Dimensión no permitida para el laboratorio DAX.`
- `topN > 20`:
  - rechazado con `topN debe estar entre 1 y 20.`
- `rowLimit > 50`:
  - rechazado con `rowLimit debe estar entre 1 y 50.`
- `timeRange` distinto de `all_time`:
  - rechazado con `El laboratorio DAX v0.17.5 solo admite timeRange=all_time.`
- `execute` con DAX manual:
  - rechazado con `El laboratorio DAX no acepta DAX manual en execute.`
- `validate` con `DateTableTemplate`:
  - rechazado con `El laboratorio solo valida DAX generado internamente.`

### Observaciones

- Las validaciones aceptadas generan advertencia controlada cuando la consulta no usa la fecha por defecto del diccionario.
- La ejecución devuelve resultados limitados y no persiste filas reales en SQLite.
- Los logs revisados no muestran `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni datos reales extensos.

## 2026-05-25 12:10 CEST - infra-agent-web v0.17.5 DAX Lab controlado para administracion_ventas

### Realizado

- Añadido el laboratorio DAX controlado para Power BI, restringido a `administracion_ventas`.
- Implementados los endpoints:
  - `GET /api/powerbi/models/:modelKey/dax-lab/status`
  - `POST /api/powerbi/models/:modelKey/dax-lab/build`
  - `POST /api/powerbi/models/:modelKey/dax-lab/validate`
  - `POST /api/powerbi/models/:modelKey/dax-lab/execute`
- El servidor genera internamente DAX solo para intents permitidos:
  - `total_metric`
  - `metric_by_dimension`
  - `top_dimension_by_metric`
  - `metric_by_month`
- Métricas permitidas:
  - `ventas_eur`
  - `unidades`
- Dimensiones permitidas:
  - `cliente`
  - `articulo`
  - `producto`
  - `familia`
  - `representante`
  - `tipo`
  - `especie`
- Rango temporal permitido en esta fase:
  - `all_time`
- Límite de ejecución fijado en 50 filas.
- La validación rechaza DAX externo o generado fuera del laboratorio, además de objetos técnicos bloqueados.
- La ejecución devuelve resultados limitados y no persiste datos reales en SQLite.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/models/administracion_ventas/dax-lab/status` OK.
- `POST /api/powerbi/models/administracion_ventas/dax-lab/build` OK para los intents y métricas soportadas.
- `POST /api/powerbi/models/administracion_ventas/dax-lab/validate` acepta el DAX generado internamente y rechaza tablas técnicas.
- `POST /api/powerbi/models/administracion_ventas/dax-lab/execute` devuelve resultados reales limitados y truncados solo si procede.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.

### Seguridad

- No se toca chat libre contra Power BI ni DAX arbitrario de usuario.
- No se toca Power BI Desktop, el modelo real, el envío de emails v0.16.1, Zabbix, SharePoint, MCPs ni workflow.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

## 2026-05-25 11:43 CEST - infra-agent-web v0.17.4.1 parche seguro del diccionario administracion_ventas

### Realizado

- Aplicado el parche semántico seguro del diccionario de negocio para `administracion_ventas`.
- Mantenida la fecha de negocio por defecto:
  - `cabeceraFactura.fecha`
- Marcadas como métricas principales:
  - `ventas_eur`
  - `unidades`
- Añadidos textos de negocio a entidades, dimensiones y objetos técnicos/ocultos relevantes.
- Bloqueados como no permitidos para lenguaje natural:
  - `DateTableTemplate_51a0e164-d6e9-43a2-adfa-6922ab685753`
  - `LocalDateTable_253cbd4b-154d-480a-8d31-02687d2ac702`
  - `relacionCodigos`
- Revisión y calidad tras parche:
  - score `71`,
  - estado `incomplete`,
  - sin tablas sin descripción en la revisión,
  - un único conflicto de sinónimo remanente,
  - las recomendaciones restantes se centran en crear más medidas oficiales en Power BI Desktop y clasificar columnas numéricas auxiliares.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary/quality` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary/review` correcto.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.

### Seguridad

- No se ejecuta DAX.
- No se consultan datos reales de negocio.
- No se toca Power BI, emails, Zabbix, SharePoint, MCPs ni workflow.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

## 2026-05-25 11:27 CEST - infra-agent-web v0.17.4 revision asistida del diccionario Power BI

### Realizado

- Añadida la revisión asistida del diccionario de negocio sobre `administracion_ventas`.
- Implementados los endpoints:
  - `GET /api/powerbi/models/:modelKey/business-dictionary/review`
  - `POST /api/powerbi/models/:modelKey/business-dictionary/patch`
- Generado el fichero sugerido de revisión manual:
  - `infra-agent-web/data/powerbi-business-dictionaries/administracion_ventas.review.json`
- Integrado en el panel Power BI:
  - botón `Revisar diccionario`,
  - score,
  - resumen de medidas oficiales, métricas agregadas, tablas sin descripción, columnas numéricas sin clasificar, fechas candidatas y objetos técnicos/ocultos,
  - recomendaciones para afinar el diccionario antes de la fase de laboratorio DAX controlada.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary/review` OK.
- `POST /api/powerbi/models/administracion_ventas/business-dictionary/patch` con cambio permitido OK.
- `POST /api/powerbi/models/no_such_model/business-dictionary/patch` rechazado.
- `POST /api/powerbi/models/%2e%2e%2fetc/business-dictionary/patch` rechazado.
- `POST /api/powerbi/models/administracion_ventas/business-dictionary/patch` con campo no permitido rechazado.
- Logs revisados sin secretos ni tokens.

### Seguridad

- No se ejecuta DAX libre.
- No se consultan datos reales de negocio.
- No se tocan Zabbix, SharePoint, MCPs, workflow ni el envío de emails v0.16.1.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

## 2026-05-25 11:09 CEST - infra-agent-web v0.17.3 diccionario de negocio Power BI piloto administracion_ventas

### Realizado

- Añadida una capa de diccionario de negocio sobre el catálogo técnico importado.
- El piloto se activa sobre `administracion_ventas`.
- Implementados los endpoints:
  - `GET /api/powerbi/models/:modelKey/business-dictionary`
  - `POST /api/powerbi/models/:modelKey/business-dictionary/generate-draft`
  - `POST /api/powerbi/models/:modelKey/business-dictionary/save`
  - `GET /api/powerbi/models/:modelKey/business-dictionary/quality`
- Añadido el fichero técnico:
  - `infra-agent-web/data/powerbi-business-dictionaries/administracion_ventas.json`
- Integrado en el panel Power BI:
  - estado del diccionario,
  - contadores,
  - score de calidad,
  - botón `Generar borrador de diccionario`.

### Resultado tecnico

- Entidades detectadas: 12.
- Métricas detectadas: 5.
- Dimensiones detectadas: 12.
- Dimensiones de tiempo detectadas: 1.
- Sinónimos: 107.
- Warnings: 7.
- Calidad: `incomplete`, score 59.

### Seguridad

- No se ejecuta DAX libre.
- No se consultan datos reales de negocio.
- No se guardan tokens, secretos ni connection strings sensibles.
- No se tocan Zabbix, SharePoint, MCPs, workflow ni el envío de emails v0.16.1.
- `POWERBI_XMLA_ENABLED` sigue en `false`.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary` correcto.
- `POST /api/powerbi/models/administracion_ventas/business-dictionary/generate-draft` correcto.
- `GET /api/powerbi/models/administracion_ventas/business-dictionary/quality` correcto.
- `modelKey` inexistente rechaza.
- `path traversal` rechaza.
- Revisados los logs sin secretos ni tokens.

## 2026-05-25 10:51 CEST - infra-agent-web v0.17.2 import real administracion_ventas validado

### Realizado

- Import real completado para `administracion_ventas` desde la carpeta PBIP/TMDL del modelo semántico.
- El catálogo importado quedó visible en `GET /api/powerbi/models/administracion_ventas/catalog`, `.../catalog/business` e `.../catalog/import-status`.
- Se corrigió la prioridad de detección para que, si existen archivos `.tmdl`, el import use TMDL antes que JSON de soporte del export PBIP.

### Resultado tecnico

- Tablas detectadas: 11.
- Columnas detectadas: 73.
- Medidas detectadas: 2.
- Relaciones detectadas: 5.
- Jerarquias detectadas: 2.
- Warnings de parseo: 3, todos en archivos de soporte del modelo semántico no catalogables en esta fase:
  - `Informe general ventas N.SemanticModel/definition/cultures/es-ES.tmdl`
  - `Informe general ventas N.SemanticModel/definition/database.tmdl`
  - `Informe general ventas N.SemanticModel/definition/model.tmdl`

### Seguridad

- Solo se guardaron metadatos tecnicos del modelo.
- No se guardaron datos reales de negocio, credenciales, tokens ni connection strings sensibles.
- No se tocaron Zabbix, SharePoint, MCPs, workflow ni el envio de emails v0.16.1.
- `POWERBI_XMLA_ENABLED` permanece en `false`.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `systemctl status infra-agent-web.service --no-pager` activo.
- Logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.

## 2026-05-25 01:40 CEST - infra-agent-web v0.17.2 catalogo semantico asistido Power BI Pro

### Realizado

- Añadida una vía de importación de catálogo semántico para Power BI Pro normal sin XMLA.
- Implementados los endpoints:
  - `GET /api/powerbi/catalog/imports/status`
  - `GET /api/powerbi/models/:modelKey/catalog/import-status`
  - `POST /api/powerbi/models/:modelKey/catalog/import`
  - `GET /api/powerbi/models/:modelKey/catalog/business`
- Añadidos parser TMDL y orquestador de importación por `modelKey`.
- Añadido caché SQLite para el catálogo importado como metadato técnico.
- El panel Power BI ahora muestra el origen del catálogo y el aviso cuando no existe importación.

### Seguridad

- No se leen rutas arbitrarias fuera de `data/powerbi-catalog-imports/{modelKey}/`.
- No se ejecuta código importado.
- No se guardan tokens, secretos ni datos reales de negocio.
- No se toca XMLA, Zabbix, SharePoint, MCPs, workflow ni el envío de emails.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- Import vacío falla con error claro.
- `modelKey` inexistente falla.
- Ruta inválida falla.
- Revisados los logs sin secretos ni tokens.

## 2026-05-25 01:10 CEST - infra-agent-web v0.17.1 semantic catalog discovery Power BI

### Realizado

- Añadida una capa de catálogo semántico read-only para Power BI.
- Implementado el descubrimiento por XMLA con allowlist por `modelKey` y sin aceptar `workspaceId` ni `datasetId` arbitrarios.
- Añadidas las rutas:
  - `GET /api/powerbi/catalog/status`
  - `GET /api/powerbi/models/:modelKey/catalog`
  - `POST /api/powerbi/models/:modelKey/catalog/refresh`
- Integrado un caché local SQLite para metadatos técnicos del catálogo.
- Añadido el panel técnico Power BI con botón `Actualizar catálogo` y contadores de tablas, columnas, medidas y relaciones.
- Mantenido el discovery REST de v0.17.0 como base y fallback cuando XMLA no está disponible.

### Seguridad

- No se guardan datos reales de negocio en el catálogo.
- No se exponen `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.
- No se tocan Zabbix, SharePoint, MCPs, workflow ni el envio de emails.

### Validacion

- `npm run build` correcto.
- Se ha verificado que el proyecto compila con las nuevas rutas y la nueva capa de catálogo.
- Pendiente validacion XMLA real contra workspaces Premium/Fabric/PPU si el entorno lo expone.

## 2026-05-25 00:26 CEST - infra-agent-web v0.17.0 validacion real Power BI read-only

### Validacion

- `POWERBI_ENABLED=true` cargado desde `.env.local`.
- `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID` y `POWERBI_CLIENT_SECRET` presentes sin imprimir secretos.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/status` y `GET /api/powerbi/models` correctos.
- Validado modelo por modelo con `status`, `dataset`, `reports`, `schema` y `test-query`.
- Modelos accesibles con resultado OK:
  - `junta_direccion`
  - `germinacion_control`
  - `germinacion_pildoras`
  - `logistica_prevision_envasado`
  - `administracion_ventas`
- `test-query` validada con `EVALUATE ROW("ok", 1)` en los cinco modelos.
- El esquema sigue reportándose como limitado por REST y queda preparado para XMLA en v0.17.1.

### Seguridad

- No se han expuesto `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.
- No se han tocado Zabbix, SharePoint, MCPs, workflow ni el envío de emails.

## 2026-05-24 22:10 CEST - infra-agent-web v0.17.0 Power BI multi-model discovery read-only

### Realizado

- Añadido un registro interno de modelos Power BI permitidos por `modelKey` en `config/powerbi-models.json`.
- Implementada autenticación read-only con service principal mediante `client_credentials` contra `https://analysis.windows.net/powerbi/api/.default`.
- Añadida capa de cliente Power BI read-only sin guardar tokens en SQLite.
- Añadidas las rutas internas:
  - `GET /api/powerbi/status`
  - `GET /api/powerbi/models`
  - `GET /api/powerbi/models/:modelKey/status`
  - `GET /api/powerbi/models/:modelKey/reports`
  - `GET /api/powerbi/models/:modelKey/dataset`
  - `GET /api/powerbi/models/:modelKey/schema`
  - `POST /api/powerbi/models/:modelKey/test-query`
- Añadido un panel técnico `Power BI` en la consola con estado de conexión, lista de modelos, dataset, reports, test-query y aviso de esquema limitado por REST.
- La test-query está fijada a `EVALUATE ROW("ok", 1)` y no acepta DAX arbitrario.
- El esquema completo queda marcado como no disponible por REST cuando procede, dejando preparado XMLA o una vía de metadatos avanzada para v0.17.1.

### Seguridad

- No se han expuesto `POWERBI_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.
- No se han añadido escrituras, refresh, publish ni borrados.
- No se han tocado Zabbix, SharePoint, MCPs, workflow ni el envío de emails.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/powerbi/status` disponible.
- `GET /api/powerbi/models` disponible.
- Endpoints por `modelKey` disponibles con errores claros si Power BI no está configurado o si el modelo está deshabilitado.
- Revisados los logs sin huellas de secretos.

## 2026-05-24 18:05 CEST - infra-agent-web v0.16.1 endurecimiento de envio real

### Realizado

- Bloqueado el reenvio de borradores ya enviados.
- Añadido mensaje de UX: `Este email ya fue enviado. Duplica el borrador si necesitas enviarlo de nuevo.`
- Invalidada la confirmacion visual anterior cuando se vuelve a preparar el mismo borrador.
- Endurecida la auditoria local de envio con:
  - `sent_by`
  - `from_user`
  - persistencia de `send_prepared_at`, `send_attempt_at`, `sent_at`, `send_status` y `send_error`
- Bloqueada la edicion, borrado y reenvio de borradores `sent`.
- Duplicado local disponible para crear un nuevo borrador sin arrastrar la auditoria de envio.
- Normalizado `EMAIL_ALLOWED_DOMAINS` y `recipient_email` en minúsculas para rechazar dominios externos aunque vengan con espacios o mayúsculas.
- Ajustada la voz para que nunca invoque el envio final y solo abra la confirmacion visual.
- Documentado el siguiente paso de identidad: Entra ID por usuario y grupos con permisos mínimos cuando se amplíe la libreta corporativa.

### Seguridad

- No se almacenan tokens de confirmacion en SQLite.
- No se exponen `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.
- No se han tocado Zabbix, SharePoint, MCPs ni workflow.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `POST /api/communications/prepare-send` funciona con borradores `reviewed`.
- `POST /api/communications/send-email` solo acepta una vez el mismo borrador.
- Un token antiguo tras re-preparar el mismo borrador queda rechazado.
- Dominios externos quedan rechazados.
- Revisada la auditoria local en SQLite con `sent_by` y `from_user`.
- Revisados los logs sin huellas de secretos.

## 2026-05-24 17:10 CEST - infra-agent-web v0.16 envio real de emails con Graph

### Realizado

- Añadido el flujo de envio real solo para borradores `email` en estado `reviewed`.
- Implementadas las rutas:
  - `POST /api/communications/prepare-send`
  - `POST /api/communications/send-email`
- Usado `GRAPH_MAIL_FROM_USER` como remitente temporal fijo con normalizacion de `mailto:`/Markdown.
- Aplicada la lista blanca `EMAIL_ALLOWED_DOMAINS` antes de permitir el envio.
- Añadida auditoria local en SQLite:
  - `send_status`
  - `send_prepared_at`
  - `send_attempt_at`
  - `sent_at`
  - `send_error`
- Integrada la UI de `Comunicaciones` con doble confirmacion visual:
  - `Preparar envio`
  - `Confirmar y enviar`
- Añadido el acceso de voz `voice_prepare_email_send` para abrir la confirmacion visual sin enviar nada.

### Seguridad

- No se han guardado tokens de confirmacion en SQLite.
- No se han expuesto `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization` ni tokens.
- No se han añadido permisos de Teams ni de escritura adicionales.
- No se ha tocado Zabbix, SharePoint, MCPs ni workflow.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `POST /api/communications/prepare-send` rechaza borradores no revisados o de tipo no email.
- `POST /api/communications/send-email` rechaza sin `confirm=true`.
- `POST /api/communications/send-email` rechaza dominios fuera de `EMAIL_ALLOWED_DOMAINS`.
- Envio real aceptado por Graph con `sendMail` usando `/users/{GRAPH_MAIL_FROM_USER}/sendMail`.
- `send_status`, `send_attempt_at` y `sent_at` quedan registrados localmente.
- Revisados los logs sin huellas de secretos.

## 2026-05-23 21:05 CEST - infra-agent-web v0.15.3 revision y trazabilidad de borradores

### Realizado

- Ampliado el esquema local de `communication_drafts` con los estados:
  - `draft`
  - `ready_for_review`
  - `reviewed`
  - `copied`
  - `discarded`
- Añadidos los campos de trazabilidad:
  - `template_id`
  - `review_notes`
  - `reviewed_at`
  - `reviewed_by`
  - `copied_at`
  - `discarded_at`
  - `last_action_at`
- Añadido resumen local de borradores en la API:
  - total,
  - pendientes de revisión,
  - listos para revisión,
  - revisados,
  - copiados,
  - descartados.
- Añadidos filtros por estado, tipo y plantilla en `/api/communications/drafts`.
- Integrada la UI de `Comunicaciones` con:
  - etiqueta visible de estado,
  - notas de revision,
  - detalle ampliado,
  - acciones locales `Marcar listo para revisión`, `Marcar revisado`, `Marcar copiado` y `Descartar`.
- Añadido soporte de voz para listar y marcar borradores de forma local sin enviar nada.
- Actualizada la documentación de `README.md`.

### Seguridad

- No se ha añadido `Mail.Send`.
- No se ha añadido `ChatMessage.Send`.
- No se han creado permisos de escritura externos.
- No se han expuesto secretos ni tokens.
- No se ha tocado Zabbix, SharePoint, MCPs, workflow ni incidencias.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `POST /api/communications/draft-from-template` crea borradores con `template_id`.
- `PATCH /api/communications/drafts/:id` cambia estados y registra marcas temporales.
- `GET /api/communications/drafts?status=pending_review` funciona.
- `GET /api/communications/drafts?template_id=matriz_correlacion` funciona.
- Revisada la tabla SQLite local y migrada para incluir los nuevos campos.

## 2026-05-23 20:32 CEST - infra-agent-web v0.15.2 plantillas de comunicaciones

### Realizado

- Creado el catalogo versionado de plantillas de comunicacion en `lib/communicationTemplates.js`.
- Añadidas las plantillas:
  - `executive_direccion`
  - `tecnico_sistemas`
  - `usuario_final`
  - `proveedor`
  - `seguimiento_incidencia`
  - `aviso_riesgo_critico`
  - `informe_diario`
  - `matriz_correlacion`
- Añadida la API:
  - `GET /api/communications/templates`
  - `POST /api/communications/draft-from-template`
- Integrada la UI de `Comunicaciones` con selector de plantilla, descripcion visible y creacion de borradores con plantilla.
- Sustituidos los botones de borrador generico por acciones especificas desde los informes exportables:
  - correo ejecutivo,
  - aviso tecnico,
  - resumen operativo,
  - resumen de matriz.
- Añadido soporte de voz para seleccionar plantilla adecuada antes de crear el borrador.
- Actualizada la documentacion de `README.md`.

### Seguridad

- No se ha añadido `Mail.Send`.
- No se ha añadido `ChatMessage.Send`.
- No se han creado permisos de escritura.
- No se han expuesto secretos ni tokens.
- No se ha tocado Zabbix, SharePoint, MCPs, workflow ni incidencias.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/communications/templates` devuelve 8 plantillas.
- `POST /api/communications/draft-from-template` crea borradores correctos.
- Se ha creado un borrador ejecutivo desde informe diario.
- Se ha creado un aviso tecnico desde matriz.
- Se ha buscado un destinatario en la libreta corporativa.
- Se ha creado un borrador con destinatario seleccionado.
- `GET /api/realtime/session` sigue respondiendo `200`.
- Revision de logs sin coincidencias de secretos o tokens.

## 2026-05-23 12:08 CEST - infra-agent-web v0.15.1 libreta corporativa read-only

### Realizado

- Añadida la configuración Graph read-only para directorio corporativo:
  - `GRAPH_TENANT_ID`
  - `GRAPH_CLIENT_ID`
  - `GRAPH_CLIENT_SECRET`
- Creado el modulo `lib/companyDirectory.js` para leer usuarios activos desde Microsoft Graph con permisos mínimos y cachear resultados en SQLite.
- Añadida la tabla `company_directory_cache` para cache local opcional de directorio corporativo.
- Añadidas las rutas:
  - `GET /api/directory/search?q=`
  - `GET /api/directory/users?limit=50`
  - `POST /api/directory/sync`
- Integrada la vista `Libreta corporativa` en la UI con busqueda, sincronizacion manual y accion `Usar en borrador`.
- Añadidas sugerencias del directorio en el editor de comunicaciones.
- Añadidos comandos de voz para buscar destinatarios y preparar borradores sin envio.
- Actualizada la documentacion de `README.md`.
- Ajustada la consulta a Microsoft Graph para usar `/users` sin `$orderby` y resolver la ordenacion en local.
- La busqueda de directorio se resuelve sobre la caché SQLite con `LIKE`, evitando dependencias de `$search` o ordenacion remota.

### Seguridad

- No se ha añadido `Mail.Send`.
- No se ha añadido `ChatMessage.Send`.
- No se han creado permisos de escritura.
- No se han expuesto secretos ni tokens.
- No se ha tocado Zabbix, SharePoint, MCPs, workflow ni incidencias.

### Validacion

- `npm run build` correcto.
- `systemctl restart infra-agent-web.service` correcto.
- `GET /api/directory/search?q=fernando` devuelve error claro si Graph no esta configurado.
- `GET /api/directory/users?limit=10` devuelve error claro si Graph no esta configurado.
- `POST /api/directory/sync` devuelve error claro si Graph no esta configurado.
- `GET /` responde `200`.
- `POST /api/realtime/session` responde `200`.
- Revision de logs sin coincidencias de secretos o tokens.

## 2026-05-23 12:05 CEST - infra-agent-web v0.15 borradores de comunicaciones locales

### Realizado

- Implementada la tabla SQLite `communication_drafts` en la misma base local del dashboard.
- Añadida API CRUD local sin envio real:
  - `POST /api/communications/draft`
  - `GET /api/communications/drafts`
  - `GET /api/communications/drafts/:id`
  - `PATCH /api/communications/drafts/:id`
  - `DELETE /api/communications/drafts/:id`
- Añadida la vista `Comunicaciones` con:
  - editor de borradores,
  - lista de borradores recientes,
  - botones para copiar asunto, cuerpo o todo,
  - descargas Markdown y HTML,
  - `mailto:` opcional si existe `recipient_email`,
  - acciones de descartar y eliminar.
- Añadidos accesos rapidos para crear borradores desde:
  - informe ejecutivo,
  - informe tecnico,
  - informe operativo,
  - matriz,
  - borrador manual.
- Añadidos comandos de voz para preparar borradores de correo y Teams, sin envio automatico.
- Actualizada la documentacion de `README.md` y el estado visual de la UI a `v0.15`.

### Validacion

- `npm run build` correcto.
- El bundle incluye las nuevas rutas `/api/communications/draft`, `/api/communications/drafts` y `/api/communications/drafts/[id]`.

### Seguridad

- No se han creado permisos Graph de escritura.
- No se ha tocado Zabbix, SharePoint, MCPs, workflow ni secretos.
- No se ha enviado correo ni Teams.
- No se ha guardado audio ni transcripciones.

## 2026-05-20 13:55 CEST - Auditoria inicial y preparacion

### Realizado

- Leido `/opt/zabbix-codex/AGENTS.md`; ya existia y no fue modificado.
- Creada estructura base del proyecto:
  - `/opt/zabbix-codex/scripts`
  - `/opt/zabbix-codex/reports`
  - `/opt/zabbix-codex/templates`
  - `/opt/zabbix-codex/inventory`
- Creado script auxiliar `/opt/zabbix-codex/scripts/zabbix_api_test.py`.
- Validada sintaxis del script con `python3 -m py_compile`.
- Ejecutada auditoria de sistema, paquetes, servicios, puertos, firewall, base de datos, frontend y API.
- Creado informe `/opt/zabbix-codex/reports/initial-audit.md`.

### Hallazgos principales

- Zabbix server/agent/frontend instalados en version `7.0.26`.
- Servicios `zabbix-server`, `zabbix-agent`, `nginx`, `php-fpm` y `mariadb` activos y habilitados.
- API local disponible en `http://127.0.0.1/api_jsonrpc.php`, con version `7.0.26`.
- `ZABBIX_URL` en `/etc/zabbix-codex/zabbix.env` apunta a `https://TU-ZABBIX/zabbix/api_jsonrpc.php`, que no resuelve.
- `ZABBIX_TOKEN` existe, pero no valida contra el endpoint local.
- `codexops` no puede leer `/etc/zabbix-codex/zabbix.env` sin `sudo` por permisos del directorio padre.
- No se borraron ficheros, no se reiniciaron servicios y no se modifico configuracion de Zabbix.

### Comandos principales

```bash
cat /etc/os-release
hostnamectl
ip -brief addr
id
rpm -qa 'zabbix*' 'php*' 'httpd*' 'nginx*' 'mariadb*' 'mysql*' 'postgresql*' | sort
bash -lc 'for b in zabbix_server zabbix_proxy zabbix_agentd zabbix_agent2; do if command -v "$b" >/dev/null 2>&1; then "$b" -V 2>&1 | sed -n "1,4p"; fi; done'
systemctl --no-pager --plain list-units --type=service --all 'zabbix*' 'nginx*' 'php-fpm*' 'mariadb*' 'mysql*' 'httpd*'
systemctl --no-pager --plain is-active zabbix-server zabbix-agent nginx php-fpm mariadb
systemctl --no-pager --plain is-enabled zabbix-server zabbix-agent nginx php-fpm mariadb
ss -lntup
sudo -n firewall-cmd --list-all
sudo -n mariadb -NBe 'SELECT VERSION(); SHOW DATABASES LIKE "zabbix";'
sudo -n mariadb -NBe 'SELECT mandatory,optional FROM zabbix.dbversion;'
curl --max-time 5 -sS -X POST -H 'Content-Type: application/json-rpc' -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}' http://127.0.0.1/api_jsonrpc.php
sudo -n python3 -c 'import importlib.util; spec=importlib.util.spec_from_file_location("zapi", "scripts/zabbix_api_test.py"); z=importlib.util.module_from_spec(spec); spec.loader.exec_module(z); env=z.load_env(z.ENV_FILE); token=env.get("ZABBIX_TOKEN", ""); url="http://127.0.0.1/api_jsonrpc.php"; version=z.json_rpc(url, "apiinfo.version"); sample=z.json_rpc(url, "host.get", {"output": ["hostid", "host"], "limit": 1}, token=token); print(f"Local API version: {version}"); print(f"Token validation against local endpoint: OK ({len(sample)} sample host(s))")'
python3 -m py_compile scripts/zabbix_api_test.py
python3 scripts/zabbix_api_test.py
sudo -n python3 scripts/zabbix_api_test.py
```

## 2026-05-20 14:44 CEST - Auditoria de cobertura Zabbix

### Realizado

- Ejecutada validacion API con `/opt/zabbix-codex/scripts/zabbix_api_test.py`.
- Creado script read-only `/opt/zabbix-codex/scripts/audit_zabbix_coverage.py`.
- Validada sintaxis del script con `python3 -m py_compile`.
- Ejecutada auditoria completa de cobertura usando `ZABBIX_URL` y `ZABBIX_TOKEN` desde `/etc/zabbix-codex/zabbix.env`.
- Generado informe Markdown `/opt/zabbix-codex/reports/zabbix-coverage-report.md`.
- Generado informe JSON `/opt/zabbix-codex/reports/zabbix-coverage-report.json`.
- Corregida la auditoria para evitar ordenaciones API no permitidas en `item.get`, `problem.get` y `mediatype.get`; la ordenacion necesaria queda en cliente.
- No se borraron ficheros, no se reiniciaron servicios y no se modificaron hosts, templates, items, triggers, acciones ni configuracion de Zabbix.

### Resultado resumido

- Hosts analizados: `49` (`49` enabled, `0` disabled).
- Templates analizados: `362`.
- Items analizados: `12776` (`12744` enabled, `32` disabled).
- Triggers analizados: `5428` (`5349` enabled, `79` disabled).
- Problemas activos: `58`.
- Problemas por severidad: `0` Disaster, `1` High, `20` Average, `20` Warning, `17` Information.
- Items unsupported enabled: `83`.
- Hosts con items unsupported: `23`.
- Hosts con muchos items unsupported: `3`.
- Hosts sin datos recientes: `5`.
- Hosts sin templates: `0`.
- Hosts sin items activos: `0`.
- Hosts sin triggers habilitados: `0`.
- Proxmox: detectado como monitorizado, con `358` items relacionados, `83` triggers, `1325` items storage/datastore y `52` evidencias Ceph.
- Backups: estado `partial_or_good`, con `64` items relacionados y `26` triggers.
- Salud del propio Zabbix: host `Zabbix server` enabled, agente `available`, `160` items activos, `88` triggers habilitados, `13` items unsupported.
- Errores API finales: `0`.

### Comandos principales

```bash
python3 scripts/zabbix_api_test.py
python3 -m py_compile scripts/audit_zabbix_coverage.py
python3 scripts/audit_zabbix_coverage.py
python3 -c 'import json; d=json.load(open("reports/zabbix-coverage-report.json")); summary={"hosts": d["inventory"]["hosts_total"], "enabled": d["inventory"]["hosts_enabled"], "templates": d["inventory"]["templates_total"], "problems": d["problems"]["by_severity"], "coverage_counts": {k: len(v) for k,v in d["coverage"].items() if isinstance(v, list)}, "items": {k: d["items"][k] for k in ["total","enabled","disabled","unsupported_total","unsupported_enabled"]}, "triggers": {k: d["triggers"][k] for k in ["total","enabled","disabled"]}, "proxmox": {k: d["proxmox"][k] for k in ["appears_monitored","items_count","triggers_count","storage_items_count","backup_items_count","ceph_entities_count"]}, "backups": {k: d["backups"][k] for k in ["status","items_count","triggers_count"]}, "internal": {k: d["internal_health"].get(k) for k in ["zabbix_server_host_found","agent_availability","active_item_count","enabled_trigger_count","unsupported_item_count"]}, "api_errors": d["api_errors"]}; print(json.dumps(summary, indent=2, ensure_ascii=False))'
sed -n '1,260p' reports/zabbix-coverage-report.md
```

## 2026-05-20 15:58 CEST - Fase 3, plan de correccion de monitorizacion

### Realizado

- Creado script read-only `/opt/zabbix-codex/scripts/plan_zabbix_remediation.py`.
- El script lee `ZABBIX_URL` y `ZABBIX_TOKEN` desde `/etc/zabbix-codex/zabbix.env` sin imprimir el token.
- Ejecutada validacion de sintaxis con `python3 -m py_compile`.
- Ejecutado el plan contra la API local de Zabbix.
- Generado informe Markdown `/opt/zabbix-codex/reports/zabbix-remediation-plan.md`.
- Generado informe JSON `/opt/zabbix-codex/reports/zabbix-remediation-plan.json`.
- Validado que el JSON generado es parseable.
- No se borraron ficheros, no se reiniciaron servicios y no se modificaron hosts, templates, items, triggers, acciones ni configuracion de Zabbix.

### Resultado resumido

- Hosts enabled analizados: `49`.
- Templates analizados: `362`.
- Items host analizados: `3982`.
- Items unsupported enabled: `83`.
- Hosts con unsupported: `22`.
- Problemas activos en el momento de ejecucion: `59`.
- Problemas por severidad: `1` High, `20` Average, `21` Warning, `17` Information.
- Triggers deshabilitados: `79`.
- Hosts sin datos recientes: `5`.
- Diagnostico High SMART: `NasAlmeria`, `Faulty SMART state of HDD 5`, operational data `Current state: Abnormal (2)`.
- El item asociado `HDD 5: SMART Status` devuelve datos y ultimo valor `2`, por lo que parece fallo fisico/SMART real reportado por NAS, no falta de datos ni error de consulta.
- El trigger asociado `25766` aparece actualmente deshabilitado; no se ha modificado.
- Causas de unsupported: `28` SNMP OID no encontrada, `25` dependencia de template, `30` otro.
- Hosts mas afectados por unsupported: `Zabbix server` (`13`), `EATON 5PX 2200 ( SAI GALLARZA )` (`10`), `EATON 5PX 2200 SAI ALMERIA` (`10`), `NasGenomica` (`8`), `ZEBRA ALMERIA` (`5`), `NasAlmeria` (`4`).
- Proxmox: `4` hosts relacionados, `3` templates relacionados, `2` items directos y `11` triggers directos; se recomienda comparar contra Proxmox API/PBS para cerrar huecos de VMs/datastores/nodos.
- Backups: `10` items y `26` triggers relacionados; `3` hosts con evidencia directa y `21` hosts criticos sin evidencia directa en Zabbix.
- Errores API finales: `0`.

### Comandos principales

```bash
python3 scripts/zabbix_api_test.py
chmod 0755 scripts/plan_zabbix_remediation.py
python3 -m py_compile scripts/plan_zabbix_remediation.py
python3 scripts/plan_zabbix_remediation.py
python3 -c 'import json; json.load(open("reports/zabbix-remediation-plan.json")); print("json ok")'
sed -n '1,180p' reports/zabbix-remediation-plan.md
sed -n '180,360p' reports/zabbix-remediation-plan.md
```

## 2026-05-20 16:16 CEST - Fase 4A, diagnostico read-only por bloques

### Realizado

- Creado directorio `/opt/zabbix-codex/diagnostics`.
- Creado script read-only `/opt/zabbix-codex/scripts/diagnose_unsupported_blocks.py`.
- Creado script read-only `/opt/zabbix-codex/scripts/zabbix_problem_detail.py`.
- Ambos scripts leen `ZABBIX_URL` y `ZABBIX_TOKEN` desde `/etc/zabbix-codex/zabbix.env` sin imprimir el token.
- Ejecutada validacion de sintaxis con `python3 -m py_compile`.
- Ejecutado diagnostico por bloques de items unsupported.
- Ejecutado detalle de problemas filtrado por `NasAlmeria`.
- Validado que `/opt/zabbix-codex/reports/unsupported-blocks-summary.json` es JSON parseable.
- No se borraron ficheros, no se reiniciaron servicios y no se modificaron hosts, templates, items, triggers, macros, acciones ni configuracion de Zabbix.

### Informes generados

- `/opt/zabbix-codex/reports/unsupported-zabbix-internal.md`
- `/opt/zabbix-codex/reports/unsupported-eaton-sai.md`
- `/opt/zabbix-codex/reports/unsupported-nas-qnap.md`
- `/opt/zabbix-codex/reports/unsupported-printers-snmp.md`
- `/opt/zabbix-codex/reports/unsupported-other.md`
- `/opt/zabbix-codex/reports/unsupported-blocks-summary.json`

### Resultado resumido

- Items unsupported enabled analizados: `83`.
- Reparto por bloques:
  - `zabbix_internal`: `13`
  - `eaton_sai`: `20`
  - `nas_qnap`: `21`
  - `printers_snmp`: `20`
  - `other`: `9`
- Problemas activos leidos durante esta fase: `58`.
- Triggers deshabilitados detectados: `79`.
- Impresoras sin datos recientes: `5`.
- Errores API finales: `0`.
- NasAlmeria:
  - Problema High `Faulty SMART state of HDD 5`.
  - Item `HDD 5: SMART Status`, key `hdd.status[5]`, ultimo valor `2`.
  - Interfaz SNMP `192.168.102.234:161`.
  - Historial reciente mantiene valor `2`, por lo que sigue pareciendo fallo SMART/fisico real reportado por NAS, no fallo de Zabbix.
  - Tambien aparece Warning activo de pool: `Reaching threshold for pool 1 (<15%)`, operational data `Current %: 0`.
- SAIs Eaton:
  - `EATON 5PX 2200 ( SAI GALLARZA )`: `10` unsupported, SNMP `192.168.100.24:161`.
  - `EATON 5PX 2200 SAI ALMERIA`: `10` unsupported, SNMP `192.168.102.235:161`.
  - Causa dominante: OIDs SNMP no soportadas por el agente; probable MIB/modelo/firmware o template no ajustado.
- Zabbix internal:
  - `13` unsupported en `Zabbix server`.
  - Principalmente procesos internos no arrancados/no usados: IPMI, Java, SNMP trapper, VMware, report, connectors.
  - Tambien `system.sw.packages.get` y velocidad de interfaz `enp6s18`.
- Impresoras:
  - `20` unsupported en bloque printers.
  - `5` impresoras sin datos recientes con interfaz SNMP unavailable.

### Comandos principales

```bash
mkdir -p diagnostics
chmod 0755 scripts/diagnose_unsupported_blocks.py scripts/zabbix_problem_detail.py
python3 -m py_compile scripts/diagnose_unsupported_blocks.py
python3 -m py_compile scripts/zabbix_problem_detail.py
python3 scripts/diagnose_unsupported_blocks.py
python3 scripts/zabbix_problem_detail.py --host NasAlmeria
python3 -c 'import json; d=json.load(open("reports/unsupported-blocks-summary.json")); print("json ok"); print(json.dumps(d["summary"], indent=2, ensure_ascii=False))'
grep -n '^## ' reports/unsupported-zabbix-internal.md reports/unsupported-eaton-sai.md reports/unsupported-nas-qnap.md reports/unsupported-printers-snmp.md reports/unsupported-other.md
```

## 2026-05-20 22:02 CEST - Fase 4B, preparacion de datos para agente inteligente

### Realizado

- Creado directorio `/opt/zabbix-codex/agent_knowledge`.
- Creados scripts read-only:
  - `/opt/zabbix-codex/scripts/snmp_diagnose_device.py`
  - `/opt/zabbix-codex/scripts/snmp_walk_known_devices.py`
  - `/opt/zabbix-codex/scripts/zabbix_get_diagnose.py`
  - `/opt/zabbix-codex/scripts/build_agent_knowledge_base.py`
- Ejecutado diagnostico SNMP externo read-only contra dispositivos ya conocidos en Zabbix.
- Ejecutado diagnostico local read-only con `zabbix_get` contra el agente del propio Zabbix server.
- Creada base de conocimiento inicial del futuro agente:
  - `/opt/zabbix-codex/agent_knowledge/infrastructure_summary.json`
  - `/opt/zabbix-codex/agent_knowledge/infrastructure_summary.md`
  - `/opt/zabbix-codex/agent_knowledge/monitoring_gaps.json`
  - `/opt/zabbix-codex/agent_knowledge/alert_policy_draft.md`
  - `/opt/zabbix-codex/agent_knowledge/agent_daily_report_prompt.md`
- Generados informes:
  - `/opt/zabbix-codex/reports/external-readonly-diagnostics.md`
  - `/opt/zabbix-codex/reports/agent-readiness-report.md`
  - `/opt/zabbix-codex/reports/monitoring-implementation-roadmap.md`
- Generados JSON auxiliares:
  - `/opt/zabbix-codex/diagnostics/snmp-known-devices.json`
  - `/opt/zabbix-codex/diagnostics/zabbix-get-local.json`
- Validada sintaxis con `python3 -m py_compile`.
- Validado que los JSON generados son parseables.
- Comprobado que el token de Zabbix no aparece en los ficheros generados y que las macros SNMP visibles quedan enmascaradas.
- No se borraron ficheros, no se reiniciaron servicios y no se modificaron hosts, templates, items, triggers, macros, acciones ni configuracion de Zabbix.

### Resultado resumido

- Hosts incorporados a la base de conocimiento: `49`.
- Templates detectados: `362`.
- Items detectados: `12776`.
- Triggers detectados: `5428`.
- Problemas activos actuales: `59` (`1` High, `20` Average, `21` Warning, `17` Information).
- Items enabled unsupported: `83`.
- Estado de preparacion del agente: `partial`.
- Hosts que requieren accion humana segun la base de conocimiento: `31`.
- Hosts con cambios potencialmente automatizables: `27`.
- Diagnostico SNMP externo: `18` targets, `9` reachable, `9` not reachable.
- SNMP base responde en NasAlmeria, NasGenomica, ambos SAIs Eaton, HP V1810-48G, Zebra Almeria y tres impresoras.
- Las OIDs fallidas en NAS/Eaton/switch apuntan a mismatch de template/MIB/modelo, no a caida SNMP general.
- Cinco impresoras priorizadas no responden a SNMP por timeout/red/ACL/equipo.
- `zabbix_get` local: `12/13` checks OK; `system.sw.packages.get` falla con `ZBX_NOTSUPPORTED: Cannot obtain package information`.
- NasAlmeria sigue marcado como `CRITICO`: SMART HDD 5 High, pool al `0%` y nueva alerta Warning de latencia de disco alta.

### Comandos principales

```bash
mkdir -p agent_knowledge diagnostics scripts reports
python3 -m py_compile scripts/snmp_diagnose_device.py
python3 -m py_compile scripts/snmp_walk_known_devices.py
python3 -m py_compile scripts/zabbix_get_diagnose.py
python3 -m py_compile scripts/build_agent_knowledge_base.py
chmod 0755 scripts/snmp_diagnose_device.py scripts/snmp_walk_known_devices.py scripts/zabbix_get_diagnose.py scripts/build_agent_knowledge_base.py
python3 scripts/snmp_walk_known_devices.py
python3 scripts/zabbix_get_diagnose.py
python3 scripts/build_agent_knowledge_base.py
python3 -c 'import json, pathlib; files=["diagnostics/snmp-known-devices.json","diagnostics/zabbix-get-local.json","agent_knowledge/infrastructure_summary.json","agent_knowledge/monitoring_gaps.json"]; [json.load(open(f)) for f in files]; print("json ok", len(files))'
python3 -c 'from pathlib import Path; files=["agent_knowledge/infrastructure_summary.md","agent_knowledge/alert_policy_draft.md","agent_knowledge/agent_daily_report_prompt.md","reports/external-readonly-diagnostics.md","reports/agent-readiness-report.md","reports/monitoring-implementation-roadmap.md"]; missing=[f for f in files if not Path(f).is_file() or Path(f).stat().st_size==0]; print("markdown ok" if not missing else "missing/empty: "+", ".join(missing))'
python3 -c 'import importlib.util, pathlib; spec=importlib.util.spec_from_file_location("zbx","scripts/plan_zabbix_remediation.py"); zbx=importlib.util.module_from_spec(spec); spec.loader.exec_module(zbx); env=zbx.load_env(zbx.ENV_FILE); token=env.get("ZABBIX_TOKEN",""); files=[pathlib.Path(p) for p in ["diagnostics/snmp-known-devices.json","diagnostics/zabbix-get-local.json","agent_knowledge/infrastructure_summary.json","agent_knowledge/monitoring_gaps.json","agent_knowledge/infrastructure_summary.md","agent_knowledge/alert_policy_draft.md","agent_knowledge/agent_daily_report_prompt.md","reports/external-readonly-diagnostics.md","reports/agent-readiness-report.md","reports/monitoring-implementation-roadmap.md"]]; hits=[]; [hits.append(str(f)) for f in files if token and token in f.read_text(encoding="utf-8")]; print("token scan ok" if not hits else "token found in "+", ".join(hits))'
python3 -c 'import json; d=json.load(open("diagnostics/snmp-known-devices.json")); bad=[]; [bad.append((r.get("host",{}).get("name"), m.get("macro"))) for r in d["diagnostics"] for m in (r.get("snmp_macros_visible_masked") or []) if m.get("value") and not str(m.get("value")).startswith("<masked")]; print("snmp macro masking ok" if not bad else "unmasked macros: "+str(bad))'
```

## 2026-05-20 22:13 CEST - Fase 5A, Proxmox, storage y backups read-only

### Realizado

- Creada estructura:
  - `/opt/zabbix-codex/proxmox`
  - `/opt/zabbix-codex/backups`
  - `/opt/zabbix-codex/templates/drafts/proxmox`
  - `/opt/zabbix-codex/templates/drafts/backups`
  - `/opt/zabbix-codex/agent_knowledge`
  - `/opt/zabbix-codex/reports`
  - `/opt/zabbix-codex/scripts`
- Creado fichero de ejemplo sin secretos reales `/opt/zabbix-codex/proxmox/proxmox.env.example`.
- Comprobado que no existe `/etc/zabbix-codex/proxmox.env`; no hay acceso real a Proxmox/PBS en esta ejecucion.
- Creados scripts read-only:
  - `/opt/zabbix-codex/scripts/proxmox_inventory_readonly.py`
  - `/opt/zabbix-codex/scripts/pbs_inventory_readonly.py`
  - `/opt/zabbix-codex/scripts/compare_zabbix_proxmox_backups.py`
- Ejecutados inventarios Proxmox/PBS en modo placeholder por falta de credenciales.
- Ejecutada comparacion contra Zabbix API en modo read-only.
- Generados inventarios:
  - `/opt/zabbix-codex/proxmox/proxmox-real-inventory.json`
  - `/opt/zabbix-codex/proxmox/proxmox-real-inventory.md`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.json`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.md`
- Generado analisis:
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.json`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.md`
  - `/opt/zabbix-codex/reports/phase-5a-proxmox-backups-readiness.md`
- Actualizada base de conocimiento:
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.json`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_alert_policy.md`
- Creados templates draft no importados ni asignados:
  - `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_agent_intelligent.yaml`
  - `/opt/zabbix-codex/templates/drafts/backups/template_backup_intelligent.yaml`
  - `/opt/zabbix-codex/templates/drafts/backups/template_pbs_intelligent.yaml`
- Validada sintaxis Python con `python3 -m py_compile`.
- Validado JSON generado.
- Comprobado que el token de Zabbix no aparece en los ficheros generados.
- No hay parser YAML disponible en Python (`PyYAML` no instalado), por lo que no se ejecuto validacion YAML con parser.
- No se borraron ficheros, no se reiniciaron servicios y no se modificaron hosts, templates, items, triggers, macros, acciones ni configuracion de Zabbix/Proxmox/PBS.

### Resultado resumido

- Acceso real Proxmox API: `False`.
- Acceso real PBS API: `False`.
- Nodos reales detectados: `0` por falta de credenciales.
- VMs/LXCs reales detectadas: `0` por falta de credenciales.
- Entidades PBS con backup detectadas: `0` por falta de credenciales.
- Datos obtenidos desde Zabbix:
  - Hosts Proxmox: `2` (`proxmox-gallarza`, `proxmoxalmeria`).
  - Hosts tipo VM/servidor: `18`.
  - Items storage relacionados: `564`.
  - Items backup relacionados: `55`.
  - Triggers backup relacionados: `69`.
  - Hosts criticos sin backup verificable: `21`.
- Gaps prioritarios:
  - Falta acceso read-only a Proxmox API.
  - Falta acceso read-only a PBS API.
  - `21` hosts criticos sin evidencia directa de backup.
  - Servicios Proxmox sin check claro: `pveproxy`, `pvedaemon`, `pvestatd`, `corosync`.

### Comandos principales

```bash
test -f /etc/zabbix-codex/proxmox.env; echo $?
mkdir -p proxmox backups templates/drafts/proxmox templates/drafts/backups agent_knowledge reports scripts
python3 -m py_compile scripts/proxmox_inventory_readonly.py
python3 -m py_compile scripts/pbs_inventory_readonly.py
python3 -m py_compile scripts/compare_zabbix_proxmox_backups.py
chmod 0755 scripts/proxmox_inventory_readonly.py scripts/pbs_inventory_readonly.py scripts/compare_zabbix_proxmox_backups.py
python3 scripts/proxmox_inventory_readonly.py
python3 scripts/pbs_inventory_readonly.py
python3 scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import json; files=["proxmox/proxmox-real-inventory.json","backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json"]; [json.load(open(f)) for f in files]; print("json ok", len(files))'
python3 -c 'import importlib.util; print("yaml_available", importlib.util.find_spec("yaml") is not None)'
rg -n 'host\.(create|update|delete|mass|prototype)|template\.(create|update|delete|mass)|item\.(create|update|delete|mass)|trigger\.(create|update|delete|mass)|action\.(create|update|delete)|problem\.(close|acknowledge)|method="(POST|PUT|DELETE|PATCH)"|method='\''(POST|PUT|DELETE|PATCH)'\''' scripts/proxmox_inventory_readonly.py scripts/pbs_inventory_readonly.py scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import importlib.util, pathlib; spec=importlib.util.spec_from_file_location("zbx","scripts/plan_zabbix_remediation.py"); zbx=importlib.util.module_from_spec(spec); spec.loader.exec_module(zbx); token=zbx.load_env(zbx.ENV_FILE).get("ZABBIX_TOKEN",""); files=["proxmox/proxmox-real-inventory.json","backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json","agent_knowledge/proxmox_backup_knowledge.md","reports/phase-5a-proxmox-backups-readiness.md","reports/proxmox-backup-gap-analysis.md"]; hits=[]; [hits.append(f) for f in files if token and token in pathlib.Path(f).read_text(encoding="utf-8")]; print("token scan ok" if not hits else "token found in "+", ".join(hits))'
```

## 2026-05-20 22:42 CEST - Fase 5A repetida con acceso real Proxmox

### Realizado

- Confirmado que existe `/etc/zabbix-codex/proxmox.env`.
- Ejecutado inventario real Proxmox en modo read-only.
- Ejecutado inventario PBS en modo read-only.
- Ejecutada comparacion Zabbix vs Proxmox/PBS en modo read-only.
- Actualizados:
  - `/opt/zabbix-codex/proxmox/proxmox-real-inventory.json`
  - `/opt/zabbix-codex/proxmox/proxmox-real-inventory.md`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.json`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.md`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.json`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.md`
  - `/opt/zabbix-codex/reports/phase-5a-proxmox-backups-readiness.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.json`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.md`
- Corregida clasificacion del script PBS para marcar como `access=False` cuando la API devuelve autenticacion fallida.
- Ampliada comparacion para incluir jobs Proxmox backup, tareas fallidas, VMs sin job de backup, VMs sin backup individual OK reciente y hosts Zabbix tipo VM/servidor no encontrados en Proxmox real.
- Validado JSON generado.
- Comprobado que no se han guardado tokens ni secretos de Proxmox/PBS en los informes generados.
- No se modifico Proxmox, PBS ni Zabbix.

### Resultado resumido

- Proxmox API: `OK`.
- PBS API: `ERROR`, `HTTP 401: authentication failed - user account or token disabled or expired`.
- Nodos Proxmox reales: `2` (`pvereplicas`, `proxmox-gallarza`).
- VMs reales: `16`.
- LXCs reales: `0`.
- Storages reales: `8`.
- Jobs Proxmox backup: `2`.
- Tareas Proxmox backup recientes con error: `9`.
- VMs/LXCs sin job Proxmox backup: `1` (`ia-dify`, VMID `114`).
- VMs/LXCs sin backup individual OK en ultimas 48h segun tareas disponibles: `15`.
- Nodo real ausente en Zabbix: `pvereplicas`.
- VMs/LXCs reales ausentes en Zabbix por nombre directo: `11`.
- Hosts Zabbix tipo VM/servidor no encontrados en Proxmox real: `12`.
- Storages reales sin check de capacidad detectable: `6`.
- Datastores reales sin trigger de espacio detectable: `8`.
- Hosts criticos sin backup verificable desde Zabbix: `21`.

### Comandos principales

```bash
test -f /etc/zabbix-codex/proxmox.env; echo $?
python3 -m py_compile scripts/proxmox_inventory_readonly.py
python3 -m py_compile scripts/pbs_inventory_readonly.py
python3 -m py_compile scripts/compare_zabbix_proxmox_backups.py
python3 scripts/proxmox_inventory_readonly.py
python3 scripts/pbs_inventory_readonly.py
python3 scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import json; files=["proxmox/proxmox-real-inventory.json","backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json"]; [json.load(open(f)) for f in files]; print("json ok", len(files))'
rg -n 'host\.(create|update|delete|mass|prototype)|template\.(create|update|delete|mass)|item\.(create|update|delete|mass)|trigger\.(create|update|delete|mass)|action\.(create|update|delete)|problem\.(close|acknowledge)|method="(POST|PUT|DELETE|PATCH)"|method='\''(POST|PUT|DELETE|PATCH)'\''' scripts/proxmox_inventory_readonly.py scripts/pbs_inventory_readonly.py scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import importlib.util, pathlib; spec=importlib.util.spec_from_file_location("zbx","scripts/plan_zabbix_remediation.py"); zbx=importlib.util.module_from_spec(spec); spec.loader.exec_module(zbx); token=zbx.load_env(zbx.ENV_FILE).get("ZABBIX_TOKEN",""); files=["proxmox/proxmox-real-inventory.json","backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json","agent_knowledge/proxmox_backup_knowledge.md","reports/phase-5a-proxmox-backups-readiness.md","reports/proxmox-backup-gap-analysis.md"]; hits=[]; [hits.append(f) for f in files if token and token in pathlib.Path(f).read_text(encoding="utf-8")]; print("token scan ok" if not hits else "token found in "+", ".join(hits))'
python3 -c "from pathlib import Path; vals={}; lines=Path('/etc/zabbix-codex/proxmox.env').read_text(encoding='utf-8').splitlines(); [vals.setdefault(k.strip(), v.strip().strip(chr(34)).strip(chr(39))) for line in lines if (line.strip() and not line.strip().startswith('#') and '=' in line) for k,v in [line.split('=',1)] if v.strip() and any(x in k.strip() for x in ['TOKEN','SECRET','PASSWORD'])]; files=['proxmox/proxmox-real-inventory.json','backups/pbs-real-inventory.json','reports/proxmox-backup-gap-analysis.json','agent_knowledge/proxmox_backup_knowledge.json','agent_knowledge/proxmox_backup_knowledge.md','reports/phase-5a-proxmox-backups-readiness.md','reports/proxmox-backup-gap-analysis.md']; hits=[]; [hits.append((f,k)) for f in files for k,v in vals.items() if v and v in Path(f).read_text(encoding='utf-8')]; print('proxmox/pbs secret scan ok' if not hits else 'secret value found for keys: '+str(hits))"
```

## 2026-05-21 08:01 CEST - Correccion autenticacion PBS read-only

### Realizado

- Revisado `/opt/zabbix-codex/scripts/pbs_inventory_readonly.py`.
- Confirmado que el script debe usar exactamente:
  - `Authorization: PBSAPIToken=<PBS_TOKEN_ID>:<PBS_TOKEN_SECRET>`
- Extraida la construccion de la cabecera a `pbs_auth_header()` y anadido formato enmascarado en metadata.
- Confirmado que el parser del script lee los mismos valores que `source /etc/zabbix-codex/proxmox.env` mediante comparacion de longitudes y hashes, sin imprimir secretos.
- Ejecutado inventario PBS read-only.
- Ejecutada comparacion Zabbix/Proxmox/PBS read-only.
- Actualizados:
  - `/opt/zabbix-codex/backups/pbs-real-inventory.json`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.md`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.md`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.json`
  - `/opt/zabbix-codex/reports/phase-5a-proxmox-backups-readiness.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.json`
- Validado JSON generado.
- Validado que no se han guardado tokens ni secretos Proxmox/PBS en informes.
- No se modifico PBS, Proxmox ni Zabbix.

### Resultado resumido

- PBS `/version`: `OK`, version `4.1`.
- PBS inventario completo: permisos parciales.
- Primer error de permisos: `/nodes` devuelve `HTTP 403: permission check failed`.
- Datastores PBS detectados por API PBS directa: `0`.
- Snapshots PBS detectados por API PBS directa: `0`.
- Entidades con backup PBS detectadas por API PBS directa: `0`.
- El acceso Proxmox sigue operativo y muestra `2` jobs de backup, `9` tareas recientes de backup con error, `1` VM sin job de backup (`ia-dify`) y `15` VMs sin backup individual OK en ultimas 48h segun tareas disponibles.

### Comandos principales

```bash
python3 -m py_compile scripts/pbs_inventory_readonly.py
python3 scripts/pbs_inventory_readonly.py
python3 scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import json; files=["backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json"]; [json.load(open(f)) for f in files]; print("json ok", len(files))'
python3 -c "from pathlib import Path; vals={}; lines=Path('/etc/zabbix-codex/proxmox.env').read_text(encoding='utf-8').splitlines(); [vals.setdefault(k.strip(), v.strip().strip(chr(34)).strip(chr(39))) for line in lines if (line.strip() and not line.strip().startswith('#') and '=' in line) for k,v in [line.split('=',1)] if v.strip() and any(x in k.strip() for x in ['TOKEN','SECRET','PASSWORD'])]; files=['backups/pbs-real-inventory.json','backups/pbs-real-inventory.md','reports/proxmox-backup-gap-analysis.json','reports/proxmox-backup-gap-analysis.md','reports/phase-5a-proxmox-backups-readiness.md','agent_knowledge/proxmox_backup_knowledge.json','agent_knowledge/proxmox_backup_knowledge.md']; hits=[]; [hits.append((f,k)) for f in files for k,v in vals.items() if v and v in Path(f).read_text(encoding='utf-8')]; print('proxmox/pbs secret scan ok' if not hits else 'secret value found: '+str(hits))"
```

## 2026-05-21 08:49 CEST - Inventario PBS real por datastores

### Realizado

- Corregido `/opt/zabbix-codex/scripts/pbs_inventory_readonly.py` para usar como fuentes principales:
  - `/api2/json/version`
  - `/api2/json/admin/datastore`
  - `/api2/json/config/datastore`
- Tratado `/api2/json/nodes` como endpoint opcional; si devuelve `403`, se registra en `permissions_missing` sin bloquear el inventario.
- Fusionados datastores desde `admin/datastore` y `config/datastore`.
- Anadido inventario por datastore con:
  - `status`
  - `groups`
  - `snapshots`
  - `gc`
  - `prune`
  - `verify`
  - `endpoint_access`
- Anadidos campos:
  - `permissions_missing`
  - `endpoint_not_available`
  - `warnings`
  - `datastores_detected`
- Regenerados:
  - `/opt/zabbix-codex/backups/pbs-real-inventory.json`
  - `/opt/zabbix-codex/backups/pbs-real-inventory.md`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.md`
  - `/opt/zabbix-codex/reports/proxmox-backup-gap-analysis.json`
  - `/opt/zabbix-codex/reports/phase-5a-proxmox-backups-readiness.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.json`
- Validado JSON generado.
- Validado que no se han guardado secretos Proxmox/PBS en los informes.
- No se modifico PBS, Proxmox ni Zabbix.

### Resultado resumido

- PBS API: `OK`.
- PBS version: `4.1`.
- Datastores PBS detectados: `2`.
  - `backup`, path `/mnt/pbs-iscsi`, uso `32.8%`, groups `16`, snapshots `285`.
  - `ds-qnap-iscsi-almeria`, path `/mnt/pbs-iscsi-almeria`, uso `19.8%`, groups `7`, snapshots `184`.
- Entidades PBS con backup: `16`.
- Snapshots PBS totales: `469`.
- Backup antiguo detectado: `vm/114`, ultimo backup `2026-05-13 15:27:47 CEST`.
- VM sin job de backup Proxmox: `ia-dify` (`VMID 114`).
- Endpoint bloqueado por permisos:
  - `/nodes`, `HTTP 403 permission check failed` (opcional para esta fase).
- Endpoints no disponibles (`404`):
  - `/admin/datastore/backup/prune`
  - `/admin/datastore/backup/verify`
  - `/admin/datastore/ds-qnap-iscsi-almeria/prune`
  - `/admin/datastore/ds-qnap-iscsi-almeria/verify`

### Comandos principales

```bash
python3 -m py_compile scripts/pbs_inventory_readonly.py
python3 scripts/pbs_inventory_readonly.py
python3 -m py_compile scripts/compare_zabbix_proxmox_backups.py
python3 scripts/compare_zabbix_proxmox_backups.py
python3 -c 'import json; files=["backups/pbs-real-inventory.json","reports/proxmox-backup-gap-analysis.json","agent_knowledge/proxmox_backup_knowledge.json"]; [json.load(open(f)) for f in files]; print("json ok", len(files))'
python3 -c "from pathlib import Path; vals={}; lines=Path('/etc/zabbix-codex/proxmox.env').read_text(encoding='utf-8').splitlines(); [vals.setdefault(k.strip(), v.strip().strip(chr(34)).strip(chr(39))) for line in lines if (line.strip() and not line.strip().startswith('#') and '=' in line) for k,v in [line.split('=',1)] if v.strip() and any(x in k.strip() for x in ['TOKEN','SECRET','PASSWORD'])]; files=['backups/pbs-real-inventory.json','backups/pbs-real-inventory.md','reports/proxmox-backup-gap-analysis.json','reports/proxmox-backup-gap-analysis.md','reports/phase-5a-proxmox-backups-readiness.md','agent_knowledge/proxmox_backup_knowledge.json','agent_knowledge/proxmox_backup_knowledge.md']; hits=[]; [hits.append((f,k)) for f in files for k,v in vals.items() if v and v in Path(f).read_text(encoding='utf-8')]; print('proxmox/pbs secret scan ok' if not hits else 'secret value found: '+str(hits))"
```

## 2026-05-21 09:24:55 CEST - Fase 5A-3 preparación de checks PBS/Proxmox

- Creado plan de implementación: `/opt/zabbix-codex/implementation_plans/phase-5a-3-backup-checks-plan.md` y `/opt/zabbix-codex/implementation_plans/phase-5a-3-backup-checks-plan.json`.
- Creados templates draft no importados:
  - `/opt/zabbix-codex/templates/drafts/backups/template_pbs_backup_monitoring_intelligent.yaml`
  - `/opt/zabbix-codex/templates/drafts/proxmox/template_proxmox_storage_monitoring_intelligent.yaml`
- Creados scripts dry-run:
  - `/opt/zabbix-codex/scripts/push_backup_metrics_to_zabbix.py`
  - `/opt/zabbix-codex/scripts/push_proxmox_storage_metrics_to_zabbix.py`
- Añadido `--refresh-inventory` a los scripts dry-run para refrescar inventarios con collectors read-only antes de preparar métricas cuando se autorice su uso operativo.
- Actualizada knowledge base:
  - `/opt/zabbix-codex/agent_knowledge/proxmox_backup_knowledge.md`
  - `/opt/zabbix-codex/agent_knowledge/proxmox_next_actions.md`
- Comandos principales:
  - `python3 scripts/prepare_zabbix_backup_checks.py`
  - `python3 -m py_compile scripts/prepare_zabbix_backup_checks.py scripts/push_backup_metrics_to_zabbix.py scripts/push_proxmox_storage_metrics_to_zabbix.py`
  - `python3 scripts/push_backup_metrics_to_zabbix.py --limit 5`
  - `python3 scripts/push_proxmox_storage_metrics_to_zabbix.py --limit 5`
- Cambios aplicados solo en ficheros locales de preparación; no se modificó Zabbix, Proxmox ni PBS.

## 2026-05-21 09:43:13 CEST - Fase 5A-4 hosts técnicos PBS/Proxmox

- Backup/precheck: `/opt/zabbix-codex/backups/zabbix-before-phase-5a-4.json` y `/opt/zabbix-codex/reports/phase-5a-4-precheck.md`.
- Informe final: `/opt/zabbix-codex/reports/phase-5a-4-zabbix-technical-hosts.md` y `/opt/zabbix-codex/reports/phase-5a-4-zabbix-technical-hosts.json`.
- Creados/verificados grupo `Intelligent Monitoring`, hosts `PBS Backup Monitoring` y `Proxmox Storage Monitoring`.
- Creados/verificados items trapper mínimos y triggers propios disabled.
- Envío real de prueba por protocolo nativo Zabbix sender: PBS `13/13` procesadas, Proxmox `9/9` procesadas, `0` fallidas.
- Verificación final: `22/22` items con `lastclock > 0`, `0` unsupported.
- No se crearon acciones de notificación.
- No se modificó Proxmox, PBS, VMs, jobs, templates existentes ni triggers existentes.
- Comandos principales:
  - `python3 scripts/implement_phase_5a_4_technical_hosts.py`
  - `python3 scripts/push_backup_metrics_to_zabbix.py --limit 20`
  - `python3 scripts/push_proxmox_storage_metrics_to_zabbix.py --limit 20`
  - `python3 scripts/push_backup_metrics_to_zabbix.py --send --limit 20`
  - `python3 scripts/push_proxmox_storage_metrics_to_zabbix.py --send --limit 20`
  - `python3 scripts/implement_phase_5a_4_technical_hosts.py --verify-only`

## 2026-05-21 09:57:27 CEST - Mapa global de infraestructura para agente Zabbix

- Creado script read-only: `/opt/zabbix-codex/scripts/build_global_infra_map.py`.
- Generados:
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.json`
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.md`
  - `/opt/zabbix-codex/reports/global-monitoring-readiness.md`
  - `/opt/zabbix-codex/reports/global-monitoring-roadmap.md`
- Actualizados:
  - `/opt/zabbix-codex/agent_knowledge/infrastructure_summary.md`
  - `/opt/zabbix-codex/agent_knowledge/monitoring_gaps.json`
- No se modificó Zabbix, Proxmox, PBS, hosts, templates, items, triggers, macros ni acciones.
- Comandos principales:
  - `python3 -m py_compile scripts/build_global_infra_map.py`
  - `python3 scripts/build_global_infra_map.py`
  - `python3 -m json.tool agent_knowledge/global_infrastructure_map.json`

## 2026-06-02 08:26:09 CEST - Soporte de firewalls / red perimetral en monitorización inteligente

- Criterios de clasificación ampliados para `host_type=firewall`:
  - host group con `firewall` o `firewalls`.
  - tags `role=firewall` o `type=firewall`.
  - inventory con texto `firewall`.
  - nombre, grupo o template con `firewall`, `fortigate`, `mikrotik`, `pfsense`, `sonicwall`, `checkpoint`, `palo alto` o `sophos`.
- Nueva categoría visible en el mapa global como `Firewalls / Red perimetral`.
- Validación real: 3 hosts detectados y clasificados como firewall:
  - `pfSense-almeria`
  - `pfSense-La-Plana`
  - `pfSenseGallarza`
- Métricas recomendadas para evaluación completa:
  - disponibilidad/ICMP, SNMP, interfaces WAN/LAN, tráfico, estado de interfaz, CPU, memoria, uptime, sesiones, VPN, HA, temperatura y firmware.
- Huecos de monitorización reflejados cuando faltan SNMP, plantillas o triggers para evaluación completa.
- Validado con regeneración read-only de:
  - `agent_knowledge/global_infrastructure_map.json`
  - `agent_knowledge/global_infrastructure_map.md`
  - `agent_knowledge/infrastructure_summary.json`
  - `agent_knowledge/infrastructure_summary.md`
  - `reports/global-monitoring-readiness.md`
  - `reports/global-monitoring-roadmap.md`
  - `python3 -m json.tool agent_knowledge/monitoring_gaps.json`

## 2026-05-21 10:59:00 CEST - Backend MCP read-only para Agente de Infraestructura

- Creado directorio `/opt/zabbix-codex/mcp-infra-agent`.
- Creado backend MCP/JSON-RPC read-only:
  - `/opt/zabbix-codex/mcp-infra-agent/server.py`
  - `/opt/zabbix-codex/mcp-infra-agent/tools.yaml`
  - `/opt/zabbix-codex/mcp-infra-agent/README.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/agent_instructions.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/security_model.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_agent_setup.md`
- Generado informe `/opt/zabbix-codex/reports/infra-agent-backend-design.md`.
- Herramientas diseñadas/implementadas: `get_infrastructure_overview`, `get_active_problems`, `get_critical_risks`, `get_backup_status`, `get_proxmox_status`, `get_nas_status`, `get_ups_status`, `get_printer_status`, `get_zabbix_internal_health`, `get_monitoring_gaps`, `get_global_infrastructure_map`, `generate_daily_report`.
- Placeholders creados sin integración activa: `sharepoint_search_assets`, `sharepoint_get_asset`, `apps_get_status`, `apps_get_database_health`.
- No se modificó Zabbix, Proxmox, PBS, SharePoint ni bases de datos.
- Comandos principales:
  - `python3 -m py_compile mcp-infra-agent/server.py`
  - `python3 mcp-infra-agent/server.py --list-tools`
  - `python3 mcp-infra-agent/server.py --call get_infrastructure_overview`
  - `python3 mcp-infra-agent/server.py --call get_active_problems --args '{"severity":"High","limit":5}'`
  - `python3 mcp-infra-agent/server.py --self-test`
  - `printf ... | python3 mcp-infra-agent/server.py --stdio`

## 2026-05-21 12:31:00 CEST - Preparación despliegue ChatGPT custom MCP app

- Actualizada documentación de conexión ChatGPT:
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_agent_setup.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/security_model.md`
  - `/opt/zabbix-codex/mcp-infra-agent/README.md`
- Creado wrapper HTTP read-only:
  - `/opt/zabbix-codex/mcp-infra-agent/remote_server.py`
- Creados ejemplos de despliegue:
  - `/opt/zabbix-codex/mcp-infra-agent/deploy/zabbix-infra-mcp.service.example`
  - `/opt/zabbix-codex/mcp-infra-agent/deploy/nginx-mcp-infra-agent.conf.example`
- Creado prompt final para Agent Builder:
  - `/opt/zabbix-codex/mcp-infra-agent/docs/agent_builder_prompt.md`
- Creado informe:
  - `/opt/zabbix-codex/reports/infra-agent-chatgpt-deployment-plan.md`
- Validado wrapper HTTP temporal en `127.0.0.1:8765` con `/healthz`, `/.well-known/mcp.json`, `tools/list` y `get_active_problems`.
- El wrapper temporal fue detenido tras las pruebas; no queda listener en `:8765`.
- No se modificó Zabbix, Proxmox, PBS, SharePoint ni bases de datos.
- Comandos principales:
  - `python3 -m py_compile mcp-infra-agent/server.py mcp-infra-agent/remote_server.py`
  - `python3 mcp-infra-agent/server.py --list-tools`
  - `python3 mcp-infra-agent/server.py --call get_infrastructure_overview`
  - `python3 mcp-infra-agent/remote_server.py --host 127.0.0.1 --port 8765`
  - `curl -sS http://127.0.0.1:8765/healthz`
  - `curl -sS http://127.0.0.1:8765/.well-known/mcp.json`
  - `curl -sS http://127.0.0.1:8765/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`
  - `curl -sS http://127.0.0.1:8765/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_active_problems","arguments":{"severity":"High","limit":2}}}'`

## 2026-05-21 12:44:38 CEST - Hardening MCP Infra Agent para pruebas controladas

- Añadida configuracion runtime:
  - `/etc/zabbix-codex/mcp-agent.env`
  - `/opt/zabbix-codex/mcp-infra-agent/deploy/mcp-agent.env.example`
- Añadida autenticacion temporal obligatoria para `remote_server.py` con:
  - `Authorization: Bearer <MCP_SHARED_TOKEN>`
- Añadida auditoria JSON lines en:
  - `/var/log/zabbix-codex/infra-agent-mcp.log`
- Actualizados:
  - `/opt/zabbix-codex/mcp-infra-agent/remote_server.py`
  - `/opt/zabbix-codex/mcp-infra-agent/deploy/zabbix-infra-mcp.service.example`
  - `/opt/zabbix-codex/mcp-infra-agent/deploy/nginx-mcp-infra-agent.conf.example`
  - `/opt/zabbix-codex/mcp-infra-agent/README.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_agent_setup.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/security_model.md`
  - `/opt/zabbix-codex/reports/infra-agent-chatgpt-deployment-plan.md`
- Creado:
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_developer_mode_test_plan.md`
- Validado:
  - `py_compile` OK.
  - `server.py --list-tools` OK.
  - `get_infrastructure_overview` OK.
  - `/healthz` sin auth devuelve `401`.
  - `/healthz`, `tools/list` y `get_infrastructure_overview` con auth devuelven OK.
  - El log de auditoria no contiene `Authorization`, `Bearer`, tokens ni secretos.
- No se modificó Zabbix, Proxmox, PBS, SharePoint ni bases de datos.
- Comandos principales:
  - `sudo -n install -m 0640 -o root -g codexops mcp-infra-agent/deploy/mcp-agent.env.example /etc/zabbix-codex/mcp-agent.env`
  - `sudo -n install -d -m 0750 -o codexops -g codexops /var/log/zabbix-codex`
  - `sudo -n touch /var/log/zabbix-codex/infra-agent-mcp.log`
  - `sudo -n chmod 0640 /var/log/zabbix-codex/infra-agent-mcp.log`
  - `python3 -m py_compile mcp-infra-agent/server.py mcp-infra-agent/remote_server.py`
  - `python3 mcp-infra-agent/server.py --list-tools`
  - `python3 mcp-infra-agent/server.py --call get_infrastructure_overview`
  - `python3 mcp-infra-agent/remote_server.py`
  - `curl -sS -o /tmp/mcp-health-noauth.out -w '%{http_code}' http://127.0.0.1:8765/healthz`
  - `curl -sS http://127.0.0.1:8765/healthz -H 'Authorization: Bearer CAMBIAR'`
  - `curl -sS http://127.0.0.1:8765/mcp -H 'Authorization: Bearer CAMBIAR' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`
  - `curl -sS http://127.0.0.1:8765/mcp -H 'Authorization: Bearer CAMBIAR' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_infrastructure_overview","arguments":{}}}'`

## 2026-05-21 15:19:41 CEST - Corrección read-only formal para ChatGPT Agent Builder

- Añadido `annotations: {"readOnlyHint": true}` a todas las herramientas publicadas por `tools/list`.
- Reducido el registro público MCP a 12 herramientas reales de consulta:
  - `get_infrastructure_overview`
  - `get_active_problems`
  - `get_critical_risks`
  - `get_backup_status`
  - `get_proxmox_status`
  - `get_nas_status`
  - `get_ups_status`
  - `get_printer_status`
  - `get_zabbix_internal_health`
  - `get_monitoring_gaps`
  - `get_global_infrastructure_map`
  - `generate_daily_report`
- Retirados del registro público/callable MCP los placeholders `sharepoint_search_assets`, `sharepoint_get_asset`, `apps_get_status`, `apps_get_database_health`.
- Ampliada allowlist defensiva de Zabbix API a métodos read-only: `apiinfo.version`, `event.get`, `history.get`, `host.get`, `hostgroup.get`, `item.get`, `problem.get`, `template.get`, `trend.get`, `trigger.get`.
- Añadido bloqueo explícito y auditoría para métodos Zabbix de escritura o no allowlisted, incluyendo `host.update`, `event.acknowledge`, `script.execute`, `history.push`, `action.*`, `maintenance.*` y create/update/delete.
- Actualizados:
  - `/opt/zabbix-codex/mcp-infra-agent/server.py`
  - `/opt/zabbix-codex/mcp-infra-agent/tools.yaml`
  - `/opt/zabbix-codex/mcp-infra-agent/README.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/security_model.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_agent_setup.md`
  - `/opt/zabbix-codex/mcp-infra-agent/docs/chatgpt_developer_mode_test_plan.md`
  - `/opt/zabbix-codex/reports/infra-agent-chatgpt-deployment-plan.md`
- Instalado y reiniciado servicio local:
  - `/etc/systemd/system/zabbix-infra-mcp.service`
  - Estado: activo, escuchando solo en `127.0.0.1:8765`, con auth y auditoría activadas.
- Validado:
  - `py_compile` OK.
  - `tools/list` publica 12 herramientas con `readOnlyHint`.
  - `get_infrastructure_overview` OK.
  - `sharepoint_search_assets` devuelve `Unknown tool`.
  - Scan AST de llamadas Zabbix: solo métodos read-only allowlisted.
  - `host.update` queda bloqueado antes de llamar a Zabbix y se registra en auditoría.
  - Escaneo de secretos OK en ficheros/logs.
- No se modificó Zabbix, Proxmox, PBS, SharePoint ni bases de datos.

## 2026-05-21 17:25:00 CEST - MCP/App read-only para SharePoint IncidenciasTI

- Creado segundo MCP/App independiente para consultar la lista SharePoint/Microsoft Lists `IncidenciasTI` via Microsoft Graph.
- Lista objetivo configurada:
  - `ramiroarnedo.sharepoint.com`
  - `/Departamento de Informática`
  - `IncidenciasTI`
- Creado:
  - `/opt/zabbix-codex/mcp-incidents-ti/server.py`
  - `/opt/zabbix-codex/mcp-incidents-ti/remote_server.py`
  - `/opt/zabbix-codex/mcp-incidents-ti/tools.yaml`
  - `/opt/zabbix-codex/mcp-incidents-ti/README.md`
  - `/opt/zabbix-codex/mcp-incidents-ti/docs/security_model.md`
  - `/opt/zabbix-codex/mcp-incidents-ti/docs/chatgpt_agent_setup.md`
  - `/opt/zabbix-codex/mcp-incidents-ti/docs/chatgpt_developer_mode_test_plan.md`
  - `/opt/zabbix-codex/mcp-incidents-ti/docs/agent_instructions.md`
  - `/opt/zabbix-codex/mcp-incidents-ti/deploy/sharepoint-incidents.env.example`
  - `/opt/zabbix-codex/mcp-incidents-ti/deploy/incidents-ti-mcp.env.example`
  - `/opt/zabbix-codex/mcp-incidents-ti/deploy/sharepoint-incidents-ti-mcp.service.example`
  - `/opt/zabbix-codex/mcp-incidents-ti/deploy/nginx-sharepoint-incidents-ti.conf.example`
  - `/opt/zabbix-codex/reports/sharepoint-incidents-ti-mcp.md`
- Creado runtime local:
  - `/etc/zabbix-codex/sharepoint-incidents.env` con datos no secretos y placeholders Graph.
  - `/etc/zabbix-codex/incidents-ti-mcp.env` con token MCP local generado sin imprimir.
  - `/var/log/zabbix-codex/incidents-ti-mcp.log`.
- Herramientas publicadas:
  - `get_incidents_schema`
  - `get_incidents_summary`
  - `get_open_incidents`
  - `get_incidents_by_status`
  - `get_recent_incidents`
  - `get_incident_by_id`
  - `search_incidents`
  - `get_incidents_related_to_asset`
- Seguridad:
  - Todas las tools declaran `annotations: {"readOnlyHint": true}`.
  - El registro publico no contiene tools de escritura.
  - Microsoft Graph queda limitado defensivamente a `GET`.
  - `POST`, `PUT`, `PATCH` y `DELETE` contra Graph quedan bloqueados antes de llamar a Graph.
  - El endpoint remoto exige bearer auth.
- Validado:
  - `python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py` OK.
  - `python3 mcp-incidents-ti/server.py --self-test` OK: 8 tools, todas read-only.
  - `python3 mcp-incidents-ti/server.py --list-tools` OK.
  - `python3 mcp-incidents-ti/server.py --test-block-write` devuelve `blocked_ok`.
  - `/healthz` sin auth devuelve `401`.
  - `/healthz` con auth devuelve `200`.
  - `/mcp tools/list` con auth devuelve 8 tools, todas con `readOnlyHint=true`.
  - Tool inexistente `create_incident` queda rechazada como `Unknown tool`.
  - `get_open_incidents`, `search_incidents`, `get_incident_by_id` y `get_incidents_related_to_asset` devuelven error seguro `graph_available=false` al faltar credenciales Graph.
  - Escaneo de secretos del repo OK; el token MCP generado no aparece en `/opt/zabbix-codex`.
- Limitacion:
  - Faltan credenciales reales Graph read-only en `/etc/zabbix-codex/sharepoint-incidents.env`.
  - Las tools devuelven error estructurado `graph_available=false` hasta configurar `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` y `GRAPH_CLIENT_SECRET`.
- No se modificó SharePoint, Zabbix, Proxmox, PBS ni bases de datos.
- Comandos principales:
  - `python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py`
  - `python3 mcp-incidents-ti/server.py --self-test`
  - `python3 mcp-incidents-ti/server.py --list-tools`
  - `python3 mcp-incidents-ti/server.py --call get_incidents_schema`
  - `python3 mcp-incidents-ti/server.py --test-block-write`
  - `python3 mcp-incidents-ti/remote_server.py --port 18766`
  - Pruebas HTTP locales contra `/healthz` y `/mcp` con token leido desde `/etc/zabbix-codex/incidents-ti-mcp.env` sin imprimirlo.

## 2026-05-21 18:15:00 CEST - Validacion real Microsoft Graph IncidenciasTI

- Verificado `/etc/zabbix-codex/sharepoint-incidents.env`:
  - existe,
  - propietario `codexops:codexops`,
  - permisos ajustados a `600`,
  - variables Graph y SharePoint presentes sin imprimir secretos.
- Validado Microsoft Graph:
  - autenticacion client credentials OK,
  - acceso read-only a lista `IncidenciasTI` OK,
  - `list_id` detectado: `b4972fd0-8714-4cf1-bbb2-62b9809a6414`,
  - columnas detectadas: 93,
  - items devueltos por Graph: 0.
- Ajustado mapeo de campos reales en `/opt/zabbix-codex/mcp-incidents-ti/server.py`:
  - `Title`,
  - `Descripci_x00f3_n`,
  - `Estado`,
  - `Prioridad`,
  - `Categor_x00ed_a`,
  - `Resoluci_x00f3_n`,
  - `Equipo_x002f_Puesto`,
  - `Ubicaci_x00f3_n_x002f_Puesto_x00`,
  - `Author`,
  - `Editor`,
  - `Fechadecierre`.
- Validado:
  - `get_incidents_schema` OK,
  - `get_incidents_summary` OK con total `0`,
  - `get_open_incidents` OK con total `0`,
  - `get_recent_incidents` OK con total `0`,
  - `search_incidents` OK con total `0`,
  - `get_incidents_by_status` y `get_incident_by_id` quedan sin prueba con datos reales al no existir items devueltos por Graph.
- Instalado y arrancado servicio systemd:
  - `/etc/systemd/system/sharepoint-incidents-ti-mcp.service`,
  - activo y habilitado,
  - escucha solo en `127.0.0.1:8766`.
- Validado endpoint:
  - `/healthz` sin auth devuelve `401`,
  - `/healthz` con auth devuelve `200`,
  - `/mcp tools/list` con auth devuelve 8 tools, todas `readOnlyHint=true`.
- Seguridad:
  - solo llamadas `GET` contra Microsoft Graph,
  - `POST` contra Graph bloqueado y auditado,
  - auditoria sin `Authorization`, `Bearer`, `access_token` ni `client_secret`,
  - no se modifico SharePoint.
- Comandos principales:
  - `stat -c '%n %a %U %G %s' /etc/zabbix-codex/sharepoint-incidents.env /etc/zabbix-codex/incidents-ti-mcp.env`
  - `sudo -n chmod 600 /etc/zabbix-codex/sharepoint-incidents.env`
  - `sudo -n chmod 600 /etc/zabbix-codex/incidents-ti-mcp.env`
  - `python3 -m py_compile mcp-incidents-ti/server.py mcp-incidents-ti/remote_server.py`
  - `python3 mcp-incidents-ti/server.py --self-test`
  - `python3 mcp-incidents-ti/server.py --call get_incidents_schema`
  - `python3 mcp-incidents-ti/server.py --test-block-write`
  - `sudo -n install -m 0644 -o root -g root mcp-incidents-ti/deploy/sharepoint-incidents-ti-mcp.service.example /etc/systemd/system/sharepoint-incidents-ti-mcp.service`
  - `sudo -n systemctl daemon-reload`
  - `sudo -n systemctl enable sharepoint-incidents-ti-mcp.service`
  - `sudo -n systemctl restart sharepoint-incidents-ti-mcp.service`
  - `systemctl status sharepoint-incidents-ti-mcp.service --no-pager -l`

## 2026-05-21 18:24:00 CEST - Revision permisos Graph MCP IncidenciasTI

- Decodificado access token sin imprimirlo completo ni registrar secretos.
- Permiso efectivo detectado:
  - `roles=["Sites.Read.All"]`,
  - token app-only (`idtyp=app`),
  - sin `Sites.Selected`,
  - sin `Lists.SelectedOperations.Selected`,
  - sin `scp` delegado.
- Interpretacion:
  - `Sites.Read.All` tiene consentimiento de administrador efectivo porque aparece en el token emitido.
  - No hace falta grant especifico a site/lista para leer con este modelo.
  - Es mas amplio de lo recomendado para el agente.
- Comprobaciones read-only:
  - `GET /sites/{site_id}/permissions`: `403 accessDenied`.
  - `GET /sites/{site_id}/lists/{list_id}/permissions` v1.0: endpoint no disponible para lista.
  - `GET https://graph.microsoft.com/beta/sites/{site_id}/lists/{list_id}/permissions`: OK, 7 permisos.
  - No hay grant beta de lista que apunte al `GRAPH_CLIENT_ID` del MCP.
  - `GET /sites/{site_id}/lists/{list_id}`: OK.
  - `GET /sites/{site_id}/lists/{list_id}/items`: OK, 0 items.
- Preparado comando exacto para conceder `read` sobre la lista `IncidenciasTI` usando endpoint beta de permisos de lista con una identidad administrativa externa (`GRANT_ACCESS_TOKEN`).
- No se modifico SharePoint, no se crearon grants y no se tocaron incidencias.

## 2026-05-21 18:45:00 CEST - Diagnostico de items IncidenciasTI

- Confirmado que la lista Graph usada es la lista visible:
  - `id`: `b4972fd0-8714-4cf1-bbb2-62b9809a6414`,
  - `displayName`: `IncidenciasTI`,
  - `webUrl`: `https://ramiroarnedo.sharepoint.com/Departamento%20de%20Inform%C3%A1tica/Lists/IncidenciasTI`,
  - `template`: `genericList`,
  - `hidden=false`.
- Enumeradas listas candidatas del site:
  - `IncidenciasTI`,
  - `Incidencias Transportes`.
- Probadas llamadas Graph crudas read-only:
  - `/items` devuelve 190 items,
  - `/items?$top=5` devuelve 5 items y `@odata.nextLink`,
  - `/items?$top=5&$expand=fields` devuelve campos,
  - `/items?$top=5&$expand=fields($select=...)` devuelve campos seleccionados,
  - v1.0 y beta validan lectura.
- Confirmadas busquedas:
  - `La impresora se aturulla` -> id `22`,
  - `Entrega de tablet` -> id `23`,
  - `Premejora Calahorra` -> id `23`.
- Corregido `/opt/zabbix-codex/mcp-incidents-ti/server.py`:
  - `GraphClient.graph_request` ahora respeta `params` tambien con URLs absolutas.
- Reiniciado `sharepoint-incidents-ti-mcp.service`.
- Validado por endpoint MCP:
  - `get_incidents_summary` OK, total `190`,
  - `Abierto`: 54,
  - `En curso`: 5,
  - `Cerrado`: 130,
  - `Pendiente de usuario`: 1,
  - `get_open_incidents` OK, total `54`,
  - `get_recent_incidents` ultimos 30 dias OK, total `35`,
  - `get_incident_by_id` con id `22` OK.
- Seguridad:
  - No se modifico SharePoint,
  - no se crearon grants,
  - no se tocaron incidencias,
  - solo llamadas GET contra Graph,
  - auditoria sin secretos.

## 2026-05-21 18:50:00 CEST - Publicacion HTTPS MCP IncidenciasTI para ChatGPT Developer Mode

- Creado:
  - `/opt/zabbix-codex/mcp-incidents-ti/deploy/sharepoint-incidents-ti-cloudflared.service.example`
  - `/etc/systemd/system/sharepoint-incidents-ti-cloudflared.service`
- Arrancado y habilitado:
  - `sharepoint-incidents-ti-cloudflared.service`
- Endpoint publico HTTPS:
  - `https://sugar-parallel-owners-developers.trycloudflare.com/mcp`
- Validado:
  - `/healthz` sin auth devuelve `401`,
  - `/healthz` con auth devuelve `200`,
  - `/mcp tools/list` con auth devuelve exactamente 8 tools,
  - todas las tools tienen `readOnlyHint=true`,
  - no hay tools de escritura,
  - `get_incidents_summary` por HTTPS devuelve total `190`,
  - `get_open_incidents` por HTTPS devuelve total `54`,
  - `create_incident` por HTTPS devuelve `Unknown tool`.
- Datos preparados para ChatGPT Developer Mode:
  - nombre: `IncidenciasTI ReadOnly`,
  - descripcion read-only,
  - URL `/mcp`,
  - autenticacion bearer,
  - token disponible solo en `/etc/zabbix-codex/incidents-ti-mcp.env` como `MCP_SHARED_TOKEN`.
- Seguridad:
  - no se imprimio el token bearer,
  - no se guardo el token en reports,
  - no se modifico SharePoint,
  - se mantiene `Sites.Read.All` para la validacion funcional.
- Nota:
  - Cloudflare Quick Tunnel no garantiza URL estable si se reinicia el servicio; para produccion usar named tunnel o dominio HTTPS controlado.

## 2026-05-21 23:56:41 CEST - Primera consola web ChatKit para Agente de Infraestructura

- Creado proyecto Next.js:
  - `/opt/zabbix-codex/infra-agent-web`
- Implementado:
  - pagina principal `Agente Inteligente de Infraestructura`,
  - panel lateral con 6 accesos rapidos,
  - chat embebido con `@openai/chatkit-react`,
  - endpoint backend `POST /api/chatkit/session`,
  - creacion de sesiones ChatKit con `OPENAI_API_KEY` y `OPENAI_WORKFLOW_ID` solo en backend,
  - cookie HTTP-only para usuario anonimo estable de demo local,
  - README con instalacion, variables de entorno y seguridad.
- Validado:
  - `npm install` correcto,
  - `npm run build` correcto fuera de sandbox por requisito IPC interno de Next.
- Seguridad:
  - no se guardaron secretos reales,
  - no se tocaron Zabbix, SharePoint, Proxmox ni PBS,
  - no se modificaron MCP existentes,
  - no se crearon herramientas de escritura.
- Nota:
  - el servidor tiene Node.js `16.20.2`; se uso Next.js `13.5.11` por compatibilidad local.
  - `npm audit` reporta vulnerabilidades conocidas en Next 13; antes de exponer esta consola fuera de localhost conviene actualizar Node.js y subir Next.js a una version soportada.

## 2026-05-22 00:25:06 CEST - Parche ChatKit para demo LAN HTTP

- Corregido:
  - error de UI `crypto.randomUUID is not a function` al acceder a la consola por HTTP usando IP LAN.
- Cambios:
  - creado `/opt/zabbix-codex/infra-agent-web/lib/installRandomUUIDFallback.js`,
  - importado el fallback antes de montar `@openai/chatkit-react`,
  - anadidos scripts `dev:local`, `dev:lan` y `start:lan`,
  - documentada la recomendacion de usar HTTPS en produccion.
- Seguridad:
  - el fallback del navegador solo aplica a IDs temporales de UI,
  - no se usa para secretos, tokens, autenticacion ni autorizacion,
  - `OPENAI_API_KEY` y `OPENAI_WORKFLOW_ID` siguen solo en backend,
  - no se tocaron Zabbix, SharePoint, MCPs ni workflow.
- Validado:
  - `npm run build` correcto,
  - `npm run dev -- -H 0.0.0.0 -p 3010` correcto,
  - `GET /` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir el `client_secret`,
  - escucha en `0.0.0.0:3010` para acceso LAN.

## 2026-05-22 00:35:45 CEST - Carga temprana de fallback randomUUID antes de ChatKit

- Corregido:
  - el fallback anterior podia cargarse demasiado tarde porque `@openai/chatkit-react` se evaluaba durante la carga del modulo.
- Cambios:
  - `components/InfraChat.js` queda como wrapper sin import estatico de ChatKit,
  - creado `components/InfraChatClient.js` con el import de `@openai/chatkit-react`,
  - `InfraChatClient` se carga mediante dynamic import con `ssr: false` despues de instalar el fallback,
  - creado `pages/_document.js` con script inline `randomuuid-http-lan-fallback` en `<Head>` antes de los scripts de Next.
- Validado:
  - borrado `.next`,
  - `npm run build` correcto,
  - `npm run dev -- -H 0.0.0.0 -p 3010` correcto,
  - `GET /` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200`,
  - el HTML contiene `randomuuid-http-lan-fallback` antes de `/_next/static`,
  - `/api/chatkit/session` devuelve `client_secret` sin imprimirlo.
- Seguridad:
  - el fallback sigue siendo solo para IDs temporales de UI en navegador,
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni variables secretas.

## 2026-05-22 00:46:20 CEST - Documentacion de requisito secure context para ChatKit

- Actualizado:
  - `/opt/zabbix-codex/infra-agent-web/README.md`
- Documentado:
  - ChatKit debe probarse en `http://localhost:3010` o mediante HTTPS valido,
  - no usar `http://192.168.100.124:3010` por IP LAN HTTP,
  - workaround desde Windows con tunel SSH:
    `ssh -L 3010:127.0.0.1:3010 codexops@192.168.100.124`,
  - abrir despues `http://localhost:3010`,
  - propuesta de HTTPS interno con Caddy o Nginx reverse proxy,
  - Next debe mantenerse escuchando en `127.0.0.1:3010` detras del proxy,
  - `OPENAI_API_KEY` y `OPENAI_WORKFLOW_ID` siguen solo en backend.
- Sin cambios:
  - no se tocaron Zabbix,
  - no se toco SharePoint,
  - no se tocaron MCPs,
  - no se modifico el workflow,
  - no se imprimieron secretos.

## 2026-05-22 08:07:34 CEST - Despliegue HTTPS interno de infra-agent-web

- Caddy:
  - no estaba disponible en el servidor.
  - se aplico la alternativa Nginx, que ya estaba instalado y activo.
- Creado:
  - `/opt/zabbix-codex/infra-agent-web/deploy/infra-agent-web.service`,
  - `/opt/zabbix-codex/infra-agent-web/deploy/nginx-infra-agent-web.conf`,
  - `/opt/zabbix-codex/infra-agent-web/deploy/infra-agent-web-openssl.cnf`,
  - `/opt/zabbix-codex/infra-agent-web/docs/https-internal-deployment.md`.
- Instalado:
  - `/etc/systemd/system/infra-agent-web.service`,
  - `/etc/nginx/conf.d/infra-agent-web.conf`,
  - certificado interno `/etc/pki/tls/certs/infra-agent-web.crt`,
  - clave privada protegida `/etc/pki/tls/private/infra-agent-web.key`.
- Configurado:
  - `infra-agent-web.service` activo y habilitado,
  - Next.js en produccion escuchando solo en `127.0.0.1:3010`,
  - Nginx HTTPS en `443/tcp` para `agente-infra.local` e `infra-agent.local`,
  - `/etc/hosts` local con `192.168.100.124 agente-infra.local infra-agent.local`,
  - firewall con servicio `https` abierto,
  - retirado `3010/tcp` del firewall,
  - `httpd_can_network_connect=on` para permitir proxy local desde Nginx.
- Validado:
  - `systemctl status infra-agent-web.service` activo,
  - `curl http://127.0.0.1:3010` devuelve `200`,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - certificado con SAN para `agente-infra.local`, `infra-agent.local`, `192.168.100.124` y `127.0.0.1`,
  - `ss` muestra `127.0.0.1:3010` y `0.0.0.0:443`,
  - firewall ya no lista `3010/tcp`.
- Seguridad:
  - `.env.local` queda con permisos `600`,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID` ni `client_secret`,
  - Nginx no conoce secretos,
  - no se tocaron Zabbix, SharePoint, MCPs ni workflow.

## 2026-05-22 08:42:02 CEST - MVP externo validado de infra-agent-web

- Confirmado por prueba en navegador:
  - URL interna validada: `https://agente-infra.local`,
  - carga la UI,
  - ChatKit muestra input,
  - se puede escribir,
  - el workflow responde,
  - MCP Zabbix ReadOnly funciona,
  - MCP IncidenciasTI ReadOnly funciona.
- Arquitectura vigente:
  - navegador interno -> Nginx HTTPS -> Next.js en `127.0.0.1:3010`,
  - `infra-agent-web.service` ejecuta la app en modo produccion,
  - `nginx` publica HTTPS en `443/tcp`,
  - `3010/tcp` no esta expuesto en LAN,
  - secretos solo en backend.
- Documentado en `/opt/zabbix-codex/infra-agent-web/README.md`:
  - estado `MVP externo validado`,
  - URL interna,
  - arquitectura actual,
  - requisitos de cliente: resolucion DNS/hosts y certificado interno,
  - servicios implicados: `infra-agent-web.service`, `nginx`, MCP Zabbix ReadOnly, MCP IncidenciasTI ReadOnly,
  - comandos utiles de operacion,
  - siguiente fase `Dashboard operativo`.
- Siguiente fase propuesta:
  - tarjetas de estado general,
  - incidencias abiertas,
  - incidencias en curso,
  - riesgos criticos Zabbix,
  - problemas con impacto real en usuarios,
  - matriz de correlacion Zabbix + IncidenciasTI,
  - boton generar informe diario,
  - historico de informes.
- Sin cambios:
  - no se toco `.env.local`,
  - no se tocaron Zabbix, SharePoint, MCPs ni workflow,
  - no se imprimieron secretos.

## 2026-05-22 08:55:53 CEST - Dashboard operativo v0.1 en infra-agent-web

- Implementado:
  - primera capa visual de dashboard sin base de datos,
  - tarjetas operativas que envian prompts al workflow,
  - botones de accion para resumen operativo, matriz de correlacion, incidencias abiertas, riesgos criticos y huecos de monitorizacion,
  - prompts rapidos mas operativos,
  - conservado el chat ChatKit existente.
- Tarjetas:
  - Estado general,
  - Incidencias abiertas,
  - Incidencias en curso,
  - Riesgos criticos Zabbix,
  - Impacto en usuarios,
  - Huecos de monitorizacion.
- Actualizado:
  - `/opt/zabbix-codex/infra-agent-web/components/InfraChatClient.js`,
  - `/opt/zabbix-codex/infra-agent-web/styles/globals.css`,
  - `/opt/zabbix-codex/infra-agent-web/README.md`.
- Validado:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - Next sigue escuchando solo en `127.0.0.1:3010`,
  - Nginx sigue publicando `443/tcp`.
- Seguridad:
  - sin nuevas APIs directas,
  - sin base de datos,
  - sin persistencia,
  - sin herramientas de escritura,
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos.

## 2026-05-22 09:34:11 CEST - Dashboard operativo v0.3 con historico SQLite local

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - persistencia minima SQLite en `data/infra-agent.db`,
  - tabla `reports` para `daily_summary`, `correlation_matrix`, `risks` y `monitoring_gaps`,
  - API interna `POST /api/reports`, `GET /api/reports` y `GET /api/reports/:id`,
  - panel `Memoria operativa v0.3` con historico de informes,
  - formulario `Guardar respuesta como informe`,
  - botones `Generar informe diario`, `Guardar informe diario`, `Ver historico` y `Guardar matriz de correlacion`,
  - detalle de informe guardado desde el historico.
- Seguridad:
  - SQLite solo guarda informes generados por el usuario,
  - bloqueo defensivo de patrones evidentes de secretos antes de insertar informes,
  - `data/` con permisos `700`,
  - `data/infra-agent.db` con permisos `600`,
  - sin cambios en Zabbix, SharePoint, MCPs, workflow ni secretos,
  - sin herramientas de escritura externas.
- Ficheros creados o modificados:
  - `infra-agent-web/lib/reportsDb.js`,
  - `infra-agent-web/pages/api/reports/index.js`,
  - `infra-agent-web/pages/api/reports/[id].js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/data/.gitignore`,
  - `infra-agent-web/package.json`,
  - `infra-agent-web/package-lock.json`,
  - `infra-agent-web/README.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `GET https://agente-infra.local/api/reports?limit=10` correcto,
  - `POST https://agente-infra.local/api/reports` correcto con informe local de prueba,
  - `GET https://agente-infra.local/api/reports/1` correcto,
  - `POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`; fichero temporal de prueba eliminado,
  - escaneo basico sin secretos reales en ficheros modificados.
- Nota tecnica:
  - ChatKit no expone de forma estable el Markdown final desde el wrapper React usado aqui; v0.3 guarda informes pegando manualmente la respuesta generada en el chat.

## 2026-05-22 09:54:55 CEST - Dashboard operativo v0.4 con informes estructurados

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - endpoints backend estructurados:
    - `POST /api/structured/daily-summary`,
    - `POST /api/structured/correlation-matrix`,
    - `POST /api/structured/critical-risks`,
    - `POST /api/structured/monitoring-gaps`,
  - generacion JSON con esquemas estrictos desde backend usando OpenAI Responses API,
  - snapshot read-only desde MCP Zabbix, MCP IncidenciasTI y artefactos locales cuando estan disponibles,
  - validacion de JSON recibido,
  - render Markdown para lectura humana,
  - guardado automatico en SQLite reutilizando `reports.metadata_json`,
  - fallback local limitado si OpenAI o el JSON fallan,
  - panel visual para resultado estructurado,
  - botones para informe diario, matriz, riesgos y huecos estructurados,
  - modo manual v0.3 conservado.
- Ficheros creados:
  - `infra-agent-web/lib/httpJson.js`,
  - `infra-agent-web/lib/mcpSnapshot.js`,
  - `infra-agent-web/lib/structuredSchemas.js`,
  - `infra-agent-web/lib/structuredReports.js`,
  - `infra-agent-web/lib/structuredApiHandler.js`,
  - `infra-agent-web/pages/api/structured/daily-summary.js`,
  - `infra-agent-web/pages/api/structured/correlation-matrix.js`,
  - `infra-agent-web/pages/api/structured/critical-risks.js`,
  - `infra-agent-web/pages/api/structured/monitoring-gaps.js`.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/lib/reportsDb.js`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/structured/daily-summary` devuelve `200`, `source=openai_responses`, crea informe `id=2`,
  - `POST /api/structured/correlation-matrix` devuelve `200`, `source=openai_responses`, crea informe `id=3`,
  - `POST /api/structured/monitoring-gaps` devuelve `200`, `source=openai_responses`, crea informe `id=4`,
  - `POST /api/structured/critical-risks` devuelve `200`, `source=openai_responses`, crea informe `id=5`,
  - `GET /api/reports?limit=5` devuelve historico ligero sin `metadata_json`,
  - `GET /api/reports/3` devuelve metadata estructurada completa,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`; fichero temporal eliminado,
  - ficheros temporales con respuestas estructuradas eliminados tras validar,
  - escaneo basico sin secretos reales en ficheros modificados,
  - `data/` mantiene permisos `700` y `data/infra-agent.db` mantiene permisos `600`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se crearon herramientas de escritura externas,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP ni `client_secret`.
- Nota tecnica:
  - el workflow publicado sigue siendo el motor del chat ChatKit,
  - los endpoints estructurados usan OpenAI Responses API desde backend para obtener JSON estricto, porque la sesion ChatKit hospedada no expone una respuesta JSON final server-side reutilizable.

## 2026-05-22 10:44:53 CEST - Dashboard operativo v0.5 alimentado desde informes estructurados

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - endpoint `GET /api/dashboard/latest`,
  - composicion ligera desde los ultimos informes `daily_summary`, `correlation_matrix`, `risks` y `monitoring_gaps`,
  - tarjetas superiores alimentadas desde SQLite en vez de solo contenido estatico,
  - bloque de acciones, riesgos y huecos desde informes estructurados,
  - vista `Ultima matriz` desde `correlation_preview`,
  - boton `Actualizar dashboard` que genera los cuatro informes estructurados y recarga el panel,
  - filtros simples de historico por tipo, texto y limite,
  - listado de historico sigue ligero y el detalle mantiene `metadata_json` completo.
- Ficheros creados:
  - `infra-agent-web/lib/dashboardComposer.js`,
  - `infra-agent-web/pages/api/dashboard/latest.js`.
- Ficheros modificados:
  - `infra-agent-web/lib/reportsDb.js`,
  - `infra-agent-web/pages/api/reports/index.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `GET /api/dashboard/latest` devuelve `200` con 6 tarjetas, 8 acciones, preview de matriz y `missing_reports=[]`,
  - `GET /api/reports?type=correlation_matrix&query=Matriz&limit=5` devuelve filtro correcto,
  - simulacion de `Actualizar dashboard` ejecutando los cuatro endpoints estructurados crea informes `id=6`, `id=7`, `id=8`, `id=9`,
  - tras actualizar, `/api/dashboard/latest` usa esos ultimos informes y mantiene `correlation_preview`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`; fichero temporal eliminado,
  - ficheros temporales con datos operativos eliminados tras validar,
  - escaneo basico sin secretos reales en ficheros modificados; solo placeholders antiguos `Bearer CAMBIAR`,
  - `data/` mantiene permisos `700` y `data/infra-agent.db` mantiene permisos `600`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se crearon herramientas de escritura externas,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP ni `client_secret`.

## 2026-05-22 12:01:14 CEST - Dashboard operativo v0.6 con avatar y voz Realtime

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - endpoint `POST /api/realtime/session` para crear client secret efimero de OpenAI Realtime,
  - endpoint `POST /api/dashboard/refresh` para generar los cuatro informes estructurados y devolver dashboard actualizado,
  - componente `VoiceAgentPanel` con panel `Hablar con el agente`,
  - avatar visual simple CSS con estados `desconectado`, `escuchando`, `pensando`, `hablando` y `error`,
  - conexion WebRTC desde navegador usando token efimero,
  - botones `Iniciar voz` y `Detener voz`,
  - transcripcion y ultima respuesta visibles cuando los eventos Realtime las envian,
  - `Actualizar dashboard` pasa a usar `/api/dashboard/refresh`.
- Variables documentadas:
  - `OPENAI_REALTIME_MODEL` opcional, por defecto `gpt-realtime`,
  - `OPENAI_REALTIME_VOICE` opcional, por defecto `marin`.
- Ficheros creados:
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/pages/api/dashboard/refresh.js`.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `GET /api/dashboard/latest` devuelve `200` con tarjetas y matriz,
  - `POST /api/realtime/session` devuelve `200`, con `client_secret` efimero presente, modelo `gpt-realtime` y voz `marin`, sin imprimir el token,
  - `POST /api/dashboard/refresh` devuelve `200`, genera 4 informes y recompone dashboard,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - ficheros temporales con tokens efimeros o datos operativos eliminados tras validar,
  - escaneo basico sin secretos reales en ficheros modificados; solo placeholders antiguos `Bearer CAMBIAR`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se guardo audio,
  - no se guardaron transcripciones en SQLite,
  - no se crearon herramientas de escritura externas,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.
- Limitaciones:
  - avatar visual simple; sin avatar 3D,
  - sin login ni auditoria avanzada por decision actual,
  - voz v0.6 en modo Realtime basico,
  - tool-calling de voz hacia endpoints internos queda para v0.6.1.

## 2026-05-22 12:33:21 CEST - Dashboard operativo v0.6.1 con tools internas de voz

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - herramientas Realtime registradas en la sesion efimera:
    - `get_dashboard_latest`,
    - `refresh_dashboard`,
    - `generate_daily_summary`,
    - `generate_correlation_matrix`,
    - `generate_critical_risks`,
    - `generate_monitoring_gaps`,
  - ejecucion de tool-calls desde `VoiceAgentPanel` mediante data channel Realtime,
  - deteccion de `response.function_call_arguments.done` y `response.done` con `function_call`,
  - devolucion de resultados al modelo con `conversation.item.create` tipo `function_call_output`,
  - `response.create` posterior para que el agente responda por voz,
  - estados de voz extendidos:
    - `consultando dashboard`,
    - `generando informe`,
    - `actualizando dashboard`,
  - visualizacion de la ultima herramienta ejecutada en el panel de voz,
  - resumen compacto de resultados antes de devolverlos al modelo.
- Restricciones aplicadas:
  - la voz solo llama endpoints internos de Next,
  - sin acceso directo a Zabbix,
  - sin acceso directo a SharePoint,
  - sin herramientas de escritura externas,
  - sin guardar audio,
  - sin guardar transcripciones en SQLite.
- Ficheros modificados:
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200`, con client secret efimero presente, modelo `gpt-realtime` y voz `marin`, sin imprimir el token,
  - `GET /api/dashboard/latest` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - ficheros temporales con tokens efimeros o datos operativos eliminados tras validar,
  - escaneo basico sin secretos reales en ficheros modificados; solo placeholders antiguos `Bearer CAMBIAR`.
- Pendiente de validacion manual en navegador:
  - probar microfono,
  - preguntar `¿Que es lo mas urgente hoy?` y confirmar tool `get_dashboard_latest`,
  - decir `Actualiza el dashboard` y confirmar tool `refresh_dashboard`,
  - decir `Genera matriz de correlacion` y confirmar tool `generate_correlation_matrix`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-22 12:45:42 CEST - Dashboard operativo v0.7 con diagnostico de voz

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - panel plegable `Diagnostico de voz`,
  - estado Realtime visible,
  - estado actual del avatar visible,
  - ultima herramienta ejecutada,
  - ultimo resultado resumido,
  - ultimo error si existe,
  - timestamp del ultimo evento,
  - historial local frontend de los ultimos 20 eventos de voz,
  - botones de prueba manual sin microfono:
    - `Probar get_dashboard_latest`,
    - `Probar refresh_dashboard`,
    - `Probar generate_daily_summary`,
    - `Probar generate_correlation_matrix`,
    - `Probar generate_critical_risks`,
    - `Probar generate_monitoring_gaps`.
- Comportamiento:
  - los botones manuales llaman los mismos endpoints internos que las tools de voz,
  - muestran loading por deshabilitado de botones,
  - actualizan ultima herramienta, ultimo resultado e historial local,
  - no guardan eventos de diagnostico en SQLite.
- Ficheros modificados:
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` con token efimero presente, sin imprimirlo,
  - `GET /api/dashboard/latest` devuelve `200`,
  - prueba equivalente a boton `generate_daily_summary` con `POST /api/structured/daily-summary` devuelve `200`,
  - prueba equivalente a boton `refresh_dashboard` con `POST /api/dashboard/refresh` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - ficheros temporales con tokens efimeros o datos operativos eliminados tras validar,
  - escaneo basico sin secretos reales en ficheros modificados; solo placeholders antiguos `Bearer CAMBIAR`.
- Pendiente de validacion manual en navegador:
  - pulsar botones manuales del panel y confirmar historial visual,
  - iniciar voz y confirmar que el ultimo tool-call se refleja,
  - comprobar respuesta hablada con microfono.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se guardo audio,
  - no se guardaron transcripciones ni eventos de voz en SQLite,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-27 - v0.18.1.18 UX final de Comunicaciones

- Objetivo:
  - convertir el panel de Comunicaciones en un flujo operativo simple y guiado para revisar, aprobar y enviar borradores.
- Cambios de UX aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - el editor legacy de borradores quedó plegado por defecto en `Crear borrador manual`,
  - el panel principal de revisión quedó arriba con una cabecera compacta y estado visible,
  - se introdujo un flujo guiado en tres pasos:
    - revisar contenido,
    - aprobar borrador,
    - envío real,
  - se dejaron visibles como acciones principales:
    - `Guardar cambios`,
    - `Marcar revisado`,
    - `Preparar envío`,
    - `Confirmar y enviar`,
    - `Copiar todo`,
    - `Cerrar revisión`,
  - se movieron las acciones secundarias a `Más acciones`,
  - se añadió checklist visible de validación antes del envío,
  - la lista de borradores quedó compacta con solo `Revisar` y `Abrir en pestaña nueva`,
  - se eliminaron de la vista principal las cajas y diagnósticos temporales que confundían el flujo operativo.
- Reglas mantenidas:
  - no se envía automáticamente,
  - no se envía por voz,
  - para enviar el borrador debe estar `reviewed`,
  - `prepare-send` sigue exigiendo `reviewed`,
  - `send-email` sigue exigiendo `confirm=true` y `confirmation_token`,
  - se mantiene el bloqueo de reenvío,
  - no se tocó Graph sendMail, Power BI, Zabbix, SharePoint write paths ni permisos.
- Validación:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo.

## Power BI Ask Lab visible chat hotfix

- Causa raiz:
  - el chat textual visible no estaba disparando de forma fiable la ruta local de Power BI,
  - la respuesta del router se quedaba sin una captura explicita en el flujo visible del drawer.
- Correccion aplicada:
  - se anadio una capa local `powerBiDrawerMessages` para respuestas Power BI dentro del drawer,
  - se incorporo una captura del envio visible del chat en `chat-frame` para activar `handlePowerBiChatMessage` antes o junto al flujo de ChatKit,
  - se mantuvo el router controlado para `administracion_ventas` y no se toco DAX libre.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `POST /api/powerbi/models/administracion_ventas/ask/interpret` con `Consulta ventas por cliente` devuelve `metric_by_dimension / ventas_eur / cliente`,
  - `POST /api/powerbi/models/administracion_ventas/ask/preview` y `execute` siguen funcionando en modo limitado,
  - revisado el servicio sin `ReferenceError`, sin 400 por pregunta vacia y sin secretos en logs.

## Power BI local input visible

- Causa raiz:
  - el input visible de ChatKit no exponia un hook fiable para interceptar el flujo real del usuario,
  - el drawer necesitaba una via propia y determinista para Power BI.
- Solucion aplicada:
  - se anadio un bloque local `Consulta local Power BI` dentro del drawer,
  - el campo esta controlado por React y usa `handlePowerBiChatMessage` antes que cualquier flujo de ChatKit,
  - las respuestas se pintan en mensajes locales `localPowerBiMessages` con `PowerBiChatResultView` para resultados, y con avisos seguros para rechazos o errores.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - el backend Power BI sigue respondiendo a `interpret`, `preview` y `execute` con `Consulta ventas por cliente`,
  - no se han tocado Zabbix, SharePoint, MCPs, workflow ni el envio de emails.

## 2026-05-22 18:11:54 CEST - Dashboard operativo v0.11 briefing de manana

- Objetivo:
  - anadir una experiencia de briefing diario hablado y visual para abrir la consola por la manana,
  - mantener ChatKit, voz/avatar, dashboard latest, SQLite, informe diario automatico y endpoints estructurados intactos,
  - no tocar Zabbix, SharePoint, MCPs, workflow ni secretos.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - anadido boton `Briefing de manana` en Dashboard y en `Chat/Voz`,
  - el briefing compone estado general, riesgos criticos, incidencias/impacto de usuario, acciones recomendadas, huecos de monitorizacion y tres prioridades del dia,
  - el briefing lee solo datos internos ya guardados: `/api/dashboard/latest`, ultimo `daily_summary` y ultima `correlation_matrix`,
  - si Realtime esta conectado, el avatar lee el briefing por voz; si no, queda visible en pantalla,
  - anadida navegacion visual por pasos temporizados entre Dashboard, Informe de hoy, Matriz y cierre,
  - ampliados estados visuales del avatar con `briefing`,
  - mostrada la voz activa configurada desde `OPENAI_REALTIME_VOICE`,
  - anadido endpoint interno `GET /api/voice/morning-briefing`,
  - anadida tool Realtime `voice_morning_briefing`,
  - anadidos comandos de voz: `Dame el briefing de manana`, `Hazme el resumen de hoy`, `Que tengo que revisar primero`,
  - actualizado README a estado v0.11 y documentada la limitacion de sincronizacion por temporizadores.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/pages/api/voice/morning-briefing.js`,
  - `infra-agent-web/lib/voiceSemantic.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `sudo -n systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/dashboard/latest` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/voice/morning-briefing` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `systemctl list-timers infra-agent-web-daily-report.timer --no-pager` muestra la siguiente ejecucion a las `08:00`,
  - `rg` confirma que no quedan referencias a `response.modalities` en `infra-agent-web/components`, `infra-agent-web/pages/api/realtime`, `infra-agent-web/pages/api/voice` ni `infra-agent-web/lib`,
  - escaneo basico no encontro secretos reales en ficheros tocados; solo aparecen el nombre de campo `client_secret` en backend y placeholders historicos `Authorization: Bearer CAMBIAR` en documentacion antigua.
- Pendiente de validacion manual en navegador:
  - abrir `https://agente-infra.local`,
  - pulsar `Briefing de manana`,
  - confirmar que el briefing aparece en pantalla,
  - confirmar que el avatar lo lee si Realtime esta conectado,
  - confirmar que la navegacion visual cambia entre Dashboard, Informe de hoy y Matriz,
  - confirmar que ChatKit textual sigue funcionando.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni herramientas de escritura,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-22 18:27:02 CEST - Correccion UX chat textual off-canvas

- Problema corregido:
  - el panel `Chat textual / Consulta al agente` competia con el dashboard en el lateral derecho,
  - en modo presentacion molestaba visualmente,
  - el foco operativo debia quedar en Dashboard, briefing, matriz y graficos.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - convertido ChatKit en drawer/off-canvas lateral derecho,
  - anadido boton de cabecera `Abrir chat`,
  - anadido boton flotante `Chat` cuando el drawer esta cerrado,
  - anadido cierre con `X` y overlay,
  - en modo presentacion el chat queda cerrado por defecto,
  - los prompts rapidos abren automaticamente el chat antes de enviar la consulta,
  - el grid principal vuelve a priorizar el dashboard con una sola columna visual,
  - mantenidos diagnosticos ChatKit dentro del drawer solo en modo normal,
  - anadidos estados visibles `Chat cerrado`, `Chat abriendo`, `Chat textual cargado`, `ChatKit no disponible` y `Error ChatKit`,
  - reforzada altura minima del input/contenedor ChatKit dentro del drawer,
  - en pantallas pequenas el drawer ocupa el ancho completo.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `sudo -n systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/dashboard/latest` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/voice/morning-briefing` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/realtime/session` devuelve `200` sin imprimir token efimero,
  - revision de textos confirma que ya no quedan referencias a chat fijo en columna derecha,
  - escaneo basico no encontro secretos reales en ficheros tocados; solo quedan placeholders historicos `Authorization: Bearer CAMBIAR` en documentacion antigua.
- Pendiente de validacion manual en navegador:
  - activar modo presentacion y confirmar que el chat queda cerrado,
  - abrir chat con el boton flotante o cabecera,
  - confirmar input manual de ChatKit,
  - enviar `Dame resumen de IncidenciasTI por estado`,
  - cerrar el chat y confirmar que dashboard/briefing/matriz/graficos quedan limpios,
  - probar un prompt rapido con el chat cerrado,
  - confirmar briefing de manana y voz/avatar.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni herramientas de escritura,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-22 19:50:19 CEST - infra-agent-web v0.11.1 selector de voz y avatar configurable

- Objetivo:
  - permitir elegir y probar la voz del agente desde la interfaz,
  - mantener `OPENAI_REALTIME_VOICE` como valor por defecto de backend,
  - preparar estructura de avatar configurable sin implementar avatar 3D.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - `GET /api/realtime/session` devuelve configuracion segura de Realtime para UI:
    - modelo,
    - voz por defecto,
    - voces permitidas,
    - estilos de respuesta,
    - temas de avatar,
  - `POST /api/realtime/session` acepta configuracion validada:
    - `voice`,
    - `response_style`,
    - `avatar_theme`,
    - `avatar_name`,
  - lista base de voces: `marin`, `cedar`,
  - soporte para ampliar lista con `OPENAI_REALTIME_VOICES`,
  - anadido panel `Configuracion de voz`,
  - anadido selector de voz y selector de estilo:
    - `Operativo`,
    - `Ejecutivo`,
    - `Breve`,
    - `Tecnico`,
  - anadida estructura visual `avatarTheme`: `default`, `robot`, `tecnico`, `empresa`,
  - anadido `avatarName` opcional,
  - anadido boton `Probar voz` con frase local de prueba,
  - la prueba de voz no llama Zabbix, SharePoint, MCPs ni herramientas internas,
  - la seleccion se guarda en `localStorage` del navegador y se aplica a la siguiente sesion Realtime,
  - los estilos ajustan instrucciones de sesion Realtime y respuestas habladas de briefing/tools,
  - actualizado README con variables `OPENAI_REALTIME_VOICES`, limitaciones y seguridad de voz.
- Ficheros modificados:
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `sudo -n systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/realtime/session` devuelve `200`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/realtime/session -H 'Content-Type: application/json' -d '{"voice":"cedar","response_style":"breve","avatar_theme":"robot","avatar_name":"Agente"}'` devuelve `200` sin imprimir token efimero,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' -X POST https://agente-infra.local/api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local/api/voice/morning-briefing` devuelve `200`,
  - `rg` confirma que no quedan usos activos de `response.modalities` en codigo Realtime; solo quedan referencias documentales/historicas,
  - escaneo basico no encontro secretos reales en ficheros tocados; solo aparecen el nombre de campo `client_secret` en backend y placeholders historicos `Authorization: Bearer CAMBIAR` en documentacion antigua.
- Pendiente de validacion manual en navegador:
  - abrir `https://agente-infra.local`,
  - cambiar voz entre `marin` y `cedar`,
  - iniciar voz,
  - pulsar `Probar voz`,
  - probar `Briefing de manana`,
  - confirmar que ChatKit textual sigue funcionando,
  - confirmar que no se guardan audio ni transcripciones.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni herramientas de escritura,
  - no se creo voz personalizada,
  - no se implemento imitacion de personas reales,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-23 11:05:00 CEST - infra-agent-web v0.14 informes ejecutivo, tecnico y operativo diario

- Objetivo:
  - separar claramente la salida exportable en tres perfiles de informe:
    - ejecutivo,
    - tecnico,
    - operativo diario,
  - mantener la exportacion manual sin tocar Zabbix, SharePoint, MCPs, workflow ni secretos,
  - seguir sin login, sin correo y sin Teams.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - ampliado `lib/exportReports.js` a v0.14 con composiciones especificas para:
    - informe ejecutivo,
    - informe tecnico,
    - informe operativo diario,
  - creados endpoints:
    - `GET /api/export/executive?format=html|markdown|json`,
    - `GET /api/export/technical?format=html|markdown|json`,
    - `GET /api/export/operational?format=html|markdown|json`,
  - mantenido `GET /api/export/report/:id?format=html|markdown|json|csv` para exportacion historica por informe,
  - HTML con cabecera profesional, secciones separadas, tablas legibles y estilos inline para imprimir o guardar como PDF,
  - Markdown con estructura limpia para copiar/pegar,
  - JSON con estructura completa del informe, saneado y sin `client_secret` ni secretos,
  - informe ejecutivo orientado a direccion con semaforo, top 3 riesgos, impacto en usuarios, acciones y escalados,
  - informe tecnico orientado a sistemas con problemas Zabbix, incidencias relacionadas, matriz, evidencias, riesgos, huecos y acciones por tipo,
  - informe operativo diario orientado al trabajo del dia con revisiones prioritarias, impacto real, delegacion y checklist,
  - frontend con botones visibles para descargar ejecutivo, tecnico y operativo en `Informe de hoy`, `Analisis` e `Historico`,
  - voz/avatar con comandos semanticos nuevos:
    - `Prepara el informe ejecutivo`,
    - `Prepara el informe tecnico`,
    - `Prepara el informe operativo`,
    - `Que informe le paso a direccion`,
    - `Que informe uso para sistemas`,
  - los comandos de voz solo navegan y orientan la descarga manual; no descargan nada automaticamente.
- Ficheros modificados:
  - `infra-agent-web/lib/exportReports.js`,
  - `infra-agent-web/pages/api/export/executive.js`,
  - `infra-agent-web/pages/api/export/technical.js`,
  - `infra-agent-web/pages/api/export/operational.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k "https://agente-infra.local/api/export/executive?format=html"` devuelve `200 text/html`,
  - `curl -k "https://agente-infra.local/api/export/technical?format=html"` devuelve `200 text/html`,
  - `curl -k "https://agente-infra.local/api/export/operational?format=html"` devuelve `200 text/html`,
  - `curl -k` sobre las variantes `markdown` y `json` devuelve `200` y parseo correcto,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - revision segura de logs: `log_secret_pattern_matches=0`.
- Pendiente de validacion manual en navegador:
  - pulsar los tres botones de descarga y abrir los HTML exportados,
  - guardar uno como PDF desde el navegador,
  - confirmar visualmente ChatKit y voz/avatar con microfono real.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login,
  - no se enviaron correos ni Teams,
  - no se crearon herramientas de escritura externas,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-23 10:35:00 CEST - infra-agent-web v0.13 exportacion manual de informes

- Objetivo:
  - permitir exportar informes, matrices y analisis desde la consola para compartir o archivar manualmente,
  - mantener el sistema sin login, sin correo, sin Teams y sin herramientas de escritura externas,
  - no tocar Zabbix, SharePoint, MCPs, workflow ni secretos.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - creado `lib/exportReports.js` con renderizado HTML, Markdown, CSV y JSON saneado,
  - creados endpoints:
    - `GET /api/export/report/:id?format=html|markdown|json|csv`,
    - `GET /api/export/latest-daily?format=html|markdown|json`,
    - `GET /api/export/latest-matrix?format=csv|html|markdown|json`,
    - `GET /api/export/analytics?format=html|markdown|json`,
  - `csv` en `/api/export/report/:id` queda limitado a informes `correlation_matrix`,
  - `latest-daily` acepta `variant=executive|technical`,
  - HTML exportado con titulo, fecha, tipo, estado, resumen, hallazgos, acciones, datos faltantes y tablas,
  - Markdown con estructura clara y tablas cuando aplica,
  - CSV de matriz con columnas requeridas para Excel/LibreOffice,
  - JSON con `metadata_json` saneado y sin prompt ni campos internos innecesarios,
  - opcion `disposition=inline&print=1` para abrir HTML imprimible y usar `Guardar como PDF` desde navegador,
  - vista `Informe de hoy` con botones:
    - `Descargar informe ejecutivo`,
    - `Descargar informe tecnico`,
    - `Descargar Markdown`,
    - `Descargar datos JSON`,
    - `Preparar PDF`,
  - vista `Matriz` con botones:
    - `Descargar matriz CSV`,
    - `Descargar HTML`,
    - `Descargar Markdown`,
    - `Descargar datos JSON`,
  - vista `Analisis` con botones:
    - `Descargar HTML`,
    - `Descargar datos JSON`,
    - `Descargar resumen Markdown`,
  - `Historico` con acciones por informe:
    - `Ver`,
    - `Descargar HTML`,
    - `Descargar Markdown`,
    - `Descargar JSON`,
    - `Descargar CSV` si el informe es matriz,
  - voz/avatar ampliado con comandos semanticos locales:
    - `Prepara el informe ejecutivo`,
    - `Prepara el informe tecnico`,
    - `Prepara la matriz para exportar`,
    - `Donde descargo el informe`,
  - las nuevas herramientas de voz solo navegan y explican que boton usar; no descargan automaticamente.
- Ficheros modificados:
  - `infra-agent-web/lib/exportReports.js`,
  - `infra-agent-web/pages/api/export/report/[id].js`,
  - `infra-agent-web/pages/api/export/latest-daily.js`,
  - `infra-agent-web/pages/api/export/latest-matrix.js`,
  - `infra-agent-web/pages/api/export/analytics.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k "https://agente-infra.local/api/export/latest-daily?format=html"` devuelve `200 text/html`,
  - `curl -k "https://agente-infra.local/api/export/latest-daily?format=markdown"` devuelve `200 text/markdown`,
  - `curl -k "https://agente-infra.local/api/export/latest-daily?format=json"` devuelve `200 application/json`,
  - `curl -k "https://agente-infra.local/api/export/latest-matrix?format=csv"` devuelve `200 text/csv`,
  - `curl -k "https://agente-infra.local/api/export/latest-matrix?format=html"` devuelve `200 text/html`,
  - `curl -k "https://agente-infra.local/api/export/analytics?format=html"` devuelve `200 text/html`,
  - `curl -k "https://agente-infra.local/api/export/analytics?format=json"` devuelve `200 application/json`,
  - `curl -k "https://agente-infra.local/api/export/report/39?format=html"` devuelve `200 text/html`,
  - JSON exportado parsea correctamente,
  - CSV de matriz contiene las columnas requeridas,
  - HTML exportado contiene documento HTML imprimible,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` y se verifica `client_secret` sin imprimir su valor,
  - `POST /api/realtime/session` devuelve `200` y se verifica token efimero sin imprimir su valor,
  - revision segura de logs: `log_secret_pattern_matches=0`; las coincidencias de `trace` eran lineas normales de build `Collecting build traces`.
- Pendiente de validacion manual en navegador:
  - pulsar botones de descarga y abrir los archivos generados desde el navegador,
  - abrir el CSV con Excel/LibreOffice,
  - confirmar visualmente ChatKit y voz/avatar con microfono real.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login,
  - no se enviaron correos ni Teams,
  - no se crearon herramientas de escritura externas,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-22 21:04:20 CEST - infra-agent-web v0.12.1 estabilizacion visual

- Objetivo:
  - cerrar v0.12 con una estabilizacion ligera de la experiencia visual,
  - aclarar mensajes cuando no hay suficiente historico para comparar,
  - reducir desbordes visuales en la matriz y mejorar la lectura de analitica.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - mensajes mas explicitos en `Analisis` cuando solo existe un dia de informes:
    - `No hay suficiente histórico para comparar.`,
    - `La comparativa estará disponible cuando existan informes de varios días.`,
    - `Genera más informes diarios para ver evolución.`,
  - mismo mensaje de ayuda en `Informe de hoy` y en el bloque de `Últimos días`,
  - `Matriz` con wrapping mejorado de celdas para evitar desbordes visuales,
  - `Últimos días` con tarjetas más compactas y sin ancho minimo innecesario,
  - README marcado como estabilizacion visual v0.12.1.
- Ficheros modificados:
  - `infra-agent-web/lib/analytics.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `curl -k https://agente-infra.local/api/analytics/summary` devuelve `200`,
  - `curl -k "https://agente-infra.local/api/analytics/reports?days=7"` devuelve `200`,
  - `python3 -m json.tool` valida ambos JSON,
  - `rg` confirma que no hay usos activos nuevos de `response.modalities` en Realtime; quedan solo referencias documentales/historicas.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni nuevas capacidades,
  - no se guardo audio,
  - no se guardaron transcripciones.

## 2026-05-22 20:54:20 CEST - infra-agent-web v0.12 analisis visual avanzado

- Objetivo:
  - incorporar una vista `Analisis` para explotar informes estructurados guardados en SQLite,
  - anadir graficas, evolucion y comparativas sin depender del chat,
  - mejorar la lectura ejecutiva de `Informe de hoy`, `Matriz` e `Historico`.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - creado `lib/analytics.js` para componer analitica local desde `reports.metadata_json`,
  - ampliado `lib/reportsDb.js` con filtros por fecha, `today`, `days` y lectura de informes para analitica,
  - creado endpoint `GET /api/analytics/summary`,
  - creado endpoint `GET /api/analytics/reports?days=7`,
  - ampliado `GET /api/reports` con filtros:
    - `date_from`,
    - `date_to`,
    - `today`,
    - `days`,
  - anadida pestaña `Analisis` a la navegacion interna,
  - anadidas graficas HTML/CSS:
    - incidencias por estado,
    - riesgos por prioridad,
    - correlaciones por nivel,
    - acciones por tipo de tarea,
    - evolucion de estado general por dia,
    - evolucion de riesgos criticos,
    - evolucion de huecos de monitorizacion,
    - evolucion de acciones recomendadas,
  - anadida comparativa `Hoy vs informe anterior`:
    - cambio en estado general,
    - nuevos riesgos criticos,
    - riesgos persistentes,
    - riesgos desaparecidos,
    - cambios en huecos,
    - acciones repetidas,
  - mejorada vista `Informe de hoy` con:
    - cabecera ejecutiva,
    - top 3 acciones,
    - riesgos criticos,
    - impacto en usuarios,
    - huecos de monitorizacion,
    - datos faltantes,
  - mejorada vista `Matriz` con:
    - resaltado de prioridad critica/alta,
    - chips de correlacion alta/media/baja,
    - contador de resultados filtrados,
    - boton `Limpiar filtros`,
  - mejorado `Historico` con filtros:
    - tipo,
    - texto,
    - desde,
    - hasta,
    - solo hoy,
    - ultimos 7 dias,
  - ampliadas tools internas de voz con:
    - `voice_analytics_summary`,
    - `voice_analytics_reports`,
  - ampliadas instrucciones Realtime para comandos:
    - `Muestrame el analisis`,
    - `Compara hoy con ayer`,
    - `Que ha cambiado desde el ultimo informe`,
    - `Ensename riesgos por prioridad`,
    - `Ensename evolucion de huecos`.
- Ficheros creados/modificados:
  - `infra-agent-web/lib/analytics.js`,
  - `infra-agent-web/lib/reportsDb.js`,
  - `infra-agent-web/pages/api/analytics/summary.js`,
  - `infra-agent-web/pages/api/analytics/reports.js`,
  - `infra-agent-web/pages/api/reports/index.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `sudo -n systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k -sS -o /dev/null -w '%{http_code}\n' https://agente-infra.local` devuelve `200`,
  - `GET /api/analytics/summary` devuelve `200`,
  - `GET /api/analytics/reports?days=7` devuelve `200`,
  - `GET /api/reports?today=1&limit=5` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - JSON de `/api/analytics/summary` validado con `python3 -m json.tool`,
  - JSON de `/api/analytics/reports?days=7` validado con `python3 -m json.tool`,
  - la respuesta de analytics contiene las claves `generated_at`, `today`, `previous`, `diff`, `series`, `charts` y `warnings`,
  - `rg` confirma que no quedan usos activos de `response.modalities` en codigo Realtime; solo quedan referencias documentales/historicas,
  - escaneo basico no encontro secretos reales en ficheros tocados; solo aparecen nombres de campo como `client_secret` y placeholders historicos `Authorization: Bearer CAMBIAR`.
- Limitaciones:
  - la comparativa queda parcial si solo existe un dia de informes estructurados en SQLite,
  - las graficas dependen de que el informe diario automatico siga generando `daily_summary`, `correlation_matrix`, `risks` y `monitoring_gaps`.
- Pendiente de validacion manual en navegador:
  - abrir `https://agente-infra.local`,
  - comprobar pestaña `Analisis`,
  - comprobar graficas y comparativa,
  - comprobar filtros de `Matriz`,
  - comprobar filtros de `Historico`,
  - probar voz: `Compara hoy con ayer`,
  - confirmar que ChatKit textual sigue funcionando visualmente.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni herramientas de escritura,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-22 17:38:36 CEST - infra-agent-web v0.9 informe diario automatico

- Objetivo:
  - generar automaticamente cada manana el dashboard diario para que la consola tenga datos frescos sin pulsar `Actualizar dashboard`.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - creado modulo comun `lib/dailyDashboard.js` para generar `daily-summary`, `correlation-matrix`, `critical-risks` y `monitoring-gaps`,
  - actualizado `POST /api/dashboard/refresh` para reutilizar la misma logica comun,
  - creado `POST /api/dashboard/run-daily-report`,
  - creado script `scripts/generateDailyDashboard.js`,
  - creados drafts instalables de systemd:
    - `deploy/infra-agent-web-daily-report.service`,
    - `deploy/infra-agent-web-daily-report.timer`,
  - instaladas unidades en `/etc/systemd/system/`,
  - habilitado y arrancado `infra-agent-web-daily-report.timer` con ejecucion diaria a las 08:00,
  - anadido estado visual de informe diario generado/pendiente,
  - anadido boton `Generar informe diario ahora`,
  - anadidos botones para abrir ultimo informe diario y ultima matriz,
  - ampliadas tools internas de voz:
    - `voice_run_daily_report`,
    - `voice_today_report`,
    - `voice_latest_matrix`,
  - creados endpoints semanticos:
    - `GET /api/voice/today-report`,
    - `GET /api/voice/latest-matrix`.
- Informes creados durante validacion:
  - antes de la prueba habia `22` informes, max ID `22`,
  - la ejecucion systemd creo 4 informes nuevos: IDs `23` a `26`,
  - la prueba manual del endpoint creo otros 4 informes nuevos: IDs `27` a `30`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `systemctl enable infra-agent-web-daily-report.timer` correcto,
  - `systemctl start infra-agent-web-daily-report.timer` correcto,
  - `systemctl start infra-agent-web-daily-report.service` correcto,
  - proxima ejecucion programada: `2026-05-23 08:00:00 CEST`,
  - `GET /api/dashboard/latest` devuelve `200`,
  - `POST /api/dashboard/run-daily-report` devuelve `200`,
  - `GET /api/voice/today-report` devuelve `200`,
  - `GET /api/voice/latest-matrix` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `curl -k https://agente-infra.local` devuelve `200`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni `.env.local`,
  - no se modificaron sistemas externos,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit,
  - revision de ficheros modificados no encontro secretos reales; solo quedan placeholders antiguos `Authorization: Bearer CAMBIAR` en documentacion historica.

## 2026-05-22 17:57:38 CEST - infra-agent-web v0.10 informes en pantalla y primeros graficos

- Objetivo:
  - convertir los informes estructurados guardados en SQLite en vistas visuales navegables, tablas filtrables y graficos simples.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - anadida navegacion interna:
    - Dashboard,
    - Informe de hoy,
    - Matriz,
    - Historico,
    - Chat/Voz,
  - anadida vista `Informe de hoy` desde el ultimo `daily_summary` del dia actual,
  - anadida vista `Matriz` desde la ultima `correlation_matrix`,
  - anadidos filtros de matriz:
    - prioridad,
    - nivel de correlacion,
    - texto libre,
  - anadidos graficos HTML/CSS sin dependencias nuevas:
    - incidencias por estado,
    - riesgos por prioridad,
    - correlaciones por nivel,
    - acciones por tipo de tarea,
  - anadidos eventos frontend internos para que la voz pueda abrir/preparar vistas visuales,
  - ampliadas instrucciones Realtime y herramientas internas de voz:
    - `voice_show_incident_chart`,
    - `voice_show_risk_chart`,
  - actualizado README con uso, limitaciones y validacion v0.10.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `GET /api/dashboard/latest` devuelve `200`,
  - `GET /api/voice/today-report` devuelve `200`,
  - `GET /api/voice/latest-matrix` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `POST /api/dashboard/run-daily-report` devuelve `200` durante validacion y creo 4 informes nuevos: IDs `31` a `34`,
  - `infra-agent-web-daily-report.timer` sigue activo con proxima ejecucion `2026-05-23 08:00:00 CEST`.
- Pendiente de validacion manual en navegador:
  - comprobar pestaña `Informe de hoy`,
  - comprobar pestaña `Matriz`,
  - probar filtros de matriz,
  - comprobar graficos,
  - probar voz: `Muestrame el informe de hoy`,
  - confirmar que ChatKit textual sigue funcionando visualmente.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni `.env.local`,
  - no se anadieron dependencias externas,
  - no se crearon herramientas de escritura,
  - no se guardo audio,
  - no se guardaron transcripciones,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit,
  - revision de patrones de secretos no encontro secretos reales en ficheros modificados; solo aparece el nombre de campo `client_secret` en codigo backend y placeholders historicos `Authorization: Bearer CAMBIAR`.

## 2026-05-22 16:17:36 CEST - Dashboard operativo v0.8.1 comandos semanticos de voz

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - capa semantica interna para voz en `lib/voiceSemantic.js`,
  - handler comun GET-only en `lib/voiceApiHandler.js`,
  - endpoints internos:
    - `GET /api/voice/open-incidents`,
    - `GET /api/voice/incidents-in-progress`,
    - `GET /api/voice/critical-risks`,
    - `GET /api/voice/storage-backup-status`,
    - `GET /api/voice/monitoring-gaps`,
    - `GET /api/voice/today-actions`,
    - `GET /api/voice/search?q=...`.
- Comportamiento:
  - los endpoints leen dashboard compuesto e informes estructurados guardados en SQLite,
  - no llaman directamente a Zabbix, SharePoint ni MCPs,
  - devuelven JSON compacto para respuesta hablada,
  - incluyen `missing_data` si falta informacion y recomiendan actualizar dashboard,
  - bloquean metodos distintos de GET con `405`.
- Realtime actualizado:
  - registradas tools `voice_open_incidents`, `voice_incidents_in_progress`, `voice_critical_risks`, `voice_storage_backup_status`, `voice_monitoring_gaps`, `voice_today_actions`, `voice_search`,
  - instrucciones de voz ampliadas para mapear frases habituales a tools semanticas,
  - `voice_search` soporta parametro `q`,
  - diagnostico de voz muestra la ultima tool ejecutada.
- UI:
  - añadidos botones de prueba manual para las nuevas tools semanticas,
  - diagnostico sigue plegado por defecto,
  - modo presentacion no se satura con estos controles.
- Ficheros creados/modificados:
  - `infra-agent-web/lib/voiceSemantic.js`,
  - `infra-agent-web/lib/voiceApiHandler.js`,
  - `infra-agent-web/pages/api/voice/open-incidents.js`,
  - `infra-agent-web/pages/api/voice/incidents-in-progress.js`,
  - `infra-agent-web/pages/api/voice/critical-risks.js`,
  - `infra-agent-web/pages/api/voice/storage-backup-status.js`,
  - `infra-agent-web/pages/api/voice/monitoring-gaps.js`,
  - `infra-agent-web/pages/api/voice/today-actions.js`,
  - `infra-agent-web/pages/api/voice/search.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - todos los endpoints `/api/voice/*` probados con `curl` devuelven `200`,
  - `POST /api/voice/open-incidents` devuelve `405`,
  - JSON de endpoints semanticos validado con Python,
  - ficheros temporales de validacion eliminados.
- Pendiente de validacion manual en navegador:
  - decir `Dame incidencias abiertas`,
  - decir `Como estan los backups`,
  - decir `Que hacemos hoy`,
  - decir `Busca incidencias de impresoras`,
  - confirmar que se ejecutan las tools internas correctas en diagnostico.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se añadieron herramientas de escritura,
  - no se guardo audio ni transcripciones.

## 2026-05-22 13:39:14 CEST - Dashboard operativo v0.8 modo presentacion y pulido operativo

- Implementado en `/opt/zabbix-codex/infra-agent-web`:
  - modo presentacion con toggle visible,
  - ocultacion de diagnosticos y paneles tecnicos en modo presentacion,
  - indicador de `Ultima actualizacion` usando `updated_at` de `/api/dashboard/latest`,
  - aviso claro si faltan informes para componer el dashboard,
  - bloque `Uso recomendado` con:
    - `Informe diario`,
    - `Matriz de correlacion`,
    - `Riesgos criticos`,
    - `Huecos de monitorizacion`,
    - `Actualizar dashboard`,
  - guia visual breve:
    - pregunta por voz `¿Que es lo mas urgente hoy?`,
    - pregunta por chat `Cruza Zabbix e IncidenciasTI.`,
    - usar `Actualizar dashboard` al inicio del dia,
  - modo presentacion para voz/avatar que oculta detalles tecnicos pero mantiene controles de voz,
  - resumen de acciones recomendadas simplificado en modo presentacion,
  - actualizacion de textos visibles a `Dashboard operativo v0.8`, `Avatar de voz v0.8` y `Memoria operativa v0.8`.
- Comportamiento mantenido:
  - ChatKit textual intacto,
  - voz/avatar intacto,
  - tool-calling interno intacto,
  - `/api/dashboard/latest` intacto,
  - SQLite e historico intactos,
  - endpoints estructurados intactos.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `GET /api/dashboard/latest` devuelve `200`,
  - `GET /api/reports?limit=3` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero.
- Pendiente de validacion manual en navegador:
  - activar/desactivar modo presentacion,
  - confirmar que ChatKit sigue funcionando,
  - confirmar que voz sigue funcionando,
  - confirmar que historico y diagnosticos aparecen al salir de modo presentacion.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se anadio login ni herramientas de escritura,
  - no se guardo audio ni transcripciones.

## 2026-05-22 13:11:05 CEST - Correccion render ChatKit textual v0.7

- Problema diagnosticado:
  - el estado `Chat textual cargado` se basaba en que existian metodos de `useChatKit`, pero esos metodos existen aunque el web component no este listo,
  - el panel podia quedar vacio sin diagnostico suficiente de script, sesion, montaje o evento `ready`,
  - el custom element podia no recibir altura util si la clase CSS no se aplicaba como en un elemento HTML normal.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - añadido diagnostico frontend de ChatKit:
    - `Creando sesion ChatKit...`,
    - `Sesion ChatKit creada`,
    - `ChatKit montado`,
    - `ChatKit error: ...`,
    - estado de script ChatKit,
    - booleano de `client_secret` recibido sin mostrar su valor,
  - `Chat textual cargado` ahora depende del evento real `chatkit.ready`,
  - los prompts rapidos muestran aviso claro si ChatKit aun no esta listo,
  - añadido fallback visible si ChatKit no monta o no queda listo,
  - reforzada altura minima del contenedor `.chat-frame`,
  - reforzado estilo directo y selector `openai-chatkit` para asegurar `display:block`, ancho completo y altura minima,
  - mantenido diagnostico de voz plegado por defecto.
- Ficheros modificados:
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero.
- Pendiente de validacion manual en navegador:
  - confirmar que se ve el input ChatKit,
  - escribir `Dame resumen de IncidenciasTI por estado`,
  - probar boton rapido `Genera matriz de correlacion`,
  - confirmar que voz/avatar sigue visible y el diagnostico de voz sigue plegable.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-05-25 14:08:47 CEST - Hotfix Power BI Ask Lab: serializacion de pregunta y payload

- Causa raiz exacta:
  - el textarea ya mostraba texto valido, pero los handlers del Ask Lab enviaban el payload usando `fetchPowerBiJson()` con un `body` como objeto crudo,
  - el navegador terminaba enviando un cuerpo no serializado y el backend leia `question` vacia, devolviendo `400` con el mensaje de pregunta vacia.
- Correccion aplicada:
  - `fetchPowerBiJson()` serializa automaticamente a JSON los `body` que son objetos simples y añade `Content-Type: application/json` cuando falta,
  - los handlers de Ask Lab siguen leyendo la pregunta desde el estado controlado y ahora emiten trazas seguras con `action`, `questionLength` y `hasQuestion`,
  - se mantiene una sola fuente de verdad visible y se sincroniza con `powerBiAskLab.question`.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - prueba directa con `curl` a `/api/powerbi/models/administracion_ventas/ask/interpret`, `/preview` y `/execute` con `{ \"question\": \"Consulta ventas por cliente\" }` devuelve `metric_by_dimension / ventas_eur / cliente` y `rowCount=10`,
  - logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens` ni `connection strings`.
- Nota de alcance:
  - no se amplía funcionalidad,
  - el chat general Power BI sigue usando el router controlado ya validado; este hotfix solo corrige el Ask Lab y su payload.

## 2026-05-25 14:44:28 CEST - Hotfix Power BI chat textual: respuesta local en el drawer visible

- Causa raiz:
  - el chat textual visible mostraba la burbuja del usuario, pero la respuesta Power BI no quedaba inyectada en el hilo renderizado,
  - la ruta previa dependia demasiado de `sendPrompt()` y del bridge sobre `sendUserMessage`, pero el drawer no mostraba una respuesta local clara.
- Nuevo punto real de integracion:
  - `infra-agent-web/components/InfraChatClient.js`,
  - se centralizo el enrutado en `handlePowerBiChatMessage(prompt, { source })`,
  - `sendPrompt()` reutiliza esa funcion,
  - el envio de ChatKit sigue siendo el camino normal para mensajes no Power BI,
  - cuando la consulta es Power BI soportada, la respuesta se pinta localmente en el drawer visible mediante `PowerBiChatResultView`,
  - el bridge sobre `sendUserMessage` queda como defensa secundaria.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - prueba directa de Ask Lab con `Consulta ventas por cliente`:
    - interpret -> `metric_by_dimension / ventas_eur / cliente`,
    - preview -> OK,
    - execute -> `rowCount=10`,
  - prueba del router Power BI:
    - `Power BI: cuánto hemos vendido` -> `total_metric / ventas_eur`,
    - `Consulta ventas por cliente` -> `metric_by_dimension / ventas_eur / cliente`,
    - `Power BI: margen por cliente` -> rechazo seguro,
  - logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni datos reales extensos.
- Confirmacion de no interferencia:
  - `¿Hay problemas activos en Zabbix?` y `Dame resumen de incidencias TI por estado` siguen su flujo normal fuera de Power BI,
  - emails v0.16.1, Zabbix, SharePoint, MCPs y workflow no se han tocado,
  - `administracion_ventas` sigue siendo el unico modelo con Ask Lab/DAX Lab/diccionario avanzado.

## 2026-05-25 14:44:28 CEST - Hotfix Power BI chat textual: router integrado en ChatKit real

- Causa raiz:
  - la integracion Power BI ya funcionaba en `sendPrompt()`, pero el chat textual visible de `ChatKit` enviaba mensajes por un flujo distinto y no pasaba por el router controlado,
  - por eso el mensaje aparecia como burbuja del usuario, pero no devolvia respuesta Power BI.
- Punto exacto de integracion:
  - `infra-agent-web/components/InfraChatClient.js`,
  - se centralizo el enrutado en `handlePowerBiChatMessage(prompt, { source })`,
  - `sendPrompt()` reutiliza esa funcion,
  - se engancho `chatKitRef.current.sendUserMessage` para interceptar mensajes Power BI antes de que lleguen a ChatKit/OpenAI,
  - se renderiza `PowerBiChatResultView` tambien dentro del drawer de chat para hacer visible la respuesta limitada.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - prueba directa con `POST /api/powerbi/models/administracion_ventas/ask/interpret`, `/preview` y `/execute` usando `{\"question\":\"Consulta ventas por cliente\"}` devuelve `metric_by_dimension / ventas_eur / cliente` y `rowCount=10`,
  - prueba del router de interpretacion:
    - `Power BI: cuánto hemos vendido` => `total_metric / ventas_eur`,
    - `Consulta ventas por cliente` => `metric_by_dimension / ventas_eur / cliente`,
    - `Power BI: margen por cliente` => rechazo seguro,
  - logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens` ni `connection strings`.
- Confirmacion de no interferencia:
  - Zabbix, IncidenciasTI y emails siguen su flujo normal,
  - no se ha abierto DAX libre,
  - `administracion_ventas` sigue siendo el unico modelo con Ask Lab/DAX Lab/diccionario avanzado.

## 2026-05-25 14:08:47 CEST - Hotfix Power BI Ask Lab: serializacion JSON del payload de pregunta

- Causa raiz exacta:
  - la UI del Ask Lab mostraba la pregunta correcta, pero `fetchPowerBiJson()` enviaba el `body` como objeto crudo,
  - el navegador no serializaba ese objeto a JSON y el backend recibia `question` vacia, devolviendo `400`.
- Estado/payload corregido:
  - `fetchPowerBiJson()` ahora serializa objetos simples con `JSON.stringify`,
  - añade `Content-Type: application/json` cuando falta,
  - el Ask Lab sigue usando `powerBiAskQuestion` como estado visible y sincroniza `powerBiAskLab.question` para no perder el texto.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `POST /api/powerbi/models/administracion_ventas/ask/interpret` con `{ \"question\": \"Consulta ventas por cliente\" }` devuelve `metric_by_dimension / ventas_eur / cliente` y confidence `0.9`,
  - `POST /api/powerbi/models/administracion_ventas/ask/preview` OK,
  - `POST /api/powerbi/models/administracion_ventas/ask/execute` devuelve `rowCount=10` y `truncated=false`,
  - logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens` ni `connection strings`.
- Nota de alcance:
  - no se toca backend salvo para mantener el contrato `question`,
  - no se amplía funcionalidad,
  - el chat general Power BI sigue usando el router controlado ya validado.

## 2026-05-25 13:55:55 CEST - Hotfix Power BI Ask Lab: prop de pregunta en scope correcto

- Causa raiz exacta:
  - `PowerBiView` renderizaba el textarea del Ask Lab, pero el valor de la pregunta se había movido a un estado que no se pasaba correctamente al componente,
  - el resultado era `ReferenceError: powerBiAskQuestion is not defined` en el render de `PowerBiView`.
- Correccion aplicada:
  - `PowerBiView` recibe ahora `askQuestion` y `onAskQuestionChange` como props,
  - el textarea usa `value={askQuestion || ""}`,
  - `onChange` actualiza el estado de la pregunta en el componente padre y sincroniza `powerBiAskLab.question`,
  - los handlers de Interpretar / Previsualizar / Ejecutar siguen leyendo `String(powerBiAskQuestion || "").trim()` en el componente padre, sin referencias rotas en el panel.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - prueba directa contra `/api/powerbi/models/administracion_ventas/ask/interpret`, `/preview` y `/execute` con `Consulta ventas por cliente` devuelve `metric_by_dimension / ventas_eur / cliente` y ejecucion limitada,
  - logs revisados sin `powerBiAskQuestion is not defined`, `isPowerBiAdvancedModelKey is not defined`, `formatDate is not defined` ni secretos/tokens.
- Resultado esperado:
  - el Ask Lab conserva el texto escrito,
  - el panel Power BI no debe volver a caer por este `ReferenceError`.

## 2026-05-25 13:51:53 CEST - Hotfix Power BI Ask Lab: estado de pregunta natural

- Causa raiz:
  - el textarea del Ask Lab dependia del estado anidado `powerBiAskLab.question` como unica fuente de verdad,
  - tras los cambios de panel, el handler acababa leyendo una pregunta vacia aunque la UI mostrara texto.
- Campo/estado corregido:
  - se introdujo `powerBiAskQuestion` como estado plano para la pregunta natural,
  - el textarea paso a ser controlado por `value={powerBiAskQuestion}`,
  - `Interpretar`, `Previsualizar consulta` y `Ejecutar en laboratorio` leen `String(powerBiAskQuestion || "").trim()`,
  - el objeto `powerBiAskLab` se sincroniza al escribir para evitar divergencias.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `GET /api/powerbi/status` OK,
  - `GET /api/powerbi/models` OK,
  - `GET /api/powerbi/models/administracion_ventas/ask/interpret` / `preview` / `execute` siguen disponibles,
  - logs revisados sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens` ni `connection strings`.
- Resultado esperado:
  - al escribir una pregunta valida en Ask Lab, ya no debe llegar vacia al backend,
  - la consulta "Consulta ventas por cliente" debe interpretarse como `metric_by_dimension / ventas_eur / cliente`.

## 2026-05-25 13:40:17 CEST - Hotfix Power BI panel: helpers movidos a scope de modulo

- Causa raiz exacta:
  - `PowerBiView` estaba llamando a `isPowerBiAdvancedModelKey` y `formatDate`, pero ambas funciones estaban definidas en un scope no accesible para el bundle del componente,
  - el render del panel Power BI caia en `ReferenceError` y terminaba en el `ErrorBoundary`.
- Helpers corregidos:
  - `POWERBI_ADVANCED_MODEL_KEYS` definido a nivel de modulo,
  - `isPowerBiAdvancedModelKey(modelKey)` definido a nivel de modulo,
  - `formatDate(value)` definido a nivel de modulo,
  - se eliminaron las definiciones locales duplicadas para evitar sombras de scope.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - revision de logs sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni `ReferenceError` de Power BI,
  - verificacion de que el bundle ya compila con los helpers accesibles desde `PowerBiView`.
- Resultado esperado:
  - el panel Power BI deja de caer por `ReferenceError`,
  - `administracion_ventas` sigue siendo el unico modelo con diccionario, DAX Lab y Ask Lab,
  - el resto sigue en discovery-only.

## 2026-05-25 13:34:48 CEST - Hotfix Power BI panel discovery-only para modelos no avanzados

- Causa raiz:
  - el panel Power BI intentaba cargar endpoints avanzados (`catalog/business`, `business-dictionary`, `business-dictionary/quality`, `business-dictionary/review`, `dax-lab/status` y rutas Ask Lab) para modelos distintos de `administracion_ventas`,
  - además, el render no aislaba suficientemente la UI avanzada del resto del panel, lo que facilitaba que un fallo local acabara en el `ErrorBoundary`.
- Correccion aplicada:
  - `infra-agent-web/components/InfraChatClient.js` ahora normaliza los `modelKey` vacios,
  - `loadPowerBiModelSnapshot()` solo consulta endpoints avanzados cuando `modelKey === administracion_ventas`,
  - el render avanzado de diccionario, DAX Lab y Ask Lab queda restringido a `administracion_ventas`,
  - los demas modelos quedan explicitamente en modo discovery-only,
  - los handlers avanzados rechazan cualquier `modelKey` distinto de `administracion_ventas`.
- Validacion realizada:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `GET /api/powerbi/status` OK,
  - `GET /api/powerbi/models` OK,
  - `GET /api/powerbi/models/administracion_ventas/catalog` OK,
  - `GET /api/powerbi/models/administracion_ventas/business-dictionary` OK,
  - `GET /api/powerbi/models/administracion_ventas/business-dictionary/quality` OK,
  - `GET /api/powerbi/models/administracion_ventas/business-dictionary/review` OK,
  - `GET /api/powerbi/models/administracion_ventas/dax-lab/status` OK,
  - escaneo de logs sin `POWERBI_CLIENT_SECRET`, `GRAPH_CLIENT_SECRET`, `access_token`, `Authorization`, `client_secret`, `Bearer`, `tokens`, `connection strings` ni datos reales extensos.
- Resultado esperado:
  - el panel Power BI deja de disparar llamadas avanzadas innecesarias para modelos no soportados,
  - `administracion_ventas` sigue siendo el unico modelo con catalogo avanzado, diccionario, DAX Lab y Ask Lab.

## 2026-05-22 13:19:41 CEST - v0.7 estable validado manualmente

- Confirmacion manual desde navegador en `https://agente-infra.local`:
  - chat textual visible y funcional,
  - input de ChatKit visible correctamente,
  - chat responde,
  - voz/avatar funciona,
  - diagnostico de voz funciona,
  - dashboard sigue funcionando.
- Estado:
  - Dashboard operativo v0.7 queda marcado como estable validado manualmente.
- Ficheros modificados:
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Seguridad:
  - no se toco codigo funcional,
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se toco `.env.local`.

## 2026-05-22 13:02:41 CEST - Correccion v0.7 Realtime y chat textual visible

- Problema corregido:
  - la UI mostraba `Unknown parameter: response.modalities` al iniciar voz,
  - el chat textual quedaba poco visible por debajo del dashboard/panel de voz.
- Cambios aplicados en `/opt/zabbix-codex/infra-agent-web`:
  - eliminado `response.modalities` de los eventos Realtime `response.create`,
  - mantenida salida de audio mediante la configuracion valida de sesion Realtime,
  - ampliadas instrucciones de Realtime para usar `get_dashboard_latest` ante preguntas de estado, urgencias, IncidenciasTI, riesgos, huecos o prioridades,
  - añadido manejo de `response.output_item.done` para tool-calls Realtime,
  - ampliado el error visible de Realtime con `type`, `code`, `param` y mensaje, sin secretos,
  - diagnostico de voz plegado por defecto,
  - chat textual movido a una columna propia con estado visible `Chat textual cargado` / `ChatKit no disponible`,
  - layout ajustado para que el input ChatKit quede visible en escritorio y se muestre antes del dashboard en pantallas estrechas.
- Ficheros modificados:
  - `infra-agent-web/components/VoiceAgentPanel.js`,
  - `infra-agent-web/pages/api/realtime/session.js`,
  - `infra-agent-web/components/InfraChatClient.js`,
  - `infra-agent-web/styles/globals.css`,
  - `infra-agent-web/README.md`,
  - `reports/CHANGELOG.md`.
- Validacion:
  - `npm run build` correcto,
  - `systemctl restart infra-agent-web.service` correcto,
  - `systemctl status infra-agent-web.service --no-pager` activo,
  - `curl -k https://agente-infra.local` devuelve `200`,
  - `POST /api/realtime/session` devuelve `200` sin imprimir token efimero,
  - `POST /api/chatkit/session` devuelve `200` sin imprimir `client_secret`,
  - `GET /api/dashboard/latest` devuelve `200`,
  - `rg` confirma que ya no quedan referencias a `modalities` en `infra-agent-web/components`, `infra-agent-web/pages` ni `infra-agent-web/lib`,
  - escaneo basico sin secretos reales en ficheros modificados; solo placeholders antiguos `Bearer CAMBIAR`.
- Pendiente de validacion manual en navegador:
  - confirmar input ChatKit visible en `https://agente-infra.local`,
  - enviar `Dame resumen de IncidenciasTI por estado` por chat textual,
  - iniciar voz y preguntar `¿Que es lo mas urgente hoy?`,
  - confirmar que se ejecuta `get_dashboard_latest` y ya no aparece `Unknown parameter: response.modalities`.
- Seguridad:
  - no se tocaron Zabbix, SharePoint, MCPs, workflow ni secretos,
  - no se guardo audio,
  - no se guardaron transcripciones ni eventos de voz en SQLite,
  - no se imprimieron `OPENAI_API_KEY`, `OPENAI_WORKFLOW_ID`, tokens MCP, token efimero Realtime ni `client_secret` ChatKit.

## 2026-06-02 08:25:09 CEST - Mapa global de infraestructura para agente Zabbix

- Creado script read-only: `/opt/zabbix-codex/scripts/build_global_infra_map.py`.
- Generados:
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.json`
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.md`
  - `/opt/zabbix-codex/reports/global-monitoring-readiness.md`
  - `/opt/zabbix-codex/reports/global-monitoring-roadmap.md`
- Actualizados:
  - `/opt/zabbix-codex/agent_knowledge/infrastructure_summary.md`
  - `/opt/zabbix-codex/agent_knowledge/monitoring_gaps.json`
- No se modificó Zabbix, Proxmox, PBS, hosts, templates, items, triggers, macros ni acciones.
- Comandos principales:
  - `python3 -m py_compile scripts/build_global_infra_map.py`
  - `python3 scripts/build_global_infra_map.py`
  - `python3 -m json.tool agent_knowledge/global_infrastructure_map.json`

## 2026-06-02 08:26:09 CEST - Mapa global de infraestructura para agente Zabbix

- Creado script read-only: `/opt/zabbix-codex/scripts/build_global_infra_map.py`.
- Generados:
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.json`
  - `/opt/zabbix-codex/agent_knowledge/global_infrastructure_map.md`
  - `/opt/zabbix-codex/reports/global-monitoring-readiness.md`
  - `/opt/zabbix-codex/reports/global-monitoring-roadmap.md`
- Actualizados:
  - `/opt/zabbix-codex/agent_knowledge/infrastructure_summary.md`
  - `/opt/zabbix-codex/agent_knowledge/monitoring_gaps.json`
- No se modificó Zabbix, Proxmox, PBS, hosts, templates, items, triggers, macros ni acciones.
- Comandos principales:
  - `python3 -m py_compile scripts/build_global_infra_map.py`
  - `python3 scripts/build_global_infra_map.py`
  - `python3 -m json.tool agent_knowledge/global_infrastructure_map.json`

## 2026-06-02 08:47:41 CEST - Firewalls en runtime del agente

- Causa raíz: los artefactos ya contenian `firewall_count=3`, pero el runtime del agente no exponia esa categoria de forma explicita en API/chat/monitorizacion viva.
- Añadido endpoint read-only:
  - `/api/infrastructure/firewalls`
- Añadido helper runtime:
  - `/opt/zabbix-codex/infra-agent-web/lib/firewallStatus.js`
- Conectada la categoria `Firewalls / Red perimetral` a:
  - `agent-display/status`
  - `dashboardComposer`
  - router de operaciones de chat/voz
  - informe ejecutivo del agente
- Validacion funcional:
  - `GET /api/infrastructure/firewalls` devuelve `count=3` y los hosts `pfSense-almeria`, `pfSense-La-Plana`, `pfSenseGallarza`.
  - `POST /api/ops/query` con `qué firewalls tenemos` responde con la categoria Firewalls, los 3 hosts, 2 problemas activos y huecos de monitorizacion.
  - `GET /api/agent-display/status` expone `firewallSummary` en runtime.
- Sin cambios en escritura de Zabbix, Power BI, Comunicaciones, IncidenciasTI ni envio de correos.

## 2026-06-02 08:49:31 CEST - Chat textual operativo para Firewalls

- Causa raíz: el runtime Firewalls ya respondia en voz y en `ops/query`, pero el submit del chat textual del drawer solo redirigia a ChatKit/Power BI y no pintaba la respuesta operativa local.
- Correccion:
  - el submit del chat escrito ahora pasa por `handleOpsChatMessage` antes de ChatKit,
  - `firewall_status` se renderiza en el banner operativo del drawer con hosts, problemas y gaps,
  - si el router operativo falla, se muestra mensaje visible en vez de dejar la burbuja del usuario sin respuesta.
- Validacion:
  - `cuantos firewalls tenemos?` muestra respuesta asistente con `pfSense-almeria`, `pfSense-La-Plana` y `pfSenseGallarza`,
  - `estado de los firewalls` y `hay problemas activos en los firewalls` quedan renderizados en el chat escrito,
  - la voz mantiene el comportamiento previo sin regresion.

## 2026-06-02 09:42:20 CEST - Bridge local para chat escrito operativo

- Causa raiz: el compositor real del drawer de ChatKit seguia sin disparar de forma fiable la ruta operativa visible para el texto escrito, aunque el router y la respuesta por voz ya funcionaban.
- Solucion:
  - añadido un bridge local en el drawer de chat con input y historial propios para consultas operativas,
  - el bridge llama directamente a `handleOpsChatMessage` y pinta el resultado dentro del drawer,
  - mantiene ChatKit para conversaciones no operativas.
- Validacion:
  - `cuantos firewalls tenemos?` y `como estan los firewalls?` activan `POST /api/ops/query` y renderizan el resultado local,
  - `hola` sigue quedando fuera del bridge operativo,
  - la voz sigue respondiendo sobre Firewalls sin regresion.

## 2026-06-02 09:43:30 CEST - Pulido UX del bridge operativo local

- Causa raiz: el bridge local resolvia consultas operativas, pero mostraba el resultado duplicado y con exceso de espacio dentro del drawer.
- Solucion:
  - una sola respuesta visible por consulta operativa,
  - formato de burbuja compacta tipo asistente,
  - sin scroll horizontal,
  - input local reducido y sin textos redundantes,
  - detalle plegable solo cuando hace falta.
- Validacion:
  - `cuantos firewalls tenemos?` muestra una unica respuesta compacta con los 3 firewalls,
  - `como estan los firewalls?` y `hay problemas activos en los firewalls?` caben sin barra horizontal,
  - varias consultas seguidas mantienen el historial legible y el input accesible.

## 2026-06-02 09:55:00 CEST - Render corregido para firewall_status

- Estructura real inspeccionada de `/api/ops/query` para `cuantos firewalls tenemos?`:
  - `routed`, `handled`, `kind=firewall_status`, `sourceLabel`, `spokenResponse`, `message`, `intent`, `visualResult`
  - `visualResult` contiene `kind`, `title`, `sourceLabel`, `live`, `summary`, `items`, `hosts`, `gaps`, `activeProblems`, `firewall_count`, `source`, `generatedAt`, `reason`
- Causa raiz: el renderer compacto no estaba usando la estructura real `visualResult` y terminaba mostrando un texto genérico.
- Correccion:
  - `OperationalChatResultView` prioriza `visualResult` y sus campos reales,
  - para `firewall_status` muestra `firewall_count`, hosts, problemas y huecos,
  - si no hay datos, cae a un fallback seguro sin inventar contenido.
- Validacion visual esperada:
  - `cuantos firewalls tenemos?` debe mostrar los 3 hosts monitorizados y el detalle real de problemas/huecos sin duplicados.
