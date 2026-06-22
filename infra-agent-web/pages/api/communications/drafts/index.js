import {
  createCommunicationDraft,
  getCommunicationDraftSummary,
  listCommunicationDrafts
} from "../../../../lib/reportsDb";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const drafts = await listCommunicationDrafts({
        limit: req.query.limit,
        status: req.query.status,
        type: req.query.type,
        source_type: req.query.source_type,
        template_id: req.query.template_id
      });
      const summary = await getCommunicationDraftSummary();
      return res.status(200).json({ drafts, summary });
    }

    if (req.method === "POST") {
      const draft = await createCommunicationDraft(req.body || {});
      return res.status(201).json({ draft });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método no permitido." });
  } catch (error) {
    return res.status(400).json({
      error: error?.message || "No se pudieron procesar los borradores."
    });
  }
}
