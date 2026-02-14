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

const DNS_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'SPF', 'SOA', 'PTR']);

/**
 * Auto-detect format and parse accordingly
 */
export function parseZoneFile(content: string): ParsedZone {
  const lines = content.trim().split('\n');
  const firstLine = lines[0]?.toLowerCase() || '';

  // Check for cPanel table header (Name TTL Type Record on one line)
  if (firstLine.includes('name') && firstLine.includes('ttl') && firstLine.includes('type') && firstLine.includes('record')) {
    return parseCPanelPaste(content);
  }

  // Detect "vertical web table" format: records pasted from a web UI where each
  // field lands on its own line. Signature: at least 3 lines that are bare DNS type
  // names (A, CNAME, TXT, etc.) within the first ~40 non-blank lines.
  if (isWebTableFormat(lines)) {
    return parseWebTablePaste(content);
  }

  // Check for cPanel-style multi-line format (value on separate line)
  // Look for pattern: name.domain.com.    TTL    TYPE    (with value on next line)
  const cpanelPattern = /^[\w.-]+\.\s+\d+\s+(A|AAAA|CNAME|MX|TXT|SRV|CAA|NS)\s*$/im;
  if (cpanelPattern.test(content)) {
    return parseCPanelPaste(content);
  }

  // Fall back to BIND zone file parser
  return parseBINDZoneFile(content);
}

/**
 * Detect if content is the "vertical web table" format where each record field
 * is on its own line: Type \n Name \n Value \n TTL
 */
function isWebTableFormat(lines: string[]): boolean {
  // Strip blank lines and look at the first ~40 meaningful lines
  const meaningful = lines.map(l => l.trim()).filter(Boolean).slice(0, 40);

  // Skip header lines (Type, Name, Value, TTL as column headers)
  let start = 0;
  if (meaningful[0]?.toLowerCase() === 'type') start = 1;
  if (meaningful[start]?.toLowerCase() === 'name') start++;
  if (meaningful[start]?.toLowerCase() === 'value') start++;
  if (meaningful[start]?.toLowerCase() === 'ttl') start++;

  // Count how many lines are bare DNS type names
  let typeCount = 0;
  for (let i = start; i < meaningful.length; i++) {
    if (DNS_TYPES.has(meaningful[i].toUpperCase())) {
      typeCount++;
    }
  }

  // If we see 3+ bare type lines, it's a web table paste
  return typeCount >= 3;
}

/**
 * Parse human-readable TTL strings like "1 Hour", "15 minutes", "2 Hours", "24 Hours", "1 Day"
 * Falls back to numeric seconds if already numeric
 */
function parseHumanTTL(ttlStr: string): number {
  const trimmed = ttlStr.trim().toLowerCase();

  // Already numeric seconds
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && /^\d+$/.test(trimmed)) return num;

  // Match patterns: "1 Hour", "15 minutes", "2 Hours", "1 Day", "1/2 Hour"
  const match = trimmed.match(/^(\d+(?:\/\d+)?)\s*(second|minute|hour|day|week)s?$/i);
  if (match) {
    let amount: number;
    if (match[1].includes('/')) {
      const [n, d] = match[1].split('/').map(Number);
      amount = n / d;
    } else {
      amount = parseInt(match[1], 10);
    }
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 'second': return Math.round(amount);
      case 'minute': return Math.round(amount * 60);
      case 'hour': return Math.round(amount * 3600);
      case 'day': return Math.round(amount * 86400);
      case 'week': return Math.round(amount * 604800);
    }
  }

  // Fallback
  return 3600;
}

/**
 * Check if a string looks like a TTL value (numeric or human-readable time)
 */
function looksLikeTTL(s: string): boolean {
  const trimmed = s.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return true;
  if (/^\d+(?:\/\d+)?\s*(second|minute|hour|day|week)s?$/i.test(trimmed)) return true;
  return false;
}

/**
 * Parse "vertical web table" format copied from DNS hosting web UIs.
 * Each record is a group of lines:
 *   Type (bare: A, CNAME, TXT, etc.)
 *   Name (subdomain or @ or FQDN)
 *   Value (IP, hostname, TXT content, etc.)
 *   [optional extra lines like comments/descriptions]
 *   TTL (human-readable: "1 Hour", "15 minutes", etc.)
 */
function parseWebTablePaste(content: string): ParsedZone {
  const lines = content.split('\n');
  const records: DnsRecord[] = [];
  let origin = '';

  let i = 0;

  // Skip column header lines (Type, Name, Value, TTL as separate lines)
  const skipHeaders = ['type', 'name', 'value', 'ttl'];
  while (i < lines.length && i < 8) {
    const trimmed = lines[i].trim().toLowerCase();
    if (!trimmed || skipHeaders.includes(trimmed)) {
      i++;
    } else {
      break;
    }
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip blank lines
    if (!line) {
      i++;
      continue;
    }

    // Check if this line is a bare DNS type
    if (!DNS_TYPES.has(line.toUpperCase())) {
      i++;
      continue;
    }

    const type = line.toUpperCase();
    i++;

    // Skip SOA — not importing those
    if (type === 'SOA') {
      // Skip until next DNS type line
      while (i < lines.length) {
        const next = lines[i].trim();
        if (next && DNS_TYPES.has(next.toUpperCase())) break;
        i++;
      }
      continue;
    }

    // Collect remaining fields: Name, Value, [extras...], TTL
    // Scan forward to collect all non-blank lines until the next DNS type line
    const fields: string[] = [];
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next) {
        i++;
        continue;
      }
      // If this is a bare DNS type and we already have enough fields, stop
      if (DNS_TYPES.has(next.toUpperCase()) && fields.length >= 2) {
        break;
      }
      fields.push(next);
      i++;
    }

    // We need at least: Name, Value, TTL (3 fields)
    // But some have extras between value and TTL (comments, descriptions)
    if (fields.length < 2) continue;

    // Find the TTL — it's the last field that looks like a TTL
    let ttlIndex = -1;
    for (let f = fields.length - 1; f >= 2; f--) {
      if (looksLikeTTL(fields[f])) {
        ttlIndex = f;
        break;
      }
    }

    // If no TTL found in trailing fields, check if the last field is TTL
    if (ttlIndex === -1 && fields.length >= 3 && looksLikeTTL(fields[fields.length - 1])) {
      ttlIndex = fields.length - 1;
    }

    const name = fields[0];
    const ttl = ttlIndex >= 0 ? parseHumanTTL(fields[ttlIndex]) : 3600;

    // Value extraction: depends on record type
    // Simple types (A, AAAA, CNAME, NS, PTR): value is exactly one field (IP or hostname)
    // Complex types (TXT, MX, SRV, CAA, SPF): value may span multiple fields
    const valueEnd = ttlIndex >= 0 ? ttlIndex : fields.length;
    const simpleTypes = new Set(['A', 'AAAA', 'CNAME', 'NS', 'PTR']);
    let value: string;
    if (simpleTypes.has(type) && fields.length > 2) {
      // Take only the first field after name — extra fields are comments/descriptions
      value = fields[1].trim();
    } else {
      const valueParts = fields.slice(1, valueEnd);
      value = valueParts.join(' ').trim();
    }

    if (!value) continue;

    // Clean up name: handle FQDNs (trailing dot) vs relative names
    const isFQDN = name.endsWith('.');
    let cleanName = name.replace(/\.$/, '');

    // Only extract origin from explicit FQDNs (names that had a trailing dot)
    // In web table pastes, most names are relative subdomains — dots in names
    // like "selector1._domainkey" are subdomain separators, not TLD indicators
    if (!origin && isFQDN && cleanName.includes('.')) {
      const parts = cleanName.split('.');
      if (parts.length >= 3) {
        // FQDN like _sip._tls.machnetworks.com → origin = machnetworks.com
        origin = parts.slice(-2).join('.');
      }
    }

    // Convert FQDN to relative name if we have origin
    if (isFQDN && origin) {
      if (cleanName.toLowerCase() === origin.toLowerCase()) {
        cleanName = '@';
      } else if (cleanName.toLowerCase().endsWith('.' + origin.toLowerCase())) {
        cleanName = cleanName.slice(0, -(origin.length + 1));
      }
    }

    // For TXT records, ensure value is quoted
    if (type === 'TXT' && !value.startsWith('"')) {
      value = `"${value}"`;
    }

    // Skip root NS records
    if (type === 'NS' && (cleanName === '@' || cleanName === origin)) {
      continue;
    }

    records.push({
      name: cleanName,
      ttl,
      class: 'IN',
      type,
      value,
    });
  }

  return { origin, records };
}

/**
 * Parse cPanel web interface copy-paste format
 * Format: Name/TTL/Type on one line, value on next line(s)
 */
function parseCPanelPaste(content: string): ParsedZone {
  const lines = content.split('\n');
  const records: DnsRecord[] = [];
  let origin = '';

  let i = 0;

  // Skip header row if present
  const firstLine = lines[0]?.toLowerCase() || '';
  if (firstLine.includes('name') && firstLine.includes('ttl') && firstLine.includes('type')) {
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Try to parse as record header: name.domain.com.    300    A
    const headerMatch = line.match(/^([\w._-]+\.[\w.-]+\.?)\s+(\d+)\s+(A|AAAA|CNAME|MX|TXT|SRV|CAA|NS|SPF)\s*$/i);

    if (headerMatch) {
      const fullName = headerMatch[1].replace(/\.$/, ''); // Remove trailing dot
      const ttl = parseInt(headerMatch[2], 10);
      const type = headerMatch[3].toUpperCase();

      // Extract origin from first record if not set
      if (!origin) {
        // Find the base domain (last two parts, or last three if TLD is two-part like .co.uk)
        const parts = fullName.split('.');
        if (parts.length >= 2) {
          origin = parts.slice(-2).join('.');
        }
      }

      // Convert full name to relative name
      let name = fullName;
      if (origin && fullName === origin) {
        name = '@';
      } else if (origin && fullName.endsWith('.' + origin)) {
        name = fullName.slice(0, -(origin.length + 1));
      }

      // Collect value from subsequent lines
      i++;
      let value = '';

      if (type === 'MX') {
        // MX format: Priority: X \n Destination: mail.example.com
        let priority = '10';
        let destination = '';
        while (i < lines.length) {
          const valueLine = lines[i].trim();
          if (!valueLine || valueLine.match(/^[\w._-]+\.[\w.-]+\.?\s+\d+\s+/i)) {
            break; // Next record or empty
          }
          if (valueLine.toLowerCase().startsWith('priority:')) {
            priority = valueLine.replace(/priority:\s*/i, '').trim();
          } else if (valueLine.toLowerCase().startsWith('destination:')) {
            destination = valueLine.replace(/destination:\s*/i, '').trim();
          }
          i++;
        }
        value = `${priority}\t${destination}`;
      } else if (type === 'SRV') {
        // SRV format: Priority: X \n Weight: X \n Port: X \n Target: host
        let priority = '0', weight = '0', port = '0', target = '';
        while (i < lines.length) {
          const valueLine = lines[i].trim();
          if (!valueLine || valueLine.match(/^[\w._-]+\.[\w.-]+\.?\s+\d+\s+/i)) {
            break;
          }
          if (valueLine.toLowerCase().startsWith('priority:')) {
            priority = valueLine.replace(/priority:\s*/i, '').trim();
          } else if (valueLine.toLowerCase().startsWith('weight:')) {
            weight = valueLine.replace(/weight:\s*/i, '').trim();
          } else if (valueLine.toLowerCase().startsWith('port:')) {
            port = valueLine.replace(/port:\s*/i, '').trim();
          } else if (valueLine.toLowerCase().startsWith('target:')) {
            target = valueLine.replace(/target:\s*/i, '').trim();
          }
          i++;
        }
        value = `${priority}\t${weight}\t${port}\t${target}`;
      } else {
        // Simple records: value on next line(s), concatenate until next record
        const valueLines: string[] = [];
        while (i < lines.length) {
          const valueLine = lines[i].trim();
          // Stop if we hit an empty line followed by a record, or a new record header
          if (!valueLine) {
            i++;
            continue;
          }
          if (valueLine.match(/^[\w._-]+\.[\w.-]+\.?\s+\d+\s+(A|AAAA|CNAME|MX|TXT|SRV|CAA|NS|SPF)\s*$/i)) {
            break; // Next record
          }
          // Skip "Actions" column artifacts
          if (valueLine.toLowerCase() === 'actions' || valueLine === '') {
            i++;
            continue;
          }
          valueLines.push(valueLine);
          i++;
        }
        value = valueLines.join(' ').trim();

        // For TXT records, ensure value is quoted
        if (type === 'TXT' && value && !value.startsWith('"')) {
          value = `"${value}"`;
        }
      }

      if (value) {
        records.push({
          name,
          ttl,
          class: 'IN',
          type,
          value
        });
      }
    } else {
      i++;
    }
  }

  return { origin, records };
}

/**
 * Parse standard BIND zone file format
 */
function parseBINDZoneFile(content: string): ParsedZone {
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
