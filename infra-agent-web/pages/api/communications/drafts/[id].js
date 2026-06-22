import {
  deleteCommunicationDraft,
  getCommunicationDraft,
  updateCommunicationDraft
} from "../../../../lib/reportsDb";

function draftViewUrl(draft) {
  const draftId = String(draft?.id || "").trim();
  return draftId ? `/communications/drafts/${encodeURIComponent(draftId)}` : "";
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const draft = await getCommunicationDraft(req.query.id);
      if (!draft) {
        return res.status(404).json({ error: "Borrador no encontrado." });
      }
      return res.status(200).json({
        ok: true,
        draft_id: draft.id,
        draft,
        view_url: draftViewUrl(draft)
      });
    }

    if (req.method === "PATCH") {
      const draft = await updateCommunicationDraft(req.query.id, req.body || {});
      if (!draft) {
        return res.status(404).json({ error: "Borrador no encontrado." });
      }
      return res.status(200).json({
        ok: true,
        draft_id: draft.id,
        draft,
        view_url: draftViewUrl(draft)
      });
    }

    if (req.method === "DELETE") {
      const draft = await deleteCommunicationDraft(req.query.id);
      if (!draft) {
        return res.status(404).json({ error: "Borrador no encontrado." });
      }
      return res.status(200).json({
        ok: true,
        draft_id: draft.id,
        draft,
        view_url: draftViewUrl(draft)
      });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ error: "Método no permitido." });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudo procesar el borrador."
    });
  }
}
