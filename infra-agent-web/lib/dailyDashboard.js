import { composeLatestDashboard } from "./dashboardComposer";
import { generateStructuredReport } from "./structuredReports";

export const DAILY_DASHBOARD_ORDER = [
  "daily-summary",
  "correlation-matrix",
  "critical-risks",
  "monitoring-gaps"
];

export async function generateDailyDashboard() {
  const reports = [];

  for (const kind of DAILY_DASHBOARD_ORDER) {
    const result = await generateStructuredReport(kind);
    reports.push({
      kind,
      report_id: result.report?.id || null,
      title: result.report?.title || null,
      source: result.source,
      warning: result.warning || null
    });
  }

  const dashboard = await composeLatestDashboard();
  return {
    ok: true,
    updated_at: new Date().toISOString(),
    reports,
    dashboard
  };
}
