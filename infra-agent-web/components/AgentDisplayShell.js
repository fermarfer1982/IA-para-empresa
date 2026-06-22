import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

const AVATAR_SOURCES = {
  idle: "/avatar/avatar-en-reposo.mp4",
  active: "/avatar/avatar-hablando.mp4"
};

const STATUS_OPTIONS = [
  { key: "idle", label: "Agente en reposo", tone: "stable" },
  { key: "thinking", label: "Analizando datos", tone: "processing" },
  { key: "speaking", label: "Mostrando respuesta", tone: "active" },
  { key: "alert", label: "Alerta critica", tone: "alert" },
  { key: "reporting", label: "Generando informe", tone: "reporting" }
];

const PRESENTATION_INTERVAL_MS = 15000;

const PRESENTATION_VIEWS = [
  {
    key: "overview",
    label: "Overview",
    title: "Estado general",
    description: "Resumen operativo de infraestructura"
  },
  {
    key: "alerts",
    label: "Alertas",
    title: "Alertas criticas",
    description: "Situaciones que requieren revision"
  },
  {
    key: "recommendations",
    label: "Recomendaciones",
    title: "Siguientes acciones",
    description: "Prioridades propuestas por el agente"
  },
  {
    key: "report",
    label: "Informe",
    title: "Informe activo",
    description: "Ultimo reporte disponible"
  },
  {
    key: "powerbi",
    label: "Power BI",
    title: "Resumen analitico",
    description: "Estado del panel semantico"
  }
];

const FALLBACK_STATUS = {
  ok: true,
  generatedAt: null,
  dataSource: "fallback",
  agentStatus: "idle",
  headline: "Estado general de infraestructura",
  currentMode: "Infraestructura",
  activeReport: null,
  infrastructureSummary: {
    status: "unknown",
    totalHosts: null,
    problems: null,
    criticalProblems: null,
    warningProblems: null
  },
  powerbiSummary: {
      status: "not_connected",
      source: "fallback",
      modelKey: null,
      modelName: null,
      headline: "Power BI pendiente de conexión",
      message: "Power BI pendiente de conexion en esta pantalla",
      kpis: [],
      insights: [],
      updatedAt: null,
      businessSummary: {
        title: "Lectura ejecutiva pendiente",
        summary: "Power BI pendiente de conexión en esta pantalla.",
        highlights: [],
        watchItems: [],
        suggestedQuestions: []
      }
    },
  criticalAlerts: [],
  recommendations: [],
  agentMessage:
    "Centro de control preparado. Esperando estado dinamico del agente."
};

function getAvatarMode(status) {
  return status === "idle" ? "idle" : "active";
}

function getStatusLabel(status) {
  return STATUS_OPTIONS.find((item) => item.key === status)?.label || "Agente";
}

function getCompactStatusLabel(status) {
  if (status === "idle") return "Agente en reposo";
  if (status === "thinking") return "Analizando";
  if (status === "speaking") return "Mostrando respuesta";
  if (status === "alert") return "En alerta";
  if (status === "reporting") return "Generando informe";
  return "Agente activo";
}

function getStatusTone(status) {
  return STATUS_OPTIONS.find((item) => item.key === status)?.tone || "stable";
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function formatDateTime(value) {
  if (!value) {
    return "Pendiente";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function dataSourceLabel(source) {
  if (source === "real") {
    return "real";
  }
  if (source === "mock") {
    return "mock";
  }
  return "fallback";
}

function severityLabel(severity) {
  if (severity === "critical") {
    return "Critico";
  }
  if (severity === "warning") {
    return "Aviso";
  }
  if (severity === "ok") {
    return "OK";
  }
  return "Desconocido";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatPowerbiQueryValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("es-ES", {
      maximumFractionDigits: 2
    }).format(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateTime(value.toISOString());
  }
  return String(value);
}

function getPowerbiQueryColumns(result) {
  const columns = safeArray(result?.columns).filter((column) => column?.name);
  if (columns.length) {
    return columns;
  }

  const firstRow = safeArray(result?.rows)[0];
  if (!firstRow || typeof firstRow !== "object") {
    return [];
  }

  return Object.keys(firstRow).map((name) => ({ name }));
}

function getPowerbiQueryTitle(result) {
  return (
    result?.headline ||
    result?.summary ||
    result?.question ||
    "Resultado de consulta Power BI"
  );
}

function getPowerbiQuerySummary(result) {
  return result?.summary || result?.naturalSummary || result?.message || "Consulta Power BI completada.";
}

function getAlertPresentationTitle(alerts) {
  const normalizedAlerts = safeArray(alerts);
  const hasCritical = normalizedAlerts.some((alert) => {
    const severity = String(alert?.severity || "").toLowerCase();
    return severity === "critical" || severity === "high" || severity === "disaster";
  });

  if (hasCritical) {
    return "Alertas criticas";
  }

  if (normalizedAlerts.length) {
    return "Eventos destacados";
  }

  return "Alertas destacadas";
}

function getPowerbiVisualTitle(powerbiSummary) {
  if (powerbiSummary?.status === "connected") {
    return powerbiSummary?.businessSummary?.title || powerbiSummary?.modelName || "Power BI conectado";
  }
  if (powerbiSummary?.status === "fallback") {
    return "Power BI parcial";
  }
  if (powerbiSummary?.status === "error") {
    return "Power BI con aviso";
  }
  return "Power BI pendiente";
}

function getPowerbiVisualDetail(powerbiSummary) {
  if (powerbiSummary?.status === "connected") {
    return powerbiSummary?.businessSummary?.summary || powerbiSummary?.message || "Integracion Power BI disponible";
  }
  if (powerbiSummary?.status === "fallback") {
    return powerbiSummary?.message || "Hay metadatos disponibles, pero la conexion completa sigue pendiente.";
  }
  if (powerbiSummary?.status === "error") {
    return powerbiSummary?.message || "Power BI requiere revision de conexion.";
  }
  return powerbiSummary?.message || "Preparado para integracion visual";
}

function getPriorityScore(value) {
  const level = String(value || "").trim().toLowerCase();
  if (["disaster", "critical", "critica"].includes(level)) {
    return 3;
  }
  if (["high", "alta", "warning", "medium", "average"].includes(level)) {
    return 2;
  }
  if (["ok", "info", "information", "low", "baja"].includes(level)) {
    return 1;
  }
  return 0;
}

function getPresentationModeLabel(mode) {
  if (mode === "smart") return "Automático inteligente";
  if (mode === "paused") return "Carrusel pausado";
  if (mode === "manual") return "Vista manual";
  return "Automático inteligente";
}

function getFallbackPresentationPlan({
  infrastructureSummary,
  criticalAlerts,
  recommendations,
  activeReport,
  powerbiSummary,
  dataSource
}) {
  const alertPriority = safeArray(criticalAlerts).reduce((highest, alert) => {
    return Math.max(highest, getPriorityScore(alert?.severity));
  }, 0);
  const recommendationPriority = safeArray(recommendations).reduce((highest, item) => {
    return Math.max(highest, getPriorityScore(item?.priority || item?.severity));
  }, 0);
  const infrastructurePriority = getPriorityScore(infrastructureSummary?.status);
  const reportSeverity = getPriorityScore(activeReport?.severity);

  let recommendedView = "overview";
  let reason = "Resumen general disponible";
  let priority = "low";

  if (reportSeverity >= 3) {
    recommendedView = "report";
    reason = "Informe crítico disponible";
    priority = "critical";
  } else if (alertPriority >= 3) {
    recommendedView = "alerts";
    reason = "Alertas de alta prioridad activas";
    priority = "critical";
  } else if (recommendationPriority >= 3) {
    recommendedView = "recommendations";
    reason = "Recomendaciones de alta prioridad pendientes";
    priority = "warning";
  } else if (infrastructurePriority >= 2) {
    recommendedView = "overview";
    reason = "Estado general con incidencias pendientes";
    priority = "warning";
  } else if (
    powerbiSummary?.status === "connected" &&
    (
      safeArray(powerbiSummary?.kpis).length ||
      safeArray(powerbiSummary?.insights).length ||
      safeArray(powerbiSummary?.businessSummary?.highlights).length ||
      safeArray(powerbiSummary?.businessSummary?.suggestedQuestions).length
    )
  ) {
    recommendedView = "powerbi";
    reason = "Power BI conectado con datos útiles";
    priority = "low";
  } else if (powerbiSummary?.status === "not_connected") {
    recommendedView = "overview";
    reason = "Power BI pendiente; priorizando infraestructura";
    priority = "low";
  }

  if (dataSource === "fallback" && recommendedView === "overview" && !safeArray(criticalAlerts).length && !safeArray(recommendations).length) {
    reason = "Sin datos suficientes; mostrando resumen general seguro";
  }

  return {
    recommendedView,
    reason,
    priority,
    rotateSeconds: 15,
    source: dataSource === "real" ? "real" : "fallback"
  };
}

function getSmartPresentationOrder(recommendedView) {
  const order = [recommendedView, "overview", "alerts", "report", "recommendations", "powerbi"];
  return order.filter((item, index) => item && order.indexOf(item) === index);
}

function getNextPresentationViewInOrder(currentKey, order) {
  const currentIndex = order.indexOf(currentKey);
  if (currentIndex === -1) {
    return order[0] || "overview";
  }
  return order[(currentIndex + 1) % order.length] || order[0] || "overview";
}

function getPresentationView(key) {
  return PRESENTATION_VIEWS.find((view) => view.key === key) || PRESENTATION_VIEWS[0];
}

function getNextPresentationViewKey(currentKey) {
  const currentIndex = PRESENTATION_VIEWS.findIndex((view) => view.key === currentKey);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % PRESENTATION_VIEWS.length;
  return PRESENTATION_VIEWS[nextIndex].key;
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="agent-display-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Panel({ title, eyebrow, children, accent = "green" }) {
  return (
    <section className={`agent-display-panel agent-display-panel-${accent}`}>
      <div className="agent-display-panel-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function PresentationStage({
  activeView,
  dataSource,
  infrastructureSummary,
  firewallSummary,
  criticalAlerts,
  recommendations,
  powerbiSummary,
  activeReport,
  powerbiQueryState,
  onPowerbiQuestionSelect
}) {
  const view = getPresentationView(activeView);
  const reportHighlights = safeArray(activeReport?.highlights);
  const reportRisks = safeArray(activeReport?.risks);
  const reportNextActions = safeArray(activeReport?.nextActions);
  const reportSeverity = activeReport?.severity || "unknown";
  const alertTitle = getAlertPresentationTitle(criticalAlerts);
  const powerbiTitle = getPowerbiVisualTitle(powerbiSummary);
  const powerbiDetail = getPowerbiVisualDetail(powerbiSummary);
  const powerbiBusinessSummary = powerbiSummary?.businessSummary || null;
  const powerbiHighlights = safeArray(powerbiBusinessSummary?.highlights);
  const powerbiWatchItems = safeArray(powerbiBusinessSummary?.watchItems);
  const powerbiSuggestedQuestions = safeArray(powerbiBusinessSummary?.suggestedQuestions);
  const powerbiQueryRows = safeArray(powerbiQueryState?.result?.rows);
  const powerbiQueryColumns = getPowerbiQueryColumns(powerbiQueryState?.result);
  const powerbiQueryResultType = powerbiQueryState?.result?.resultType || "unknown";
  const powerbiQueryFirstRow = powerbiQueryRows[0] || null;
  const powerbiQueryMetricValue = powerbiQueryFirstRow ? Object.values(powerbiQueryFirstRow)[0] : null;

  return (
    <section className={`agent-display-presentation agent-display-presentation-${activeView}`}>
      <div className="agent-display-presentation-heading">
        <span>{view.label}</span>
        <strong>
          {activeView === "alerts" ? alertTitle : activeView === "powerbi" ? powerbiTitle : view.title}
        </strong>
        <small>{view.description}</small>
      </div>

      {activeView === "overview" ? (
        <div className="agent-display-presentation-overview">
          {[
            {
              label: "Estado",
              value: valueOrDash(infrastructureSummary.status),
              detail: `Origen ${dataSourceLabel(dataSource)}`
            },
            {
              label: "Problemas",
              value: valueOrDash(infrastructureSummary.problems),
              detail: "Activos / recientes"
            },
            {
              label: "Criticos",
              value: valueOrDash(infrastructureSummary.criticalProblems),
              detail: `${valueOrDash(infrastructureSummary.warningProblems)} warnings`
            },
            {
              label: "Hosts",
              value: valueOrDash(infrastructureSummary.totalHosts),
              detail: "Inventario vivo"
            },
            {
              label: "Firewalls",
              value: valueOrDash(firewallSummary?.count),
              detail: safeArray(firewallSummary?.hosts).length
                ? firewallSummary.hosts.slice(0, 2).join(", ")
                : "Red perimetral",
            }
          ].map((metric) => (
            <article key={metric.label} className="agent-display-overview-card">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>
      ) : null}

      {activeView === "alerts" ? (
        <div className="agent-display-presentation-list">
          {criticalAlerts.length ? criticalAlerts.slice(0, 3).map((alert) => (
            <article key={alert.id || alert.title} className="agent-display-presentation-row is-alert">
              <span>{alert.severity || "Critica"}</span>
              <strong>{alert.title || "Alerta sin titulo"}</strong>
              <small>{alert.source || alert.detail || alert.id || "Sin detalle adicional"}</small>
            </article>
          )) : (
            <article className="agent-display-presentation-empty">
              <strong>Sin alertas criticas destacadas</strong>
              <small>El carrusel continua mostrando recomendaciones, informes y Power BI.</small>
            </article>
          )}
        </div>
      ) : null}

      {activeView === "recommendations" ? (
        <div className="agent-display-presentation-list">
          {recommendations.length ? recommendations.slice(0, 5).map((item, index) => (
            <article key={item.id || item.text || index} className="agent-display-presentation-row">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.text || item.title || "Recomendacion pendiente"}</strong>
              <small>{item.priority || item.severity || "sugerida"}</small>
            </article>
          )) : (
            <article className="agent-display-presentation-empty">
              <strong>Sin recomendaciones live</strong>
              <small>La pantalla queda lista para recomendaciones generadas por backend.</small>
            </article>
          )}
        </div>
      ) : null}

      {activeView === "report" ? (
        <div className={`agent-display-presentation-report agent-display-report-${reportSeverity}`}>
          <div className="agent-display-report-hero">
            <span>{severityLabel(reportSeverity)} · {activeReport?.source || "fallback"}</span>
            <strong>{activeReport?.title || "Informe ejecutivo de infraestructura"}</strong>
            <p>
              {activeReport?.summary ||
                "No hay datos suficientes para generar un resumen ejecutivo completo."}
            </p>
            <small>
              Generado {formatDateTime(activeReport?.generatedAt || activeReport?.updatedAt)}
              {activeReport?.sourceReportTitle ? ` · Contexto: ${activeReport.sourceReportTitle}` : ""}
            </small>
          </div>

          <div className="agent-display-report-grid">
            <section>
              <h3>Puntos destacados</h3>
              <ul>
                {(reportHighlights.length ? reportHighlights : ["Sin destacados disponibles."]).slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section>
              <h3>Riesgos principales</h3>
              <div className="agent-display-report-risk-list">
                {(reportRisks.length ? reportRisks : [{ level: "info", title: "Sin riesgos destacados" }]).slice(0, 2).map((risk, index) => (
                  <article key={`${risk.title || "risk"}-${index}`}>
                    <span>{severityLabel(risk.level)}</span>
                    <strong>{risk.title || "Riesgo pendiente"}</strong>
                    <small>{risk.suggestedAction || risk.detail || "Sin accion sugerida."}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <div className="agent-display-report-actions">
            <span>Proximas acciones</span>
            <div>
              {(reportNextActions.length ? reportNextActions : ["Mantener seguimiento operativo."]).slice(0, 3).map((item) => (
                <strong key={item}>{item}</strong>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "powerbi" ? (
        <div
          className={`agent-display-presentation-powerbi ${
            powerbiSummary?.status === "connected" ? "" : "is-muted"
          }`}
        >
          <span>{powerbiSummary?.headline || "Estado Power BI"}</span>
          <strong>{powerbiTitle}</strong>
          <p>{powerbiDetail}</p>
          {powerbiSummary?.status === "connected" ? (
            <div className="agent-display-powerbi-executive">
              {powerbiSummary?.businessSummary?.summary ? (
                <div className="agent-display-powerbi-executive-summary">
                  <span>Lectura ejecutiva</span>
                  <strong>{powerbiSummary?.businessSummary?.title || powerbiTitle}</strong>
                  <p>{powerbiSummary.businessSummary.summary}</p>
                </div>
              ) : null}

              {powerbiQueryState?.status && powerbiQueryState.status !== "idle" ? (
                <div className={`agent-display-powerbi-query is-${powerbiQueryState.status}`}>
                  <div className="agent-display-powerbi-query-head">
                    <span>
                      {powerbiQueryState.status === "loading"
                        ? "Consultando Power BI"
                        : powerbiQueryState.status === "completed"
                          ? "Consulta activa"
                          : "Consulta con aviso"}
                    </span>
                    <strong>{powerbiQueryState.question || getPowerbiQueryTitle(powerbiQueryState.result)}</strong>
                    <small>
                      {powerbiQueryState.result?.modelName || powerbiSummary?.modelName || "Modelo semántico"}
                    </small>
                  </div>
                  <p>{getPowerbiQuerySummary(powerbiQueryState.result) || powerbiQueryState.error || "Preparado para consultar."}</p>
                  <small>
                    {powerbiQueryState.result?.generatedAt
                      ? `Ejecutado ${formatDateTime(powerbiQueryState.result.generatedAt)}`
                      : powerbiQueryState.startedAt
                        ? `Iniciado ${formatDateTime(powerbiQueryState.startedAt)}`
                        : "Consulta reciente"}
                  </small>

                  {safeArray(powerbiQueryState.result?.warnings).length ? (
                    <div className="agent-display-powerbi-query-warnings">
                      {safeArray(powerbiQueryState.result.warnings).slice(0, 3).map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  ) : null}

                  {safeArray(powerbiQueryState.result?.highlights).length ? (
                    <div className="agent-display-powerbi-query-highlights">
                      {safeArray(powerbiQueryState.result.highlights).slice(0, 4).map((item) => (
                        <strong key={item}>{item}</strong>
                      ))}
                    </div>
                  ) : null}

                  {powerbiQueryResultType === "metric" && powerbiQueryFirstRow ? (
                    <div className="agent-display-powerbi-query-metric">
                      <span>Valor principal</span>
                      <strong>{formatPowerbiQueryValue(powerbiQueryMetricValue)}</strong>
                    </div>
                  ) : null}

                  {powerbiQueryRows.length ? (
                    <div className="agent-display-powerbi-query-table">
                      {powerbiQueryRows.slice(0, 5).map((row, rowIndex) => {
                        const columns = powerbiQueryColumns.slice(0, 4);
                        return (
                          <article
                            key={`${powerbiQueryState.question || "query"}-${rowIndex}`}
                            className="agent-display-powerbi-query-row"
                            style={{ gridTemplateColumns: `minmax(52px, 72px) repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
                          >
                            <strong>{String(rowIndex + 1).padStart(2, "0")}</strong>
                            {columns.length ? (
                              columns.map((column) => (
                                <div key={column.name} className="agent-display-powerbi-query-cell">
                                  <span>{column.name}</span>
                                  <strong>{formatPowerbiQueryValue(row?.[column.name])}</strong>
                                </div>
                              ))
                            ) : (
                              <div className="agent-display-powerbi-query-cell">
                                <span>Resultado</span>
                                <strong>{formatPowerbiQueryValue(row?.value ?? row?.Valor ?? row?.Ventas ?? row?.Unidades ?? row?.[Object.keys(row || {})[0]])}</strong>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {safeArray(powerbiSummary?.kpis).length ? (
                <div className="agent-display-powerbi-kpi-grid">
                  {safeArray(powerbiSummary.kpis).slice(0, 4).map((kpi) => (
                    <article key={kpi.label} className="agent-display-powerbi-kpi-card">
                      <span>{kpi.label}</span>
                      <strong>{kpi.value}</strong>
                      <small>{kpi.detail}</small>
                    </article>
                  ))}
                </div>
              ) : null}

              {powerbiHighlights.length ? (
                <div className="agent-display-powerbi-section">
                  <span>Aspectos clave</span>
                  <ul className="agent-display-powerbi-insight-list">
                    {powerbiHighlights.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {powerbiWatchItems.length ? (
                <div className="agent-display-powerbi-section">
                  <span>Vigilar</span>
                  <ul className="agent-display-powerbi-watch-list">
                    {powerbiWatchItems.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {powerbiSuggestedQuestions.length ? (
                <div className="agent-display-powerbi-questions">
                  <span>Preguntas sugeridas</span>
                  <div>
                    {powerbiSuggestedQuestions.slice(0, 4).map((question) => (
                      <button
                        key={question}
                        type="button"
                        onClick={() => onPowerbiQuestionSelect?.(question)}
                        className="agent-display-powerbi-suggestion"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {safeArray(powerbiSummary?.insights).length ? (
                <div className="agent-display-powerbi-section">
                  <span>Insights</span>
                  <ul className="agent-display-powerbi-insight-list">
                    {safeArray(powerbiSummary.insights).slice(0, 3).map((insight) => (
                      <li key={insight}>{insight}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <small>
                Actualizado {formatDateTime(powerbiSummary?.updatedAt)} · origen {dataSourceLabel(powerbiSummary?.source)}
              </small>
            </div>
          ) : (
            <small>
              {powerbiSummary?.status === "fallback"
                ? "Hay metadatos disponibles, pero la conexion completa sigue pendiente."
                : "Preparado para integracion visual."}
            </small>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function AgentDisplayShell({ avatarAssets = { idle: false, active: false } }) {
  const { data: session } = useSession();
  const [statusPayload, setStatusPayload] = useState(FALLBACK_STATUS);
  const [manualStatus, setManualStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [showDevControls, setShowDevControls] = useState(false);
  const [videoReady, setVideoReady] = useState(avatarAssets);
  const [presentationMode, setPresentationMode] = useState("smart");
  const [activePresentationView, setActivePresentationView] = useState("overview");
  const [manualViewExpiresAt, setManualViewExpiresAt] = useState(null);
  const [powerbiQueryState, setPowerbiQueryState] = useState({
    status: "idle",
    question: null,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null
  });
  const powerbiQueryAbortRef = useRef(null);
  const endpointStatus = statusPayload?.agentStatus || FALLBACK_STATUS.agentStatus;
  const agentStatus = manualStatus || endpointStatus;
  const avatarMode = getAvatarMode(agentStatus);
  const statusTone = getStatusTone(agentStatus);

  const displayData = useMemo(
    () => ({
      ...FALLBACK_STATUS,
      ...(statusPayload || {}),
      agentStatus,
      currentMode:
        agentStatus === "reporting"
          ? "Informes"
          : agentStatus === "speaking"
            ? "Respuesta"
            : agentStatus === "alert"
              ? "Incidencias"
              : "Infraestructura"
    }),
    [agentStatus, statusPayload]
  );

  const infrastructureSummary = displayData.infrastructureSummary || FALLBACK_STATUS.infrastructureSummary;
  const criticalAlerts = safeArray(displayData.criticalAlerts);
  const recommendations = safeArray(displayData.recommendations);
  const powerbiSummary = displayData.powerbiSummary || FALLBACK_STATUS.powerbiSummary;
  const firewallSummary = displayData.firewallSummary || null;
  const activeReport = displayData.activeReport || null;
  const activePresentation = getPresentationView(activePresentationView);
  const alertsPanelTitle = getAlertPresentationTitle(criticalAlerts);
  const powerbiPanelMuted = powerbiSummary?.status !== "connected";
  const devControlsAllowed = Array.isArray(session?.user?.permissions)
    ? session.user.permissions.includes("admin:manage") || session.user.permissions.includes("zabbix:action")
    : false;
  const presentationPlan = displayData.presentation || getFallbackPresentationPlan({
    infrastructureSummary,
    criticalAlerts,
    recommendations,
    activeReport,
    powerbiSummary,
    dataSource: displayData.dataSource
  });
  const presentationModeLabel = getPresentationModeLabel(presentationMode);
  const smartPresentationOrder = getSmartPresentationOrder(presentationPlan.recommendedView || "overview");

  useEffect(
    () => () => {
      if (powerbiQueryAbortRef.current) {
        powerbiQueryAbortRef.current.abort();
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    let abortController = null;

    async function loadStatus() {
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();

      try {
        const response = await fetch("/api/agent-display/status", {
          signal: abortController.signal,
          headers: { Accept: "application/json" }
        });
        const payload = await response.json();
        if (!mounted) {
          return;
        }
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        setStatusPayload({ ...FALLBACK_STATUS, ...payload });
        setStatusError(null);
      } catch (error) {
        if (!mounted || error?.name === "AbortError") {
          return;
        }
        setStatusPayload((current) => ({
          ...FALLBACK_STATUS,
          ...(current || {}),
          dataSource: "fallback",
          agentStatus: current?.agentStatus || "idle",
          generatedAt: new Date().toISOString(),
          agentMessage: "No se pudo actualizar el estado live. Mantengo el ultimo estado conocido."
        }));
        setStatusError(error?.message || "No se pudo actualizar el estado.");
      }
    }

    loadStatus();
    const intervalId = setInterval(loadStatus, 30000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      if (abortController) {
        abortController.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (presentationMode === "smart") {
      setActivePresentationView(presentationPlan.recommendedView || "overview");
    }
  }, [presentationMode, presentationPlan.recommendedView]);

  useEffect(() => {
    if (presentationMode !== "smart") {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setActivePresentationView((current) =>
        getNextPresentationViewInOrder(current, smartPresentationOrder)
      );
    }, PRESENTATION_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [presentationMode, smartPresentationOrder]);

  useEffect(() => {
    if (presentationMode !== "manual" || !manualViewExpiresAt) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setPresentationMode("smart");
      setManualViewExpiresAt(null);
      setActivePresentationView(presentationPlan.recommendedView || "overview");
    }, Math.max(0, manualViewExpiresAt - Date.now()));

    return () => clearTimeout(timeoutId);
  }, [presentationMode, manualViewExpiresAt, presentationPlan.recommendedView]);

  function showNextPresentationView() {
    setActivePresentationView((current) =>
      getNextPresentationViewInOrder(current, smartPresentationOrder)
    );
    setPresentationMode("manual");
    setManualViewExpiresAt(Date.now() + 45000);
  }

  function activateSmartMode() {
    setPresentationMode("smart");
    setManualViewExpiresAt(null);
    setActivePresentationView(presentationPlan.recommendedView || "overview");
  }

  async function runPowerBiQuestion(question) {
    const nextQuestion = String(question || "").trim();
    if (!nextQuestion) {
      return;
    }

    if (powerbiQueryAbortRef.current) {
      powerbiQueryAbortRef.current.abort();
    }

    const abortController = new AbortController();
    powerbiQueryAbortRef.current = abortController;
    const startedAt = new Date().toISOString();

    setPowerbiQueryState({
      status: "loading",
      question: nextQuestion,
      result: null,
      error: null,
      startedAt,
      finishedAt: null
    });
    setActivePresentationView("powerbi");
    setPresentationMode("manual");
    setManualViewExpiresAt(Date.now() + 45000);

    try {
      const response = await fetch("/api/agent-display/powerbi-query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          question: nextQuestion,
          modelKey: powerbiSummary?.modelKey || "administracion_ventas"
        }),
        signal: abortController.signal
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.summary || payload?.error || "No se pudo ejecutar la consulta Power BI.");
      }

      if (abortController.signal.aborted) {
        return;
      }

      setPowerbiQueryState({
        status: payload?.status || "completed",
        question: payload?.question || nextQuestion,
        result: {
          ...payload,
          rows: safeArray(payload?.rows).slice(0, 10),
          columns: safeArray(payload?.columns).slice(0, 8)
        },
        error: null,
        startedAt,
        finishedAt: payload?.generatedAt || new Date().toISOString()
      });
    } catch (error) {
      if (error?.name === "AbortError" || abortController.signal.aborted) {
        return;
      }

      setPowerbiQueryState({
        status: "error",
        question: nextQuestion,
        result: {
          ok: false,
          status: "error",
          generatedAt: new Date().toISOString(),
          question: nextQuestion,
          headline: "Consulta Power BI con aviso",
          summary: error?.message || "No se pudo ejecutar la consulta Power BI.",
          resultType: "text",
          columns: [],
          rows: [],
          highlights: [],
          warnings: [error?.message || "No se pudo ejecutar la consulta Power BI."]
        },
        error: error?.message || "No se pudo ejecutar la consulta Power BI.",
        startedAt,
        finishedAt: new Date().toISOString()
      });
    }
  }

  function togglePauseMode() {
    setPresentationMode((current) => {
      if (current === "paused") {
        setActivePresentationView(presentationPlan.recommendedView || "overview");
        return "smart";
      }
      setManualViewExpiresAt(null);
      return "paused";
    });
  }

  return (
    <main className={`agent-display-shell agent-display-${statusTone}`}>
      <div className="agent-display-orbit agent-display-orbit-one" />
      <div className="agent-display-orbit agent-display-orbit-two" />

      <header className="agent-display-header">
        <div className="agent-display-header-brand">
          <div className="agent-display-avatar-compact" aria-label="Avatar del agente">
            <div className="agent-display-avatar-compact-frame">
              {avatarAssets.idle ? (
                <video
                  className={`agent-display-avatar-video ${
                    avatarMode === "idle" && videoReady.idle ? "is-visible" : ""
                  }`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-label="Avatar en reposo"
                  onError={() => setVideoReady((state) => ({ ...state, idle: false }))}
                >
                  <source src={AVATAR_SOURCES.idle} type="video/mp4" />
                </video>
              ) : null}
              {avatarAssets.active ? (
                <video
                  className={`agent-display-avatar-video ${
                    avatarMode === "active" && videoReady.active ? "is-visible" : ""
                  }`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-label="Avatar hablando"
                  onError={() => setVideoReady((state) => ({ ...state, active: false }))}
                >
                  <source src={AVATAR_SOURCES.active} type="video/mp4" />
                </video>
              ) : null}
              <div className="agent-display-video-fallback">
                <span>IA</span>
              </div>
            </div>
            <small className="agent-display-avatar-compact-label">{getCompactStatusLabel(agentStatus)}</small>
          </div>
          <div>
            <p className="agent-display-kicker">Infra Agent Command Center</p>
            <h1>Centro visual del agente inteligente</h1>
          </div>
        </div>
        <div className="agent-display-status-stack">
          <span className="agent-display-clock">v0.21.0</span>
          <strong>{getStatusLabel(agentStatus)}</strong>
          <small>Modo: {displayData.currentMode}</small>
          <small>Vista: {activePresentation.label}</small>
          <small>Prioridad: {presentationModeLabel}</small>
          <small>Origen: {dataSourceLabel(displayData.dataSource)}</small>
          <small>Actualizado: {formatDateTime(displayData.generatedAt)}</small>
        </div>
      </header>

      <section className="agent-display-layout" aria-label="Centro de control del agente">
        <div className="agent-display-left-rail">
          <Panel title="Estado infraestructura" eyebrow="Live ready">
            <div className="agent-display-metric-grid">
              <MetricCard
                label="Estado"
                value={valueOrDash(infrastructureSummary.status)}
                detail="Infraestructura"
              />
              <MetricCard
                label="Hosts"
                value={valueOrDash(infrastructureSummary.totalHosts)}
                detail="Total detectado"
              />
              <MetricCard
                label="Problemas"
                value={valueOrDash(infrastructureSummary.problems)}
                detail="Activos / recientes"
              />
              <MetricCard
                label="Criticos"
                value={valueOrDash(infrastructureSummary.criticalProblems)}
                detail={`Warnings ${valueOrDash(infrastructureSummary.warningProblems)}`}
              />
              <MetricCard
                label="Firewalls"
                value={valueOrDash(firewallSummary?.count)}
                detail={
                  safeArray(firewallSummary?.hosts).length
                    ? firewallSummary.hosts.slice(0, 2).join(", ")
                    : "Red perimetral"
                }
              />
            </div>
          </Panel>

          <Panel title={alertsPanelTitle} eyebrow="Prioridad" accent="amber">
            <div className="agent-display-alert-list">
              {criticalAlerts.length ? criticalAlerts.map((alert) => (
                <article key={alert.id || alert.title} className="agent-display-alert-row">
                  <span>{alert.id}</span>
                  <strong>{alert.title || "Alerta sin titulo"}</strong>
                  <small>{alert.severity || "critica"}</small>
                </article>
              )) : (
                <article className="agent-display-alert-row">
                  <span>OK</span>
                  <strong>Sin alertas criticas destacadas</strong>
                  <small>{dataSourceLabel(displayData.dataSource)}</small>
                </article>
              )}
            </div>
          </Panel>
        </div>

        <section className="agent-display-center-column" aria-label="Contenido principal del agente">
          <div className="agent-display-agent-message">
            <span>{displayData.headline || getStatusLabel(agentStatus)}</span>
            <p>{displayData.agentMessage}</p>
            <small className="agent-display-priority-note">
              Vista priorizada por el agente · Motivo: {presentationPlan.reason}
            </small>
            {statusError ? <small>Error de actualizacion: {statusError}</small> : null}
          </div>

          <PresentationStage
            activeView={activePresentationView}
            dataSource={displayData.dataSource}
            infrastructureSummary={infrastructureSummary}
            firewallSummary={firewallSummary}
            criticalAlerts={criticalAlerts}
            recommendations={recommendations}
            powerbiSummary={powerbiSummary}
            activeReport={activeReport}
            powerbiQueryState={powerbiQueryState}
            onPowerbiQuestionSelect={runPowerBiQuestion}
          />
        </section>

        <div className="agent-display-right-rail">
          <Panel
            title={powerbiPanelMuted ? "Power BI pendiente" : powerbiSummary?.modelName || "Power BI / Ventas"}
            eyebrow="Modelo semantico"
            accent="cyan"
          >
            <div className={`agent-display-powerbi-card${powerbiPanelMuted ? " is-muted" : ""}`}>
              <strong>{powerbiSummary?.businessSummary?.title || powerbiSummary?.headline || "Resumen Power BI"}</strong>
              <span>{powerbiSummary?.status || "not_connected"}</span>
              <p>{getPowerbiVisualDetail(powerbiSummary)}</p>
              <small>
                {powerbiSummary?.status === "connected"
                  ? `Actualizado ${formatDateTime(powerbiSummary?.updatedAt)} · origen ${dataSourceLabel(powerbiSummary?.source)}`
                  : `Origen ${dataSourceLabel(powerbiSummary?.source)} · integracion pendiente`}
              </small>
              {powerbiSummary?.status === "connected" && safeArray(powerbiSummary?.kpis).length ? (
                <div className="agent-display-powerbi-kpi-grid is-compact">
                  {safeArray(powerbiSummary.kpis).slice(0, 2).map((kpi) => (
                    <article key={kpi.label} className="agent-display-powerbi-kpi-card">
                      <span>{kpi.label}</span>
                      <strong>{kpi.value}</strong>
                    </article>
                  ))}
                </div>
              ) : null}
              {safeArray(powerbiSummary?.businessSummary?.suggestedQuestions).length ? (
                <div className="agent-display-powerbi-chip-row">
                  {safeArray(powerbiSummary.businessSummary.suggestedQuestions).slice(0, 2).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="agent-display-powerbi-suggestion"
                      onClick={() => runPowerBiQuestion(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Ultimo informe" eyebrow="Reporting" accent="blue">
            <div className="agent-display-report-card">
              <strong>{activeReport?.title || "Sin informe activo"}</strong>
              <span>
                {severityLabel(activeReport?.severity)} · {activeReport?.status || "Pendiente"}
              </span>
              <small>Generado {formatDateTime(activeReport?.generatedAt || activeReport?.updatedAt)}</small>
            </div>
          </Panel>

          <Panel title="Firewalls / Red perimetral" eyebrow="Perimetro" accent="amber">
            <div className="agent-display-firewall-card">
              <strong>{valueOrDash(firewallSummary?.count)}</strong>
              <span>{firewallSummary?.category || "Firewalls / Red perimetral"}</span>
              <small>
                {safeArray(firewallSummary?.hosts).length
                  ? firewallSummary.hosts.join(", ")
                  : "Sin hosts listados"}
              </small>
              <p>
                {firewallSummary?.summary?.status
                  ? `Estado ${firewallSummary.summary.status} · ${valueOrDash(firewallSummary.summary.activeProblems)} problemas activos · ${valueOrDash(firewallSummary.summary.gaps)} huecos`
                  : "Resumen de firewalls disponible desde el runtime del agente."}
              </p>
            </div>
          </Panel>

          <Panel title="Consulta activa" eyebrow="Agente" accent="green">
            <div className="agent-display-query-card">
              <p>
                {recommendations?.[0]?.text ||
                  "Preparado para recibir consulta de infraestructura, informe o Power BI."}
              </p>
              <span>
                {recommendations.length
                  ? `${recommendations.length} recomendaciones disponibles`
                  : "Sin recomendaciones live en este momento"}
              </span>
            </div>
          </Panel>
        </div>
      </section>

      <footer className="agent-display-footer">
        <div>
          <span className="agent-display-signal" />
          Ultima actualizacion {formatDateTime(displayData.generatedAt)} · origen {dataSourceLabel(displayData.dataSource)} · vista {activePresentation.label}.
        </div>
        {devControlsAllowed ? (
          <button
            type="button"
            className="agent-display-dev-toggle"
            onClick={() => setShowDevControls((value) => !value)}
          >
            {showDevControls ? "Ocultar Dev" : "Dev"}
          </button>
        ) : null}
      </footer>

      {showDevControls && devControlsAllowed ? (
        <aside className="agent-display-dev-controls" aria-label="Controles de desarrollo">
          <button
            type="button"
            className={presentationMode === "smart" ? "is-active" : ""}
            onClick={activateSmartMode}
          >
            Automático inteligente
          </button>
          <button
            type="button"
            className={presentationMode === "paused" ? "is-active" : ""}
            onClick={togglePauseMode}
          >
            Carrusel pausado
          </button>
          <button
            type="button"
            className={presentationMode === "manual" ? "is-active" : ""}
            onClick={showNextPresentationView}
          >
            Siguiente vista
          </button>
          <button
            type="button"
            className={presentationMode === "smart" ? "is-active" : ""}
            onClick={activateSmartMode}
          >
            Volver a auto
          </button>
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={manualStatus === option.key ? "is-active" : ""}
              onClick={() => setManualStatus(option.key)}
            >
              {option.label}
            </button>
          ))}
        </aside>
      ) : null}
    </main>
  );
}
