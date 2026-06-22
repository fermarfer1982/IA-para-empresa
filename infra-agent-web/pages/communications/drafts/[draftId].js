import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { getCommunicationDraft } from "../../../lib/reportsDb";

const communicationTypes = {
  email: "Email",
  teams: "Teams"
};

const communicationStatuses = {
  draft: "Borrador",
  ready_for_review: "Listo para revisión",
  reviewed: "Revisado",
  copied: "Copiado",
  discarded: "Descartado"
};

const communicationSourceTypes = {
  daily_report: "Informe diario",
  matrix: "Matriz",
  incident: "Incidencia",
  risk: "Riesgo",
  manual: "Manual"
};

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeDraft(draft = {}) {
  const normalizedId = draft?.id ?? draft?.draft_id ?? "";
  return {
    id: normalizedId ? Number(normalizedId) || String(normalizedId) : "",
    draft_id: normalizedId ? Number(normalizedId) || String(normalizedId) : "",
    type: draft?.type ?? draft?.communication_type ?? "email",
    status: draft?.status ?? "draft",
    template_id: draft?.template_id ?? draft?.template_key ?? draft?.template ?? "",
    recipient_label: draft?.recipient_label ?? draft?.recipientLabel ?? "",
    recipient_email: draft?.recipient_email ?? draft?.recipientEmail ?? "",
    source_type: draft?.source_type ?? draft?.sourceType ?? "manual",
    source_report_id: draft?.source_report_id ?? draft?.sourceReportId ?? "",
    source_incident_id: draft?.source_incident_id ?? draft?.sourceIncidentId ?? "",
    subject: draft?.subject ?? "",
    body_markdown: draft?.body_markdown ?? draft?.bodyMarkdown ?? "",
    body_text: draft?.body_text ?? draft?.bodyText ?? "",
    body_html: draft?.body_html ?? draft?.bodyHtml ?? "",
    review_notes: draft?.review_notes ?? draft?.reviewNotes ?? "",
    created_at: draft?.created_at ?? draft?.createdAt ?? "",
    updated_at: draft?.updated_at ?? draft?.updatedAt ?? ""
  };
}

function labelFromMap(map, value) {
  return map[String(value || "").trim()] || value || "—";
}

function buildTextBlock(draft) {
  return [
    `Borrador #${draft.id}`,
    `Estado: ${labelFromMap(communicationStatuses, draft.status)}`,
    `Tipo: ${labelFromMap(communicationTypes, draft.type)}`,
    `Plantilla: ${draft.template_id || "—"}`,
    `Destinatario: ${draft.recipient_label || "—"}`,
    `Email: ${draft.recipient_email || "—"}`,
    `Fuente incidencia ID: ${draft.source_incident_id || "—"}`,
    `Fuente informe ID: ${draft.source_report_id || "—"}`,
    `Fecha creación: ${formatDate(draft.created_at)}`,
    `Fecha actualización: ${formatDate(draft.updated_at)}`
  ].join("\n");
}

function buildMarkdownBlock(draft) {
  return [
    `# ${draft.subject || `Borrador #${draft.id}`}`,
    "",
    `- Estado: ${labelFromMap(communicationStatuses, draft.status)}`,
    `- Tipo: ${labelFromMap(communicationTypes, draft.type)}`,
    `- Plantilla: ${draft.template_id || "—"}`,
    `- Destinatario: ${draft.recipient_label || "—"}`,
    `- Email: ${draft.recipient_email || "—"}`,
    `- Fuente: ${labelFromMap(communicationSourceTypes, draft.source_type)}`,
    `- Fuente incidencia ID: ${draft.source_incident_id || "—"}`,
    `- Fuente informe ID: ${draft.source_report_id || "—"}`,
    `- Fecha creación: ${formatDate(draft.created_at)}`,
    `- Fecha actualización: ${formatDate(draft.updated_at)}`,
    "",
    "## Cuerpo",
    "",
    draft.body_markdown || draft.body_text || ""
  ].join("\n");
}

function buildPlainTextBlock(draft) {
  return [
    `Borrador #${draft.id}`,
    `Estado: ${labelFromMap(communicationStatuses, draft.status)}`,
    `Tipo: ${labelFromMap(communicationTypes, draft.type)}`,
    `Plantilla: ${draft.template_id || "—"}`,
    `Destinatario: ${draft.recipient_label || "—"}`,
    `Email: ${draft.recipient_email || "—"}`,
    `Fuente: ${labelFromMap(communicationSourceTypes, draft.source_type)}`,
    `Fuente incidencia ID: ${draft.source_incident_id || "—"}`,
    `Fuente informe ID: ${draft.source_report_id || "—"}`,
    `Fecha creación: ${formatDate(draft.created_at)}`,
    `Fecha actualización: ${formatDate(draft.updated_at)}`,
    "",
    draft.body_text || draft.body_markdown || ""
  ].join("\n");
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function getServerSideProps(context) {
  const initialDraftId = String(context?.params?.draftId || "").trim();
  if (!initialDraftId) {
    return {
      props: {
        initialDraftId: "",
        initialDraft: null,
        initialError: "Escribe un ID de borrador válido."
      }
    };
  }

  try {
    const draft = await getCommunicationDraft(initialDraftId);
    if (!draft) {
      return {
        props: {
          initialDraftId,
          initialDraft: null,
          initialError: "Borrador no encontrado."
        }
      };
    }

    return {
      props: {
        initialDraftId,
        initialDraft: normalizeDraft(draft || {}),
        initialMessage: `Borrador #${draft?.id || initialDraftId} cargado. No se ha enviado nada.`,
        initialError: ""
      }
    };
  } catch (error) {
    return {
      props: {
        initialDraftId,
        initialDraft: null,
        initialError: error?.message || "No se pudo cargar el borrador."
      }
    };
  }
}

export default function CommunicationDraftViewerPage({
  initialDraftId = "",
  initialDraft = null,
  initialMessage = "",
  initialError = ""
}) {
  const router = useRouter();
  const rawDraftId = useMemo(
    () =>
      Array.isArray(router.query.draftId)
        ? router.query.draftId[0]
        : router.query.draftId || initialDraftId,
    [initialDraftId, router.query.draftId]
  );
  const draftId = String(rawDraftId || "").trim();
  const [draft, setDraft] = useState(() => (initialDraft ? normalizeDraft(initialDraft) : null));
  const [loading, setLoading] = useState(() => !initialDraft && !initialError);
  const [error, setError] = useState(initialError || "");
  const [message, setMessage] = useState(initialMessage || "");
  const [showHtml, setShowHtml] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!router.isReady) {
      return undefined;
    }

    if (!draftId) {
      setError("Escribe un ID de borrador válido.");
      setLoading(false);
      return undefined;
    }

    if (draft?.id && String(draft.id) === draftId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function loadDraft() {
      setLoading(true);
      setError("");
      setMessage("");
      try {
        const response = await fetch(`/api/communications/drafts/${encodeURIComponent(draftId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Borrador no encontrado.");
        }
        if (cancelled) {
          return;
        }
        const normalized = normalizeDraft(data.draft || {});
        setDraft(normalized);
        setMessage(`Borrador #${normalized.id} cargado. No se ha enviado nada.`);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setDraft(null);
        setError(loadError?.message || "No se pudo cargar el borrador.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, [draft, draftId, router.isReady]);

  useEffect(() => {
    setShowHtml(false);
  }, [draft?.id]);

  async function copyText(text) {
    if (!text) {
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  async function patchDraft(patch) {
    if (!draft?.id) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/communications/drafts/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar el borrador.");
      }
      const normalized = normalizeDraft(data.draft || {});
      setDraft(normalized);
      setMessage(`Borrador #${normalized.id} actualizado. No se ha enviado nada.`);
    } catch (patchError) {
      setMessage(patchError?.message || "No se pudo actualizar el borrador.");
    } finally {
      setBusy(false);
    }
  }

  function downloadDraft(format) {
    if (!draft?.id) {
      return;
    }

    const safeId = String(draft.id).replace(/[^0-9A-Za-z_-]+/g, "_");
    if (format === "markdown") {
      triggerDownload(
        `borrador-${safeId}.md`,
        buildMarkdownBlock(draft),
        "text/markdown;charset=utf-8"
      );
      return;
    }

    if (format === "html") {
      const html = draft.body_html || buildTextBlock(draft).replace(/\n/g, "<br />");
      triggerDownload(`borrador-${safeId}.html`, html, "text/html;charset=utf-8");
    }
  }

  const title = draft?.id ? `Borrador #${draft.id}` : draftId ? `Borrador #${draftId}` : "Borrador";

  return (
    <>
      <Head>
        <title>{`${title} - Comunicaciones`}</title>
        <meta
          name="description"
          content="Visor dedicado de borradores de comunicaciones por ID."
        />
      </Head>
      <main className="chat-section">
        <section className="communications-section communication-draft-page">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Visor dedicado</p>
              <h1>{title}</h1>
              <p className="summary">No se ha enviado nada.</p>
            </div>
            <div className="communications-header-actions">
              <Link
                href={`/?view=communications&draftId=${encodeURIComponent(String(draft?.id || draftId || ""))}`}
                className="action-button secondary-action"
              >
                Volver a Comunicaciones
              </Link>
              {draft?.id ? (
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => copyText(buildPlainTextBlock(draft))}
                  disabled={busy || loading}
                >
                  Copiar todo
                </button>
              ) : null}
            </div>
          </div>

          {message ? <div className="report-message">{message}</div> : null}
          {loading ? (
            <div className="structured-loading">Cargando borrador...</div>
          ) : error ? (
            <div className="structured-warning">{error}</div>
          ) : draft ? (
            <>
              <div className="communications-summary" aria-label="Resumen de borrador">
                <div>
                  <strong>{draft.id}</strong>
                  <span>ID</span>
                </div>
                <div>
                  <strong>{labelFromMap(communicationStatuses, draft.status)}</strong>
                  <span>Estado</span>
                </div>
                <div>
                  <strong>{labelFromMap(communicationTypes, draft.type)}</strong>
                  <span>Tipo</span>
                </div>
                <div>
                  <strong>{labelFromMap(communicationSourceTypes, draft.source_type)}</strong>
                  <span>Fuente</span>
                </div>
                <div>
                  <strong>{draft.recipient_email || "No informado"}</strong>
                  <span>Destinatario</span>
                </div>
                <div>
                  <strong>{draft.source_incident_id || "No informado"}</strong>
                  <span>Incidencia</span>
                </div>
              </div>

              <div className="communications-diagnostics">
                <span>Asunto: {draft.subject || "—"}</span>
                <span>Plantilla: {draft.template_id || "—"}</span>
                <span>Fuente informe ID: {draft.source_report_id || "—"}</span>
                <span>Fecha creación: {formatDate(draft.created_at)}</span>
                <span>Fecha actualización: {formatDate(draft.updated_at)}</span>
              </div>

              <div className="report-list-actions">
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => copyText(draft.subject || "")}
                  disabled={busy}
                >
                  Copiar asunto
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => copyText(draft.body_markdown || draft.body_text || draft.body_html || "")}
                  disabled={busy}
                >
                  Copiar cuerpo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => copyText(buildPlainTextBlock(draft))}
                  disabled={busy}
                >
                  Copiar todo
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => patchDraft({ status: "ready_for_review" })}
                  disabled={busy}
                >
                  Marcar listo para revisión
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => patchDraft({ status: "reviewed" })}
                  disabled={busy}
                >
                  Marcar revisado
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => downloadDraft("markdown")}
                  disabled={busy}
                >
                  Descargar Markdown
                </button>
                <button
                  type="button"
                  className="action-button secondary-action"
                  onClick={() => downloadDraft("html")}
                  disabled={busy || !draft.body_html}
                >
                  Descargar HTML
                </button>
              </div>

              <div className="structured-note">No se ha enviado nada.</div>

              <div className="report-detail">
                <div className="report-detail-header">
                  <div>
                    <h3>Cuerpo Markdown</h3>
                  </div>
                  <span>{draft.body_markdown ? "Disponible" : "No informado"}</span>
                </div>
                <pre>{draft.body_markdown || "No informado."}</pre>
              </div>

              <div className="report-detail">
                <div className="report-detail-header">
                  <div>
                    <h3>Cuerpo texto</h3>
                  </div>
                  <span>{draft.body_text ? "Disponible" : "No informado"}</span>
                </div>
                <pre>{draft.body_text || "No informado."}</pre>
              </div>

              {draft.body_html ? (
                <div className="report-detail">
                  <div className="report-detail-header">
                    <div>
                      <h3>Cuerpo HTML</h3>
                    </div>
                    <span>{showHtml ? "Visible" : "Oculto"}</span>
                  </div>
                  <div className="report-list-actions">
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={() => setShowHtml((current) => !current)}
                    >
                      {showHtml ? "Ocultar HTML" : "Ver HTML"}
                    </button>
                    <button
                      type="button"
                      className="action-button secondary-action"
                      onClick={() => copyText(draft.body_html || "")}
                      disabled={busy}
                    >
                      Copiar HTML
                    </button>
                  </div>
                  {showHtml ? <pre>{draft.body_html}</pre> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </main>
    </>
  );
}
