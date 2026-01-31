export interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
}

const RECORD_TYPE_MAP: Record<string, number> = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  NS: 2,
  SRV: 33,
  CAA: 257,
  SOA: 6,
};

export function typeNumberToName(num: number): string {
  for (const [name, n] of Object.entries(RECORD_TYPE_MAP)) {
    if (n === num) return name;
  }
  return `TYPE${num}`;
}

export async function dohLookup(
  domain: string,
  type: string,
): Promise<DohAnswer[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
  });

  if (!response.ok) {
    throw new Error(`DNS lookup failed: ${response.status}`);
  }

  const data: DohResponse = await response.json();
  return data.Answer || [];
}

export async function lookupNS(domain: string): Promise<string[]> {
  const answers = await dohLookup(domain, 'NS');
  return answers
    .filter((a) => a.type === RECORD_TYPE_MAP.NS)
    .map((a) => a.data.replace(/\.$/, '').toLowerCase())
    .sort();
}

export interface ResolvedRecord {
  name: string;
  type: string;
  ttl: number;
  value: string;
}

export async function queryAllRecords(
  domain: string,
  subdomains: string[],
  types: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ResolvedRecord[]> {
  const results: ResolvedRecord[] = [];
  const queries: { fqdn: string; type: string }[] = [];

  for (const sub of subdomains) {
    const fqdn = sub === '@' ? domain : `${sub}.${domain}`;
    for (const type of types) {
      queries.push({ fqdn, type });
    }
  }

  let done = 0;
  const total = queries.length;

  // Run in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ({ fqdn, type }) => {
        try {
          const answers = await dohLookup(fqdn, type);
          return answers.map((a) => ({
            name: a.name.replace(/\.$/, ''),
            type: typeNumberToName(a.type),
            ttl: a.TTL,
            value: a.data.replace(/\.$/, ''),
          }));
        } catch {
          return [];
        } finally {
          done++;
          onProgress?.(done, total);
        }
      }),
    );
    results.push(...batchResults.flat());
  }

  return deduplicateRecords(results);
}

function deduplicateRecords(records: ResolvedRecord[]): ResolvedRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.name}|${r.type}|${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Query a specific nameserver via API
async function nsLookup(
  nameserver: string,
  domain: string,
  type: string,
): Promise<ResolvedRecord[]> {
  const res = await fetch('/api/dns/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ nameserver, domain, type }),
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  if (!data.success || !Array.isArray(data.records)) {
    return [];
  }

  return data.records.map((r: { name: string; type: string; ttl: number; value: string }) => ({
    name: r.name.replace(/\.$/, ''),
    type: r.type,
    ttl: r.ttl,
    value: r.value.replace(/\.$/, ''),
  }));
}

export async function queryAllRecordsFromNS(
  nameserver: string,
  domain: string,
  subdomains: string[],
  types: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ResolvedRecord[]> {
  const results: ResolvedRecord[] = [];
  const queries: { fqdn: string; type: string }[] = [];

  for (const sub of subdomains) {
    const fqdn = sub === '@' ? domain : `${sub}.${domain}`;
    for (const type of types) {
      queries.push({ fqdn, type });
    }
  }

  let done = 0;
  const total = queries.length;

  // Run in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ({ fqdn, type }) => {
        try {
          return await nsLookup(nameserver, fqdn, type);
        } catch {
          return [];
        } finally {
          done++;
          onProgress?.(done, total);
        }
      }),
    );
    results.push(...batchResults.flat());
  }

  return deduplicateRecords(results);
}
