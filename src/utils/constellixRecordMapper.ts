import { DnsRecord } from './zoneParser';

/**
 * Maps parsed DnsRecord[] into Constellix API request bodies.
 * Groups records sharing the same name+type into single roundRobin arrays.
 */

export interface ConstellixRecordBody {
  name: string;
  type: string;
  ttl: number;
  body: Record<string, unknown>;
}

export function mapRecordsForConstellix(
  records: DnsRecord[],
  origin: string
): ConstellixRecordBody[] {
  // Group by name+type
  const groups = new Map<string, DnsRecord[]>();
  for (const r of records) {
    const key = `${r.name}|${r.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result: ConstellixRecordBody[] = [];
  for (const [, recs] of groups) {
    const mapped = mapGroup(recs, origin);
    if (mapped) result.push(mapped);
  }
  return result;
}

function mapGroup(
  recs: DnsRecord[],
  origin: string
): ConstellixRecordBody | null {
  const first = recs[0];
  const type = first.type;
  const name = first.name === '@' ? '' : first.name;
  const ttl = first.ttl;

  switch (type) {
    case 'A': {
      const validRecs = recs.filter((r) => isValidIPv4(r.value));
      if (validRecs.length === 0) return null;
      return {
        name,
        type: 'a',
        ttl,
        body: {
          roundRobin: validRecs.map((r) => ({ value: r.value, disableFlag: false })),
        },
      };
    }

    case 'AAAA': {
      const validRecs = recs.filter((r) => isValidIPv6(r.value));
      if (validRecs.length === 0) return null;
      return {
        name,
        type: 'aaaa',
        ttl,
        body: {
          roundRobin: validRecs.map((r) => ({ value: r.value, disableFlag: false })),
        },
      };
    }

    case 'CNAME':
      return {
        name,
        type: 'cname',
        ttl,
        body: {
          host: ensureFqdn(first.value, origin),
        },
      };

    case 'MX': {
      const roundRobin = recs.map((r) => {
        const parts = r.value.split(/\s+/);
        const level = parseInt(parts[0], 10) || 10;
        const server = ensureFqdn(parts[1] || parts[0], origin);
        return { value: server, level, disableFlag: false };
      });
      return {
        name,
        type: 'mx',
        ttl,
        body: { roundRobin },
      };
    }

    case 'TXT': {
      const roundRobin = recs.map((r) => ({
        value: stripQuotes(r.value),
        disableFlag: false,
      }));
      return {
        name,
        type: 'txt',
        ttl,
        body: { roundRobin },
      };
    }

    case 'SRV': {
      // SRV value format: priority weight port target
      const roundRobin = recs.map((r) => {
        const parts = r.value.split(/\s+/);
        return {
          value: ensureFqdn(parts[3] || '', origin),
          priority: parseInt(parts[0], 10) || 0,
          weight: parseInt(parts[1], 10) || 0,
          port: parseInt(parts[2], 10) || 0,
        };
      });
      return {
        name,
        type: 'srv',
        ttl,
        body: { roundRobin },
      };
    }

    case 'CAA': {
      // CAA value format: flag tag "value"
      const data = recs.map((r) => {
        const parts = r.value.split(/\s+/);
        const flag = parseInt(parts[0], 10) || 0;
        const tag = parts[1] || 'issue';
        const value = stripQuotes(parts.slice(2).join(' '));
        return { flag, tag, data: value };
      });
      return {
        name,
        type: 'caa',
        ttl,
        body: { roundRobin: data },
      };
    }

    case 'NS':
      // Non-root NS records (root already filtered by parser)
      return {
        name,
        type: 'ns',
        ttl,
        body: {
          roundRobin: recs.map((r) => ({
            value: ensureFqdn(r.value, origin),
            disableFlag: false,
          })),
        },
      };

    default:
      // Skip unsupported types
      return null;
  }
}

function ensureFqdn(value: string, origin: string): string {
  const trimmed = value.replace(/\.$/, '');
  // @ means root domain
  if (trimmed === '@') return `${origin}.`;
  // If already has a dot, treat as FQDN
  if (trimmed.includes('.')) return trimmed + '.';
  // Otherwise, append origin
  return `${trimmed}.${origin}.`;
}

function stripQuotes(value: string): string {
  // Handle concatenated quoted strings: "part1" "part2"
  if (value.includes('"')) {
    const parts: string[] = [];
    const regex = /"([^"]*)"/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
      parts.push(match[1]);
    }
    return parts.length > 0 ? parts.join('') : value.replace(/"/g, '');
  }
  return value;
}

function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === p;
  });
}

function isValidIPv6(value: string): boolean {
  // Basic IPv6 validation - allows full and compressed forms
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(value);
}
