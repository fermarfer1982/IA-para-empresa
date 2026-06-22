import { generateDailyDashboard } from "../../../lib/dailyDashboard";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  try {
    const result = await generateDailyDashboard();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({
      error: error?.message || "No se pudo actualizar el dashboard."
    });
  }
}
