import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";

const TABLE_NAME = "ZoneShiftScannerConfig";

async function getTableClient(): Promise<TableClient> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING not configured");

  const serviceClient = TableServiceClient.fromConnectionString(connectionString);
  try { await serviceClient.createTable(TABLE_NAME); }
  catch (err: unknown) { if ((err as { statusCode?: number }).statusCode !== 409) throw err; }

  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

const scanConfig: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  // Require SWA auth
  const clientPrincipal = req.headers["x-ms-client-principal"];
  if (!clientPrincipal) {
    context.res = { status: 401, headers: { "Content-Type": "application/json" },
      body: { error: "Authentication required" } };
    return;
  }

  try {
    if (req.method === "GET") {
      const tableClient = await getTableClient();
      try {
        const entity = await tableClient.getEntity("scanner", "constellix");
        context.res = { status: 200, headers: { "Content-Type": "application/json" },
          body: { configured: true, apiKey: (entity.apiKey as string).substring(0, 8) + "..." } };
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 404) {
          context.res = { status: 200, headers: { "Content-Type": "application/json" },
            body: { configured: false } };
          return;
        }
        throw err;
      }
    } else if (req.method === "POST") {
      const { apiKey, secretKey } = req.body || {};
      if (!apiKey || !secretKey) {
        context.res = { status: 400, headers: { "Content-Type": "application/json" },
          body: { error: "apiKey and secretKey required" } };
        return;
      }

      const tableClient = await getTableClient();
      await tableClient.upsertEntity({
        partitionKey: "scanner",
        rowKey: "constellix",
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
      }, "Replace");

      context.res = { status: 200, headers: { "Content-Type": "application/json" },
        body: { success: true } };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    context.log.error("ScanConfig error:", message);
    context.res = { status: 500, headers: { "Content-Type": "application/json" },
      body: { error: message } };
  }
};

export default scanConfig;
