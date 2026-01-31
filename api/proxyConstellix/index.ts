import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import * as crypto from "crypto";
import * as https from "https";
import { logAuditEvent } from "../audit";

interface ProxyRequest {
  apiKey: string;
  secretKey: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

interface UserPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

function getUserFromHeader(header: string): UserPrincipal | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

const CONSTELLIX_BASE = "https://api.dns.constellix.com/v1";

const proxyConstellix: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  // Validate SWA authentication
  const clientPrincipal = req.headers["x-ms-client-principal"];
  if (!clientPrincipal) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Authentication required" },
    };
    return;
  }

  // Parse user info for audit logging
  const user = getUserFromHeader(clientPrincipal);
  const userId = user?.userId || "unknown";
  const userEmail = user?.userDetails || "unknown";
  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-client-ip"] ||
    "unknown";

  // Parse and validate request body
  const payload = req.body as ProxyRequest;
  if (!payload || !payload.apiKey || !payload.secretKey || !payload.method || !payload.path) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Missing required fields: apiKey, secretKey, method, path" },
    };
    return;
  }

  // Validate path — must start with /, no traversal
  if (!payload.path.startsWith("/") || payload.path.includes("..")) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Invalid path" },
    };
    return;
  }

  // Validate method
  const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
  if (!allowedMethods.includes(payload.method)) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Invalid method" },
    };
    return;
  }

  // Trim credentials in case of copy/paste whitespace
  const apiKey = payload.apiKey.trim();
  const secretKey = payload.secretKey.trim();

  // Compute Constellix HMAC-SHA1 auth headers
  const timestamp = Date.now().toString();
  const hmac = crypto
    .createHmac("sha1", secretKey)
    .update(timestamp)
    .digest("base64");

  const url = `${CONSTELLIX_BASE}${payload.path}`;
  const headers: Record<string, string> = {
    "x-cns-security-token": `${apiKey}:${hmac}:${timestamp}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Determine action description for audit log
  const action = `${payload.method} ${payload.path}`;
  const resource = extractResourceFromPath(payload.path);
  const details = payload.body ? JSON.stringify(payload.body).substring(0, 500) : "";

  try {
    const response = await makeRequest(
      url,
      payload.method,
      headers,
      payload.body ? JSON.stringify(payload.body) : undefined
    );

    const success = response.status >= 200 && response.status < 300;

    // Log audit event (don't await to avoid slowing down response)
    logAuditEvent(
      userId,
      userEmail,
      action,
      resource,
      details,
      clientIp,
      success,
      success ? undefined : `HTTP ${response.status}`
    ).catch((err) => context.log.error("Audit log error:", err));

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success,
        status: response.status,
        data: response.data,
        error: response.status >= 400 ? (typeof response.data === 'object' && response.data !== null ? JSON.stringify(response.data) : String(response.data)) : undefined,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    context.log.error("Constellix proxy error:", message);

    // Log failed request to audit
    logAuditEvent(
      userId,
      userEmail,
      action,
      resource,
      details,
      clientIp,
      false,
      message
    ).catch((auditErr) => context.log.error("Audit log error:", auditErr));

    context.res = {
      status: 502,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: message },
    };
  }
};

// Extract a human-readable resource name from the API path
function extractResourceFromPath(path: string): string {
  // e.g., /domains/123/records/a -> domain:123 record:a
  const parts = path.split("/").filter(Boolean);
  const resource: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "domains") {
      resource.push(`domain:${parts[i + 1] || "list"}`);
      i++;
    } else if (parts[i] === "records") {
      resource.push(`record:${parts[i + 1] || "list"}`);
      i++;
    }
  }

  return resource.length > 0 ? resource.join(" ") : path;
}

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode || 500, data: parsed });
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export default proxyConstellix;
