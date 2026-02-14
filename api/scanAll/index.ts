import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import * as crypto from "crypto";
import * as https from "https";
import * as dns from "dns";
import * as tls from "tls";
import { promisify } from "util";

const resolve4 = promisify(dns.resolve4);
const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);

const RESULTS_TABLE = "ZoneShiftScanResults";
const CONFIG_TABLE = "ZoneShiftScannerConfig";
const CONSTELLIX_BASE = "https://api.dns.constellix.com/v1";

// ─── Table Storage helpers ───────────────────────────────────────────────────

async function getTableClient(tableName: string): Promise<TableClient> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING not configured");

  const serviceClient = TableServiceClient.fromConnectionString(connectionString);
  try { await serviceClient.createTable(tableName); }
  catch (err: unknown) { if ((err as { statusCode?: number }).statusCode !== 409) throw err; }

  return TableClient.fromConnectionString(connectionString, tableName);
}

// ─── Constellix API ──────────────────────────────────────────────────────────

interface ConstellixCreds { apiKey: string; secretKey: string; }

async function getScannerCredentials(): Promise<ConstellixCreds> {
  const tableClient = await getTableClient(CONFIG_TABLE);
  try {
    const entity = await tableClient.getEntity("scanner", "constellix");
    return {
      apiKey: entity.apiKey as string,
      secretKey: entity.secretKey as string,
    };
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      throw new Error("Scanner credentials not configured. POST to /api/scan/config to set them.");
    }
    throw err;
  }
}

function constellixRequest(creds: ConstellixCreds, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac("sha1", creds.secretKey).update(timestamp).digest("base64");
    const url = new URL(`${CONSTELLIX_BASE}${path}`);

    const req = https.request({
      hostname: url.hostname, port: 443,
      path: url.pathname + url.search, method: "GET",
      headers: {
        "x-cns-security-token": `${creds.apiKey}:${hmac}:${timestamp}`,
        "Content-Type": "application/json", Accept: "application/json",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

// ─── DNS checks (server-side) ────────────────────────────────────────────────

interface SpfScanResult {
  found: boolean;
  record: string | null;
  qualifier: string;
  lookupCount: number;
  status: "pass" | "warn" | "fail";
}

interface DmarcScanResult {
  found: boolean;
  record: string | null;
  policy: string | null;
  rua: string[];
  status: "pass" | "warn" | "fail";
}

interface SslScanResult {
  status: "valid" | "expiring" | "critical" | "expired" | "error";
  daysRemaining: number | null;
  issuer: string | null;
  validTo: string | null;
  error: string | null;
}

interface DomainScanResult {
  domain: string;
  spf: SpfScanResult;
  dmarc: DmarcScanResult;
  ssl: SslScanResult;
  mxCount: number;
  healthScore: number;
  scannedAt: string;
}

const SPF_LOOKUP_MECHS = new Set(["include", "a", "mx", "ptr", "exists", "redirect"]);

async function scanSpf(domain: string): Promise<SpfScanResult> {
  try {
    const records = await resolveTxt(domain);
    const flat = records.map(r => r.join(""));
    const spfRecords = flat.filter(r => r.toLowerCase().startsWith("v=spf1"));

    if (spfRecords.length === 0) {
      return { found: false, record: null, qualifier: "none", lookupCount: 0, status: "fail" };
    }

    const record = spfRecords[0];
    let lookupCount = 0;
    for (const part of record.split(/\s+/)) {
      const mech = part.replace(/^[+\-~?]/, "").split(":")[0].split("/")[0].toLowerCase();
      if (SPF_LOOKUP_MECHS.has(mech)) lookupCount++;
    }

    const allMatch = record.match(/([+\-~?]?)all\s*$/i);
    const qualifier = allMatch ? (allMatch[1] || "+") + "all" : "none";

    let status: "pass" | "warn" | "fail" = "pass";
    if (qualifier === "+all" || qualifier === "none") status = "fail";
    else if (qualifier === "?all" || lookupCount > 10) status = "warn";

    return { found: true, record, qualifier, lookupCount, status };
  } catch {
    return { found: false, record: null, qualifier: "none", lookupCount: 0, status: "fail" };
  }
}

async function scanDmarc(domain: string): Promise<DmarcScanResult> {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const flat = records.map(r => r.join(""));
    const dmarcRecords = flat.filter(r => r.toLowerCase().startsWith("v=dmarc1"));

    if (dmarcRecords.length === 0) {
      return { found: false, record: null, policy: null, rua: [], status: "fail" };
    }

    const record = dmarcRecords[0];
    const pMatch = record.match(/(?:^|;)\s*p=([^;]+)/i);
    const policy = pMatch ? pMatch[1].trim() : null;
    const ruaMatch = record.match(/(?:^|;)\s*rua=([^;]+)/i);
    const rua = ruaMatch ? ruaMatch[1].split(",").map(s => s.trim()) : [];

    let status: "pass" | "warn" | "fail" = "pass";
    if (!policy) status = "fail";
    else if (policy === "none") status = "warn";

    return { found: true, record, policy, rua, status };
  } catch {
    return { found: false, record: null, policy: null, rua: [], status: "fail" };
  }
}

async function scanSsl(domain: string): Promise<SslScanResult> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();

        if (!cert || !cert.valid_from) {
          resolve({ status: "error", daysRemaining: null, issuer: null, validTo: null, error: "No certificate" });
          return;
        }

        const validTo = new Date(cert.valid_to);
        const days = Math.floor((validTo.getTime() - Date.now()) / 86400000);
        const issuerParts: string[] = [];
        if (cert.issuer?.O) issuerParts.push(cert.issuer.O);
        if (cert.issuer?.CN) issuerParts.push(cert.issuer.CN);

        let status: "valid" | "expiring" | "critical" | "expired" = "valid";
        if (days <= 0) status = "expired";
        else if (days <= 7) status = "critical";
        else if (days <= 30) status = "expiring";

        resolve({
          status, daysRemaining: days,
          issuer: issuerParts.join(" - ") || "Unknown",
          validTo: validTo.toISOString(), error: null,
        });
      }
    );
    socket.on("error", (err) => {
      socket.destroy();
      resolve({ status: "error", daysRemaining: null, issuer: null, validTo: null, error: err.message });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ status: "error", daysRemaining: null, issuer: null, validTo: null, error: "Timeout" });
    });
  });
}

function computeScore(spf: SpfScanResult, dmarc: DmarcScanResult, ssl: SslScanResult, mxCount: number): number {
  let score = 0;
  // SPF: 20
  if (spf.found) {
    score += 8;
    if (spf.qualifier === "-all") score += 8;
    else if (spf.qualifier === "~all") score += 6;
    else if (spf.qualifier === "?all") score += 2;
    if (spf.lookupCount <= 10) score += 4;
  }
  // DMARC: 20
  if (dmarc.found) {
    score += 5;
    if (dmarc.policy === "reject") score += 10;
    else if (dmarc.policy === "quarantine") score += 7;
    else if (dmarc.policy === "none") score += 2;
    if (dmarc.rua.length > 0) score += 5;
  }
  // SSL: 20
  if (ssl.status === "valid") score += 20;
  else if (ssl.status === "expiring") score += 12;
  else if (ssl.status === "critical") score += 5;
  // MX: 5 bonus (exists)
  if (mxCount > 0) score += 5;
  // DKIM: skip in automated scan (requires probing many selectors)
  // Blacklist: skip (requires separate DNSBL queries per IP)
  // Security: default 10
  score += 10;
  return Math.min(score, 100);
}

// ─── Main function ───────────────────────────────────────────────────────────

const scanAll: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  // Auth: require scan secret or SWA auth
  const scanSecret = process.env.SCAN_SECRET;
  const providedSecret = req.headers["x-scan-secret"] || req.query.secret;
  const clientPrincipal = req.headers["x-ms-client-principal"];

  if (!clientPrincipal && (!scanSecret || providedSecret !== scanSecret)) {
    context.res = { status: 401, headers: { "Content-Type": "application/json" },
      body: { error: "Authentication required. Provide x-scan-secret header or SWA auth." } };
    return;
  }

  try {
    const creds = await getScannerCredentials();
    const domainsData = await constellixRequest(creds, "/domains") as unknown[];

    if (!Array.isArray(domainsData)) {
      context.res = { status: 500, headers: { "Content-Type": "application/json" },
        body: { error: "Failed to list domains from Constellix" } };
      return;
    }

    const domains = domainsData.map((d: any) => ({ id: d.id, name: d.name }));
    context.log(`Scanning ${domains.length} domains...`);

    const results: DomainScanResult[] = [];
    const resultsTable = await getTableClient(RESULTS_TABLE);
    const now = new Date();
    const scanTimestamp = now.toISOString();

    // Scan in batches of 3
    for (let i = 0; i < domains.length; i += 3) {
      const batch = domains.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(async (domain): Promise<DomainScanResult> => {
        const [spf, dmarc, ssl, mxCount] = await Promise.all([
          scanSpf(domain.name),
          scanDmarc(domain.name),
          scanSsl(domain.name),
          resolveMx(domain.name).then(r => r.length).catch(() => 0),
        ]);

        const healthScore = computeScore(spf, dmarc, ssl, mxCount);

        return {
          domain: domain.name, spf, dmarc, ssl, mxCount,
          healthScore, scannedAt: scanTimestamp,
        };
      }));

      // Store results in Table Storage
      for (const result of batchResults) {
        // Latest result: partitionKey = domain, rowKey = "latest"
        await resultsTable.upsertEntity({
          partitionKey: result.domain,
          rowKey: "latest",
          ...flattenResult(result),
        }, "Replace");

        // Historical result: partitionKey = domain, rowKey = timestamp
        await resultsTable.createEntity({
          partitionKey: result.domain,
          rowKey: scanTimestamp,
          ...flattenResult(result),
        });
      }

      results.push(...batchResults);

      // Brief pause between batches
      if (i + 3 < domains.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    context.log(`Scan complete. ${results.length} domains scanned.`);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        success: true,
        domainsScanned: results.length,
        timestamp: scanTimestamp,
        summary: {
          healthy: results.filter(r => r.healthScore >= 70).length,
          warning: results.filter(r => r.healthScore >= 50 && r.healthScore < 70).length,
          critical: results.filter(r => r.healthScore < 50).length,
          avgScore: Math.round(results.reduce((s, r) => s + r.healthScore, 0) / results.length),
        },
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Scan failed";
    context.log.error("Scan error:", message);
    context.res = { status: 500, headers: { "Content-Type": "application/json" },
      body: { error: message } };
  }
};

// Flatten nested scan result for Table Storage (no nested objects)
function flattenResult(r: DomainScanResult): Record<string, string | number | boolean> {
  return {
    domain: r.domain,
    healthScore: r.healthScore,
    scannedAt: r.scannedAt,
    mxCount: r.mxCount,
    spfFound: r.spf.found,
    spfRecord: r.spf.record || "",
    spfQualifier: r.spf.qualifier,
    spfLookupCount: r.spf.lookupCount,
    spfStatus: r.spf.status,
    dmarcFound: r.dmarc.found,
    dmarcRecord: r.dmarc.record || "",
    dmarcPolicy: r.dmarc.policy || "",
    dmarcRua: r.dmarc.rua.join(","),
    dmarcStatus: r.dmarc.status,
    sslStatus: r.ssl.status,
    sslDaysRemaining: r.ssl.daysRemaining ?? -1,
    sslIssuer: r.ssl.issuer || "",
    sslValidTo: r.ssl.validTo || "",
    sslError: r.ssl.error || "",
  };
}

export default scanAll;
