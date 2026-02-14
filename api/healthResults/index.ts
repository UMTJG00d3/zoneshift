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

interface ScanResultRow {
  domain: string;
  healthScore: number;
  scannedAt: string;
  mxCount: number;
  spfFound: boolean;
  spfQualifier: string;
  spfLookupCount: number;
  spfStatus: string;
  dmarcFound: boolean;
  dmarcPolicy: string;
  dmarcStatus: string;
  sslStatus: string;
  sslDaysRemaining: number;
  sslIssuer: string;
  sslValidTo: string;
}

function entityToResult(entity: Record<string, unknown>): ScanResultRow {
  return {
    domain: entity.domain as string,
    healthScore: entity.healthScore as number,
    scannedAt: entity.scannedAt as string,
    mxCount: entity.mxCount as number,
    spfFound: entity.spfFound as boolean,
    spfQualifier: entity.spfQualifier as string,
    spfLookupCount: entity.spfLookupCount as number,
    spfStatus: entity.spfStatus as string,
    dmarcFound: entity.dmarcFound as boolean,
    dmarcPolicy: entity.dmarcPolicy as string,
    dmarcStatus: entity.dmarcStatus as string,
    sslStatus: entity.sslStatus as string,
    sslDaysRemaining: entity.sslDaysRemaining as number,
    sslIssuer: entity.sslIssuer as string,
    sslValidTo: entity.sslValidTo as string,
  };
}

const healthResults: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  try {
    const tableClient = await getTableClient();
    const domain = req.query.domain;
    const history = req.query.history === "true";

    if (domain) {
      // Single domain
      if (history) {
        // Return scan history (exclude "latest" row)
        const results: ScanResultRow[] = [];
        const iterator = tableClient.listEntities({
          queryOptions: {
            filter: `PartitionKey eq '${domain}' and RowKey ne 'latest'`,
          },
        });

        for await (const entity of iterator) {
          results.push(entityToResult(entity as Record<string, unknown>));
          if (results.length >= 30) break; // Last 30 scans
        }

        results.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));

        context.res = { status: 200, headers: { "Content-Type": "application/json" },
          body: { domain, results, count: results.length } };
      } else {
        // Latest only
        try {
          const entity = await tableClient.getEntity(domain, "latest");
          context.res = { status: 200, headers: { "Content-Type": "application/json" },
            body: entityToResult(entity as Record<string, unknown>) };
        } catch (err: unknown) {
          if ((err as { statusCode?: number }).statusCode === 404) {
            context.res = { status: 200, headers: { "Content-Type": "application/json" },
              body: null };
            return;
          }
          throw err;
        }
      }
    } else {
      // All domains (latest only) — scan all partitions for "latest" rows
      const results: ScanResultRow[] = [];
      const iterator = tableClient.listEntities({
        queryOptions: { filter: `RowKey eq 'latest'` },
      });

      for await (const entity of iterator) {
        results.push(entityToResult(entity as Record<string, unknown>));
      }

      results.sort((a, b) => a.domain.localeCompare(b.domain));

      context.res = { status: 200, headers: { "Content-Type": "application/json" },
        body: { results, count: results.length } };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    context.log.error("HealthResults error:", message);
    context.res = { status: 500, headers: { "Content-Type": "application/json" },
      body: { error: message } };
  }
};

export default healthResults;
