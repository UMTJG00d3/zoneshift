import { dohLookup } from './dnsLookup';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Severity = 'pass' | 'warn' | 'fail' | 'info';

export interface Finding {
  severity: Severity;
  message: string;
}

export interface SpfResult {
  found: boolean;
  record: string | null;
  lookupCount: number;
  maxLookups: number;
  mechanisms: string[];
  qualifier: string; // ~all, -all, +all, ?all, or 'none'
  findings: Finding[];
  status: Severity;
}

export interface DkimSelectorResult {
  selector: string;
  found: boolean;
  record: string | null;
  keyType: string | null;
  keyLength: string | null; // 'weak' | 'ok' | 'strong' | null
}

export interface DkimResult {
  selectors: DkimSelectorResult[];
  foundCount: number;
  findings: Finding[];
  status: Severity;
}

export interface DmarcResult {
  found: boolean;
  record: string | null;
  policy: string | null; // none, quarantine, reject
  subdomainPolicy: string | null;
  pct: number | null;
  rua: string[]; // aggregate report URIs
  ruf: string[]; // forensic report URIs
  alignment: { spf: string | null; dkim: string | null }; // r=relaxed, s=strict
  findings: Finding[];
  status: Severity;
}

export interface EmailHealthResult {
  domain: string;
  spf: SpfResult;
  dkim: DkimResult;
  dmarc: DmarcResult;
  overallStatus: Severity;
  timestamp: number;
}

// ─── SPF Validation ──────────────────────────────────────────────────────────

const SPF_LOOKUP_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists', 'redirect']);

async function getTxtRecords(domain: string): Promise<string[]> {
  try {
    const answers = await dohLookup(domain, 'TXT');
    return answers
      .filter(a => a.type === 16)
      .map(a => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
  } catch {
    return [];
  }
}

function countSpfLookups(record: string): number {
  const parts = record.split(/\s+/);
  let count = 0;
  for (const part of parts) {
    const mechanism = part.replace(/^[+\-~?]/, '').split(':')[0].split('/')[0].toLowerCase();
    if (SPF_LOOKUP_MECHANISMS.has(mechanism)) {
      count++;
    }
  }
  return count;
}

function getSpfQualifier(record: string): string {
  const allMatch = record.match(/([+\-~?]?)all\s*$/i);
  if (!allMatch) return 'none';
  const qualifier = allMatch[1] || '+';
  return qualifier + 'all';
}

export async function validateSpf(domain: string): Promise<SpfResult> {
  const findings: Finding[] = [];
  const txtRecords = await getTxtRecords(domain);
  const spfRecords = txtRecords.filter(r => r.toLowerCase().startsWith('v=spf1'));

  if (spfRecords.length === 0) {
    findings.push({ severity: 'fail', message: 'No SPF record found' });
    return {
      found: false, record: null, lookupCount: 0, maxLookups: 10,
      mechanisms: [], qualifier: 'none', findings, status: 'fail',
    };
  }

  if (spfRecords.length > 1) {
    findings.push({ severity: 'fail', message: `Multiple SPF records found (${spfRecords.length}). Only one is allowed per RFC 7208.` });
  }

  const record = spfRecords[0];
  const mechanisms = record.split(/\s+/).slice(1); // skip v=spf1
  const lookupCount = countSpfLookups(record);
  const qualifier = getSpfQualifier(record);

  if (lookupCount > 10) {
    findings.push({ severity: 'fail', message: `Too many DNS lookups: ${lookupCount}/10. Exceeds RFC limit and will cause permerror.` });
  } else if (lookupCount > 7) {
    findings.push({ severity: 'warn', message: `DNS lookup count is ${lookupCount}/10. Getting close to the limit.` });
  } else {
    findings.push({ severity: 'pass', message: `DNS lookup count: ${lookupCount}/10` });
  }

  if (qualifier === '+all') {
    findings.push({ severity: 'fail', message: 'SPF policy is +all (allow all). This provides no protection.' });
  } else if (qualifier === '?all') {
    findings.push({ severity: 'warn', message: 'SPF policy is ?all (neutral). Consider using ~all or -all.' });
  } else if (qualifier === '~all') {
    findings.push({ severity: 'pass', message: 'SPF policy uses ~all (soft fail). Good baseline.' });
  } else if (qualifier === '-all') {
    findings.push({ severity: 'pass', message: 'SPF policy uses -all (hard fail). Strictest enforcement.' });
  } else {
    findings.push({ severity: 'warn', message: 'No "all" mechanism found. Implicit +all may apply.' });
  }

  if (mechanisms.some(m => m.toLowerCase().includes('ptr'))) {
    findings.push({ severity: 'warn', message: 'SPF uses "ptr" mechanism which is deprecated (RFC 7208 §5.5).' });
  }

  const status: Severity = findings.some(f => f.severity === 'fail') ? 'fail'
    : findings.some(f => f.severity === 'warn') ? 'warn' : 'pass';

  return { found: true, record, lookupCount, maxLookups: 10, mechanisms, qualifier, findings, status };
}

// ─── DKIM Validation ─────────────────────────────────────────────────────────

const DEFAULT_SELECTORS = [
  'selector1', 'selector2',       // Microsoft 365
  'google', 'google2',            // Google Workspace (legacy)
  'default',                      // Generic
  'k1',                           // Mailchimp
  's1', 's2',                     // SendGrid
  'dkim', 'mail',                 // Common defaults
  'mimecast20190104',             // Mimecast
  'protonmail', 'protonmail2', 'protonmail3', // Proton
];

async function checkDkimSelector(domain: string, selector: string): Promise<DkimSelectorResult> {
  const fqdn = `${selector}._domainkey.${domain}`;
  const txtRecords = await getTxtRecords(fqdn);

  for (const record of txtRecords) {
    if (record.toLowerCase().includes('v=dkim1') || record.toLowerCase().includes('p=')) {
      // Parse key type
      const keyTypeMatch = record.match(/k=(\w+)/i);
      const keyType = keyTypeMatch ? keyTypeMatch[1] : 'rsa';

      // Estimate key length from the base64 p= value
      const pMatch = record.match(/p=([A-Za-z0-9+/=]+)/);
      let keyLength: string | null = null;
      if (pMatch && pMatch[1]) {
        const keyBytes = Math.ceil(pMatch[1].length * 3 / 4);
        if (keyBytes < 128) keyLength = 'weak';       // < 1024 bit
        else if (keyBytes < 256) keyLength = 'ok';     // 1024 bit
        else keyLength = 'strong';                     // 2048+ bit
      }

      return { selector, found: true, record, keyType, keyLength };
    }
  }

  // Also check for CNAME (delegated DKIM)
  try {
    const cnameAnswers = await dohLookup(fqdn, 'CNAME');
    if (cnameAnswers.length > 0) {
      return { selector, found: true, record: `CNAME → ${cnameAnswers[0].data}`, keyType: null, keyLength: null };
    }
  } catch { /* ignore */ }

  return { selector, found: false, record: null, keyType: null, keyLength: null };
}

export async function validateDkim(domain: string, extraSelectors: string[] = []): Promise<DkimResult> {
  const findings: Finding[] = [];
  const allSelectors = [...new Set([...DEFAULT_SELECTORS, ...extraSelectors])];

  // Check selectors in batches of 5
  const results: DkimSelectorResult[] = [];
  for (let i = 0; i < allSelectors.length; i += 5) {
    const batch = allSelectors.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(s => checkDkimSelector(domain, s)));
    results.push(...batchResults);
  }

  const foundCount = results.filter(r => r.found).length;

  if (foundCount === 0) {
    findings.push({ severity: 'fail', message: 'No DKIM selectors found from common selectors.' });
  } else {
    findings.push({ severity: 'pass', message: `Found ${foundCount} DKIM selector${foundCount > 1 ? 's' : ''}.` });

    const weakKeys = results.filter(r => r.found && r.keyLength === 'weak');
    if (weakKeys.length > 0) {
      findings.push({
        severity: 'warn',
        message: `Selector${weakKeys.length > 1 ? 's' : ''} ${weakKeys.map(k => k.selector).join(', ')} use${weakKeys.length === 1 ? 's' : ''} a weak key (< 1024-bit).`,
      });
    }
  }

  const status: Severity = foundCount === 0 ? 'fail'
    : findings.some(f => f.severity === 'warn') ? 'warn' : 'pass';

  return { selectors: results, foundCount, findings, status };
}

// ─── DMARC Validation ────────────────────────────────────────────────────────

function parseDmarcTag(record: string, tag: string): string | null {
  const match = record.match(new RegExp(`(?:^|;)\\s*${tag}=([^;]+)`, 'i'));
  return match ? match[1].trim() : null;
}

export async function validateDmarc(domain: string): Promise<DmarcResult> {
  const findings: Finding[] = [];
  const txtRecords = await getTxtRecords(`_dmarc.${domain}`);
  const dmarcRecords = txtRecords.filter(r => r.toLowerCase().startsWith('v=dmarc1'));

  if (dmarcRecords.length === 0) {
    findings.push({ severity: 'fail', message: 'No DMARC record found at _dmarc.' + domain });
    return {
      found: false, record: null, policy: null, subdomainPolicy: null,
      pct: null, rua: [], ruf: [],
      alignment: { spf: null, dkim: null },
      findings, status: 'fail',
    };
  }

  if (dmarcRecords.length > 1) {
    findings.push({ severity: 'fail', message: 'Multiple DMARC records found. Only one is allowed.' });
  }

  const record = dmarcRecords[0];
  const policy = parseDmarcTag(record, 'p');
  const subdomainPolicy = parseDmarcTag(record, 'sp');
  const pctStr = parseDmarcTag(record, 'pct');
  const pct = pctStr ? parseInt(pctStr, 10) : null;
  const ruaStr = parseDmarcTag(record, 'rua');
  const rufStr = parseDmarcTag(record, 'ruf');
  const rua = ruaStr ? ruaStr.split(',').map(s => s.trim()) : [];
  const ruf = rufStr ? rufStr.split(',').map(s => s.trim()) : [];
  const aspf = parseDmarcTag(record, 'aspf');
  const adkim = parseDmarcTag(record, 'adkim');

  // Policy evaluation
  if (!policy) {
    findings.push({ severity: 'fail', message: 'DMARC record missing required "p" tag.' });
  } else if (policy === 'none') {
    findings.push({ severity: 'warn', message: 'DMARC policy is "none" (monitor only). Consider moving to quarantine or reject.' });
  } else if (policy === 'quarantine') {
    findings.push({ severity: 'pass', message: 'DMARC policy is "quarantine". Good intermediate policy.' });
  } else if (policy === 'reject') {
    findings.push({ severity: 'pass', message: 'DMARC policy is "reject". Strongest enforcement.' });
  }

  // Percentage
  if (pct !== null && pct < 100) {
    findings.push({ severity: 'info', message: `DMARC applied to ${pct}% of messages. Consider increasing to 100%.` });
  }

  // Reporting
  if (rua.length === 0) {
    findings.push({ severity: 'warn', message: 'No aggregate report URI (rua) configured. You won\'t receive DMARC reports.' });
  } else {
    findings.push({ severity: 'pass', message: `Aggregate reports configured: ${rua.length} recipient${rua.length > 1 ? 's' : ''}.` });
  }

  const status: Severity = findings.some(f => f.severity === 'fail') ? 'fail'
    : findings.some(f => f.severity === 'warn') ? 'warn' : 'pass';

  return {
    found: true, record, policy, subdomainPolicy, pct, rua, ruf,
    alignment: { spf: aspf, dkim: adkim },
    findings, status,
  };
}

// ─── Combined Check ──────────────────────────────────────────────────────────

export async function validateEmailHealth(domain: string): Promise<EmailHealthResult> {
  const [spf, dkim, dmarc] = await Promise.all([
    validateSpf(domain),
    validateDkim(domain),
    validateDmarc(domain),
  ]);

  const statuses = [spf.status, dkim.status, dmarc.status];
  const overallStatus: Severity = statuses.includes('fail') ? 'fail'
    : statuses.includes('warn') ? 'warn' : 'pass';

  return { domain, spf, dkim, dmarc, overallStatus, timestamp: Date.now() };
}
