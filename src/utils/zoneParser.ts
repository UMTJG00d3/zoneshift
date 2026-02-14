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

/**
 * Auto-detect format and parse accordingly
 */
export function parseZoneFile(content: string): ParsedZone {
  // Detect cPanel table paste format (has "Name TTL Type Record" header or multi-line values)
  const lines = content.trim().split('\n');
  const firstLine = lines[0]?.toLowerCase() || '';

  // Check for cPanel table header
  if (firstLine.includes('name') && firstLine.includes('ttl') && firstLine.includes('type') && firstLine.includes('record')) {
    return parseCPanelPaste(content);
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
