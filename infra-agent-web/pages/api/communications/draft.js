import { createCommunicationDraft } from "../../../lib/reportsDb";

function draftViewUrl(draft) {
  const draftId = String(draft?.id || "").trim();
  return draftId ? `/communications/drafts/${encodeURIComponent(draftId)}` : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const draft = await createCommunicationDraft(req.body || {});
    return res.status(201).json({
      ok: true,
      draft_id: draft.id,
      draft,
      view_url: draftViewUrl(draft)
    });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo crear el borrador."
    });
  }
}
