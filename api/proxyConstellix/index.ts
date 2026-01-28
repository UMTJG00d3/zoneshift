import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import * as crypto from "crypto";
import * as https from "https";

interface ProxyRequest {
  apiKey: string;
  secretKey: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
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

  // Compute Constellix HMAC-SHA1 auth headers
  const timestamp = Date.now().toString();
  const hmac = crypto
    .createHmac("sha1", payload.secretKey)
    .update(timestamp)
    .digest("base64");

  const url = `${CONSTELLIX_BASE}${payload.path}`;
  const headers: Record<string, string> = {
    "x-cns-security-token": `${payload.apiKey}:${hmac}:${timestamp}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const response = await makeRequest(
      url,
      payload.method,
      headers,
      payload.body ? JSON.stringify(payload.body) : undefined
    );

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    context.log.error("Constellix proxy error:", message);
    context.res = {
      status: 502,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: message },
    };
  }
};

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
