export interface DnsRecord {
  name: string;
  ttl: number;
  class: string;
  type: string;
  value: string;
}

export interface ParsedZone {
  origin: string;
  records: DnsRecord[];
}

export function parseZoneFile(content: string): ParsedZone {
  const lines = content.split('\n');
  let origin = '';
  const records: DnsRecord[] = [];
  let inSOA = false;
  let parenDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comment-only lines
    if (!trimmed || trimmed.startsWith(';')) {
      continue;
    }

    // Extract $ORIGIN
    if (trimmed.startsWith('$ORIGIN')) {
      origin = trimmed.replace('$ORIGIN', '').trim().replace(/\.$/, '');
      continue;
    }

    // Skip other directives ($TTL, etc.)
    if (trimmed.startsWith('$')) {
      continue;
    }

    // Handle multi-line SOA records
    if (inSOA) {
      parenDepth += (trimmed.match(/\(/g) || []).length;
      parenDepth -= (trimmed.match(/\)/g) || []).length;
      if (parenDepth <= 0) {
        inSOA = false;
      }
      continue;
    }

    // Parse record line
    const record = parseRecordLine(trimmed);
    if (!record) continue;

    // Detect SOA start
    if (record.type === 'SOA') {
      inSOA = true;
      parenDepth = (trimmed.match(/\(/g) || []).length;
      parenDepth -= (trimmed.match(/\)/g) || []).length;
      if (parenDepth <= 0) inSOA = false;
      continue;
    }

    // Skip root NS records
    if (record.type === 'NS' && record.name === '@') {
      continue;
    }

    records.push(record);
  }

  return { origin, records };
}

function parseRecordLine(line: string): DnsRecord | null {
  // Remove inline comments (but not inside quotes)
  const stripped = stripInlineComment(line);
  if (!stripped) return null;

  // Tokenize respecting quoted strings
  const tokens = tokenize(stripped);
  if (tokens.length < 4) return null;

  // Expected format: name ttl class type value...
  // e.g.: @  600  IN  A  65.181.116.249
  // e.g.: @  3600  IN  MX  10  mail.example.com.
  let idx = 0;
  const name = tokens[idx++];
  const ttl = parseInt(tokens[idx++], 10);
  if (isNaN(ttl)) return null;

  const recordClass = tokens[idx++].toUpperCase();
  if (recordClass !== 'IN') return null;

  const type = tokens[idx++].toUpperCase();
  const valueParts = tokens.slice(idx);
  if (valueParts.length === 0) return null;

  const value = valueParts.join('\t');

  return { name, ttl, class: recordClass, type, value };
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (line[i] === ';' && !inQuote) {
      return line.substring(0, i).trim();
    }
  }
  return line.trim();
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }

    if (!inQuote && (ch === ' ' || ch === '\t')) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function formatForConstellix(parsed: ParsedZone): string {
  const lines: string[] = [];

  if (parsed.origin) {
    lines.push(`$ORIGIN ${parsed.origin}.`);
  }

  // Group records by type
  const groups = new Map<string, DnsRecord[]>();
  const typeOrder = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'];

  for (const record of parsed.records) {
    if (!groups.has(record.type)) {
      groups.set(record.type, []);
    }
    groups.get(record.type)!.push(record);
  }

  // Output in type order, then any remaining types
  const outputOrder = [
    ...typeOrder.filter(t => groups.has(t)),
    ...[...groups.keys()].filter(t => !typeOrder.includes(t)),
  ];

  for (const type of outputOrder) {
    const recs = groups.get(type)!;
    lines.push(`; ${type} Record`);
    for (const r of recs) {
      lines.push(`${r.name}\t${r.ttl}\t ${r.class} \t${r.type}\t${r.value}`);
    }
  }

  return lines.join('\n') + '\n';
}
