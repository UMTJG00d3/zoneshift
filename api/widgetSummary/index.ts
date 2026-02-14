import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";

const TABLE_NAME = "ZoneShiftScanResults";

async function getTableClient(): Promise<TableClient> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING not configured");

  const serviceClient = TableServiceClient.fromConnectionString(connectionString);
  try { await serviceClient.createTable(TABLE_NAME); }
  catch (err: unknown) { if ((err as { statusCode?: number }).statusCode !== 409) throw err; }

  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

// UMT-HUD WidgetData contract
interface WidgetStat {
  label: string;
  value: string | number;
  type?: "info" | "success" | "warning" | "critical" | "orange";
}

interface WidgetAlert {
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}

interface WidgetData {
  status: "healthy" | "warning" | "critical" | "loading" | "error";
  lastUpdated: string;
  stats: WidgetStat[];
  alerts: WidgetAlert[];
}

const widgetSummary: AzureFunction = async function (context: Context, _req: HttpRequest): Promise<void> {
  try {
    const tableClient = await getTableClient();
    const iterator = tableClient.listEntities({
      queryOptions: { filter: `RowKey eq 'latest'` },
    });

    const domains: { name: string; score: number; scannedAt: string; spfStatus: string; dmarcStatus: string; sslStatus: string }[] = [];
    for await (const entity of iterator) {
      domains.push({
        name: entity.domain as string,
        score: entity.healthScore as number,
        scannedAt: entity.scannedAt as string,
        spfStatus: entity.spfStatus as string,
        dmarcStatus: entity.dmarcStatus as string,
        sslStatus: entity.sslStatus as string,
      });
    }

    if (domains.length === 0) {
      const result: WidgetData = {
        status: "loading",
        lastUpdated: new Date().toISOString(),
        stats: [{ label: "Status", value: "No scan data", type: "info" }],
        alerts: [],
      };
      context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: result };
      return;
    }

    const avgScore = Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length);
    const healthy = domains.filter(d => d.score >= 70).length;
    const warning = domains.filter(d => d.score >= 50 && d.score < 70).length;
    const critical = domains.filter(d => d.score < 50).length;
    const latestScan = domains.reduce((latest, d) => d.scannedAt > latest ? d.scannedAt : latest, "");

    // Determine overall status
    let overallStatus: "healthy" | "warning" | "critical" = "healthy";
    if (critical > 0) overallStatus = "critical";
    else if (warning > 0) overallStatus = "warning";

    // Build stats
    const stats: WidgetStat[] = [
      { label: "Avg Health", value: avgScore, type: avgScore >= 70 ? "success" : avgScore >= 50 ? "warning" : "critical" },
      { label: "Domains", value: domains.length, type: "info" },
      { label: "Healthy", value: healthy, type: "success" },
    ];
    if (critical > 0) stats.push({ label: "Critical", value: critical, type: "critical" });
    else if (warning > 0) stats.push({ label: "Warning", value: warning, type: "warning" });
    else stats.push({ label: "All Clear", value: "✓", type: "success" });

    // Build alerts for problem domains
    const alerts: WidgetAlert[] = [];
    for (const d of domains) {
      if (d.score < 50) {
        const issues: string[] = [];
        if (d.spfStatus === "fail") issues.push("SPF");
        if (d.dmarcStatus === "fail") issues.push("DMARC");
        if (d.sslStatus === "expired" || d.sslStatus === "error") issues.push("SSL");
        alerts.push({
          severity: "critical",
          message: `${d.name}: ${issues.length > 0 ? issues.join(", ") + " failing" : `score ${d.score}`}`,
          timestamp: d.scannedAt,
        });
      } else if (d.score < 70) {
        alerts.push({
          severity: "warning",
          message: `${d.name}: health score ${d.score}`,
          timestamp: d.scannedAt,
        });
      }
    }
    // Limit to 5 most recent alerts
    alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    alerts.splice(5);

    const result: WidgetData = {
      status: overallStatus,
      lastUpdated: latestScan,
      stats,
      alerts,
    };

    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    context.log.error("WidgetSummary error:", message);
    const errorResult: WidgetData = {
      status: "error",
      lastUpdated: new Date().toISOString(),
      stats: [{ label: "Error", value: message, type: "critical" }],
      alerts: [],
    };
    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: errorResult };
  }
};

export default widgetSummary;
