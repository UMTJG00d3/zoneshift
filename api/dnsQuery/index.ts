import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import * as dns from "dns";

interface QueryRequest {
  nameserver: string;
  domain: string;
  type?: string;         // Optional for single query
  discover?: boolean;    // If true, query all common subdomains and types
}

interface DnsRecord {
  name: string;
  type: string;
  ttl: number;
  value: string;
}

// Common subdomains to check during discovery
const COMMON_SUBDOMAINS = [
  '@',          // apex
  'www',
  'mail',
  'ftp',
  'cpanel',
  'webmail',
  'webdisk',
  'whm',
  'autodiscover',
  'autoconfig',
  'pop',
  'pop3',
  'imap',
  'smtp',
  'remote',
  'vpn',
  'portal',
  'admin',
  'api',
  'app',
  'dev',
  'staging',
  'test',
  'blog',
  'shop',
  'store',
  'cdn',
  'static',
  'assets',
  'img',
  'images',
  'media',
  'files',
  'docs',
  'support',
  'help',
  'status',
  'm',
  'mobile',
  'ns1',
  'ns2',
  'dns',
  'mx',
  'mx1',
  'mx2',
  'relay',
  'gateway',
  'secure',
  'login',
  'sso',
  'auth',
  'calendar',
  'meet',
  'conference',
  'video',
  'cloud',
  'backup',
  'db',
  'sql',
  'mysql',
  'postgres',
  'redis',
  'cache',
  'search',
  'elk',
  'monitor',
  'metrics',
  'grafana',
  'prometheus',
  'jenkins',
  'gitlab',
  'git',
  'ci',
  'deploy',
  'k8s',
  'kubernetes',
  'docker',
  'registry',
  'cpcontacts',
  'cpcalendars',
  '_dmarc',
  'selector1._domainkey',
  'selector2._domainkey',
  'default._domainkey',
  'google._domainkey',
  'k1._domainkey',
  '_domainkey',
  'enterpriseregistration',
  'enterpriseenrollment',
  'lyncdiscover',
  'sip',
  '_sipfederationtls._tcp',
  '_sip._tls',
  '_autodiscover._tcp',
  '_caldav._tcp',
  '_caldavs._tcp',
  '_carddav._tcp',
  '_carddavs._tcp',
  '_imap._tcp',
  '_imaps._tcp',
  '_pop3._tcp',
  '_pop3s._tcp',
  '_submission._tcp',
];

const RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SRV", "CAA"];

const dnsQuery: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const payload = req.body as QueryRequest;

  if (!payload?.nameserver || !payload?.domain) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Missing required fields: nameserver, domain" },
    };
    return;
  }

  const { nameserver, domain, type, discover } = payload;

  // Validate inputs
  if (!/^[a-zA-Z0-9.-]+$/.test(nameserver) || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Invalid nameserver or domain" },
    };
    return;
  }

  // Discovery mode: query all common subdomains and types
  if (discover) {
    try {
      const result = await discoverAllRecords(nameserver, domain);
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          success: true,
          domain,
          nameserver,
          recordCount: result.records.length,
          records: result.records,
          subdomainsChecked: result.subdomainsChecked,
          errors: result.errors.length > 0 ? result.errors : undefined,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "DNS discovery failed";
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { success: false, error: message },
      };
    }
    return;
  }

  // Single query mode (original behavior)
  if (!type) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { success: false, error: "Missing required field: type (or use discover: true)" },
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

async function discoverAllRecords(
  nameserver: string,
  domain: string
): Promise<{ records: DnsRecord[]; subdomainsChecked: number; errors: string[] }> {
  const allRecords: DnsRecord[] = [];
  const errors: string[] = [];
  const cleanDomain = domain.replace(/\.$/, '');

  // Build list of FQDNs to query
  const fqdns: string[] = [];
  for (const sub of COMMON_SUBDOMAINS) {
    if (sub === '@') {
      fqdns.push(cleanDomain);
    } else {
      fqdns.push(`${sub}.${cleanDomain}`);
    }
  }

  // Query in batches to avoid overwhelming
  const batchSize = 10;
  for (let i = 0; i < fqdns.length; i += batchSize) {
    const batch = fqdns.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (fqdn) => {
        for (const type of RECORD_TYPES) {
          try {
            const records = await queryDns(nameserver, fqdn, type);
            for (const r of records) {
              // Convert to relative name
              let name = r.name;
              if (name === cleanDomain) {
                name = '@';
              } else if (name.endsWith('.' + cleanDomain)) {
                name = name.slice(0, -(cleanDomain.length + 1));
              }
              allRecords.push({ ...r, name });
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            // ENODATA/ENOTFOUND are normal
            if (!message.includes("ENODATA") && !message.includes("ENOTFOUND")) {
              errors.push(`${fqdn} ${type}: ${message}`);
            }
          }
        }
      })
    );
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueRecords = allRecords.filter((r) => {
    const key = `${r.name}|${r.type}|${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by name, then type
  uniqueRecords.sort((a, b) => {
    const aName = a.name === '@' ? '' : a.name;
    const bName = b.name === '@' ? '' : b.name;
    if (aName !== bName) return aName.localeCompare(bName);
    return a.type.localeCompare(b.type);
  });

  return { records: uniqueRecords, subdomainsChecked: fqdns.length, errors };
}

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
