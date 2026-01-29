import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import * as dns from "dns";

interface QueryRequest {
  nameserver: string;
  domain: string;
  type: string;
}

interface DnsRecord {
  name: string;
  type: string;
  ttl: number;
  value: string;
}

const dnsQuery: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const payload = req.body as QueryRequest;

  if (!payload?.nameserver || !payload?.domain || !payload?.type) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Missing required fields: nameserver, domain, type" },
    };
    return;
  }

  const { nameserver, domain, type } = payload;

  // Validate inputs
  if (!/^[a-zA-Z0-9.-]+$/.test(nameserver) || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Invalid nameserver or domain" },
    };
    return;
  }

  const validTypes = ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SOA", "SRV", "CAA"];
  if (!validTypes.includes(type.toUpperCase())) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
    };
    return;
  }

  try {
    const records = await queryDns(nameserver, domain, type.toUpperCase());
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { success: true, records },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "DNS query failed";
    // ENODATA and ENOTFOUND are normal "no records" responses
    if (message.includes("ENODATA") || message.includes("ENOTFOUND")) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { success: true, records: [] },
      };
      return;
    }
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: message },
    };
  }
};

async function queryDns(
  nameserver: string,
  domain: string,
  type: string
): Promise<DnsRecord[]> {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver();
    resolver.setServers([nameserver]);

    switch (type) {
      case "A":
        resolver.resolve4(domain, { ttl: true }, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "AAAA":
        resolver.resolve6(domain, { ttl: true }, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "MX":
        resolver.resolveMx(domain, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "TXT":
        resolver.resolveTxt(domain, (err, records) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, records));
        });
        break;
      case "CNAME":
        resolver.resolveCname(domain, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "NS":
        resolver.resolveNs(domain, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "SOA":
        resolver.resolveSoa(domain, (err, address) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, address));
        });
        break;
      case "SRV":
        resolver.resolveSrv(domain, (err, addresses) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, addresses));
        });
        break;
      case "CAA":
        resolver.resolveCaa(domain, (err, records) => {
          if (err) return reject(err);
          resolve(parseResult(domain, type, records));
        });
        break;
      default:
        reject(new Error(`Unsupported type: ${type}`));
    }
  });
}

function parseResult(domain: string, type: string, result: unknown): DnsRecord[] {
  if (!result) return [];

  switch (type) {
    case "A":
    case "AAAA": {
      const records = result as Array<{ address: string; ttl: number }> | string[];
      return records.map((r) => ({
        name: domain,
        type,
        ttl: typeof r === "object" ? r.ttl : 300,
        value: typeof r === "object" ? r.address : r,
      }));
    }
    case "MX": {
      const records = result as Array<{ exchange: string; priority: number }>;
      return records.map((r) => ({
        name: domain,
        type,
        ttl: 300,
        value: `${r.priority} ${r.exchange}`,
      }));
    }
    case "TXT": {
      const records = result as string[][];
      return records.map((r) => ({
        name: domain,
        type,
        ttl: 300,
        value: r.join(""),
      }));
    }
    case "CNAME":
    case "NS": {
      const records = result as string[];
      return records.map((r) => ({
        name: domain,
        type,
        ttl: 300,
        value: r,
      }));
    }
    case "SRV": {
      const records = result as Array<{
        priority: number;
        weight: number;
        port: number;
        name: string;
      }>;
      return records.map((r) => ({
        name: domain,
        type,
        ttl: 300,
        value: `${r.priority} ${r.weight} ${r.port} ${r.name}`,
      }));
    }
    case "CAA": {
      const records = result as Array<{
        critical: number;
        issue?: string;
        issuewild?: string;
        iodef?: string;
        contactemail?: string;
        contactphone?: string;
      }>;
      return records.map((r) => ({
        name: domain,
        type,
        ttl: 300,
        value: `${r.critical} ${r.issue || r.issuewild || r.iodef || ""}`,
      }));
    }
    case "SOA": {
      const r = result as {
        nsname: string;
        hostmaster: string;
        serial: number;
        refresh: number;
        retry: number;
        expire: number;
        minttl: number;
      };
      return [
        {
          name: domain,
          type,
          ttl: r.minttl,
          value: `${r.nsname} ${r.hostmaster} ${r.serial}`,
        },
      ];
    }
    default:
      return [];
  }
}

export default dnsQuery;
