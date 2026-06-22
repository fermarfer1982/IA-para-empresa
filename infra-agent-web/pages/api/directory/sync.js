import { getCompanyDirectoryCacheUpdatedAt } from "../../../lib/reportsDb";
import { syncCompanyDirectory } from "../../../lib/companyDirectory";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await syncCompanyDirectory({
      maxUsers: req.body?.maxUsers
    });
    const syncedAt = await getCompanyDirectoryCacheUpdatedAt();

    return res.status(200).json({
      ok: true,
      synced: result.synced || 0,
      users: result.users || [],
      synced_at: syncedAt || new Date().toISOString()
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo sincronizar la libreta corporativa."
    });
  }
}
