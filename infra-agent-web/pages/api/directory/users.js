import { getCompanyDirectoryCacheUpdatedAt } from "../../../lib/reportsDb";
import { listCompanyDirectoryUsers } from "../../../lib/companyDirectory";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const users = await listCompanyDirectoryUsers({
      limit: req.query.limit
    });
    const syncedAt = await getCompanyDirectoryCacheUpdatedAt();

    return res.status(200).json({
      ok: true,
      users,
      total: users.length,
      synced_at: syncedAt || null
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error?.message || "No se pudo cargar la libreta corporativa."
    });
  }
}
