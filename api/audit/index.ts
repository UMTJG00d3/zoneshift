import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";

interface UserPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

export interface AuditLogEntry {
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  details: string;
  ip: string;
  success: boolean;
  errorMessage?: string;
}

interface AuditLogRequest {
  action: string;
  resource: string;
  details?: string;
  success: boolean;
  errorMessage?: string;
}

const TABLE_NAME = "ZoneShiftAuditLog";

function getUserFromHeader(req: HttpRequest): UserPrincipal | null {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;

  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function getTableClient(): Promise<TableClient> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING not configured");
  }

  const serviceClient = TableServiceClient.fromConnectionString(connectionString);

  // Ensure table exists
  try {
    await serviceClient.createTable(TABLE_NAME);
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode !== 409) {
      throw err;
    }
  }

  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

// Helper to log audit event (called internally from other functions)
export async function logAuditEvent(
  userId: string,
  userEmail: string,
  action: string,
  resource: string,
  details: string,
  ip: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const tableClient = await getTableClient();
  const now = new Date();

  // Partition by date (YYYY-MM-DD) for efficient querying
  const partitionKey = now.toISOString().split("T")[0];

  // Row key: timestamp + random suffix for uniqueness
  const rowKey = `${now.toISOString()}_${Math.random().toString(36).substr(2, 9)}`;

  const entity = {
    partitionKey,
    rowKey,
    timestamp: now.toISOString(),
    userId,
    userEmail,
    action,
    resource,
    details,
    ip,
    success,
    errorMessage: errorMessage || "",
  };

  await tableClient.createEntity(entity);
}

const audit: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const user = getUserFromHeader(req);
  if (!user) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: { error: "Authentication required" },
    };
    return;
  }

  try {
    if (req.method === "GET") {
      await handleGet(context, req);
    } else if (req.method === "POST") {
      await handlePost(context, req, user);
    } else {
      context.res = {
        status: 405,
        headers: { "Content-Type": "application/json" },
        body: { error: "Method not allowed" },
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    context.log.error("Audit error:", message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: message },
    };
  }
};

async function handleGet(context: Context, req: HttpRequest): Promise<void> {
  const tableClient = await getTableClient();

  // Get date range from query params (default: last 7 days)
  const endDate = req.query.endDate || new Date().toISOString().split("T")[0];
  const startDateParam = req.query.startDate;
  const startDate = startDateParam || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  })();

  const limit = parseInt(req.query.limit || "100", 10);

  // Query logs within date range
  const logs: AuditLogEntry[] = [];
  const queryFilter = `PartitionKey ge '${startDate}' and PartitionKey le '${endDate}'`;

  const iterator = tableClient.listEntities({
    queryOptions: { filter: queryFilter },
  });

  for await (const entity of iterator) {
    logs.push({
      timestamp: entity.timestamp as string,
      userId: entity.userId as string,
      userEmail: entity.userEmail as string,
      action: entity.action as string,
      resource: entity.resource as string,
      details: entity.details as string,
      ip: entity.ip as string,
      success: entity.success as boolean,
      errorMessage: entity.errorMessage as string | undefined,
    });

    if (logs.length >= limit) break;
  }

  // Sort by timestamp descending (most recent first)
  logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { logs, count: logs.length },
  };
}

async function handlePost(
  context: Context,
  req: HttpRequest,
  user: UserPrincipal
): Promise<void> {
  const body = req.body as AuditLogRequest;
  if (!body || !body.action || !body.resource) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "action and resource are required" },
    };
    return;
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-client-ip"] ||
    "unknown";

  await logAuditEvent(
    user.userId,
    user.userDetails,
    body.action,
    body.resource,
    body.details || "",
    ip,
    body.success,
    body.errorMessage
  );

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { success: true },
  };
}

export default audit;
