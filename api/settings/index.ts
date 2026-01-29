import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";

interface UserPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

interface UserSettings {
  constellixApiKey?: string;
  constellixSecretKey?: string;
}

const TABLE_NAME = "ZoneShiftUserSettings";

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
    // Table already exists is fine
    if ((err as { statusCode?: number }).statusCode !== 409) {
      throw err;
    }
  }

  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

const settings: AzureFunction = async function (
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

  const userId = user.userId;

  try {
    if (req.method === "GET") {
      await handleGet(context, userId);
    } else if (req.method === "PUT") {
      await handlePut(context, req, userId);
    } else {
      context.res = {
        status: 405,
        headers: { "Content-Type": "application/json" },
        body: { error: "Method not allowed" },
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    context.log.error("Settings error:", message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: message },
    };
  }
};

async function handleGet(context: Context, userId: string): Promise<void> {
  const tableClient = await getTableClient();

  try {
    const entity = await tableClient.getEntity("user", userId);
    const settings: UserSettings = {
      constellixApiKey: entity.constellixApiKey as string | undefined,
      constellixSecretKey: entity.constellixSecretKey as string | undefined,
    };
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: settings,
    };
  } catch (err: unknown) {
    // Entity not found is fine - return empty settings
    if ((err as { statusCode?: number }).statusCode === 404) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {},
      };
      return;
    }
    throw err;
  }
}

async function handlePut(
  context: Context,
  req: HttpRequest,
  userId: string
): Promise<void> {
  const body = req.body as UserSettings;
  if (!body) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { error: "Request body required" },
    };
    return;
  }

  const tableClient = await getTableClient();

  const entity = {
    partitionKey: "user",
    rowKey: userId,
    constellixApiKey: body.constellixApiKey || "",
    constellixSecretKey: body.constellixSecretKey || "",
  };

  await tableClient.upsertEntity(entity, "Replace");

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { success: true },
  };
}

export default settings;
