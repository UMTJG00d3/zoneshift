// Security Scanner utility for DNS vulnerability detection

import { dohLookup } from './dnsLookup';

// Legacy hosting providers to detect
export const LEGACY_PROVIDERS = [
  { patterns: ['inmotionhosting.com', 'inmotionhosting.net'], name: 'InMotion Hosting', severity: 'critical' as const },
  { patterns: ['bluehost.com', 'box.bluehost.com'], name: 'Bluehost', severity: 'warning' as const },
  { patterns: ['hostgator.com', 'websitewelcome.com'], name: 'HostGator', severity: 'warning' as const },
  { patterns: ['secureserver.net', 'domaincontrol.com'], name: 'GoDaddy Hosting', severity: 'warning' as const },
  { patterns: ['netsolhost.com', 'networksolutions.com'], name: 'Network Solutions', severity: 'warning' as const },
  { patterns: ['1and1.com', 'ionos.com'], name: '1&1 IONOS', severity: 'warning' as const },
  { patterns: ['dreamhost.com'], name: 'DreamHost', severity: 'warning' as const },
  { patterns: ['siteground.com', 'sgvps.net'], name: 'SiteGround', severity: 'warning' as const },
];

export type Severity = 'critical' | 'warning' | 'info' | 'ok';

export interface ScanFinding {
  id: string;
  severity: Severity;
  type: 'LEGACY_HOSTING' | 'DANGLING_CNAME' | 'SUSPICIOUS_TXT' | 'UNREACHABLE';
  records: ScanRecord[];
  issue: string;
  recommendation: string;
}

export interface ScanRecord {
  recordId?: number;
  name: string;
  type: string;
  value: string;
  ttl: number;
  ip?: string;
  ptr?: string;
  provider?: string;
}

export interface ScanProgress {
  phase: 'fetching' | 'analyzing' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

export interface ScanResult {
  domain: string;
  scannedAt: string;
  totalRecords: number;
  findings: ScanFinding[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    ok: number;
  };
}

export interface ApprovedList {
  approvedIPs: string[];
  approvedHosts: string[];
  approvedVerifications: string[];
}

// Reverse DNS lookup via DoH
export async function reverseLookup(ip: string): Promise<string | null> {
  try {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    const reversed = parts.reverse().join('.') + '.in-addr.arpa';
    const answers = await dohLookup(reversed, 'PTR');

    if (answers && answers.length > 0) {
      return answers[0].data;
    }
    return null;
  } catch {
    return null;
  }
}

// Identify hosting provider from PTR record
export function identifyProvider(ptrRecord: string | null): { name: string; severity: Severity } | null {
  if (!ptrRecord) return null;
  const ptr = ptrRecord.toLowerCase();

  for (const provider of LEGACY_PROVIDERS) {
    if (provider.patterns.some(pattern => ptr.includes(pattern.toLowerCase()))) {
      return { name: provider.name, severity: provider.severity };
    }
  }
  return null;
}

// Check if an IP or hostname is in the approved list
export function isApproved(value: string, approvedList: ApprovedList): boolean {
  const lowerValue = value.toLowerCase();

  // Check IPs
  if (approvedList.approvedIPs.some(ip => ip === value)) {
    return true;
  }

  // Check hosts (partial match)
  if (approvedList.approvedHosts.some(host => lowerValue.includes(host.toLowerCase()))) {
    return true;
  }

  return false;
}

// Check if a verification record is approved
export function isVerificationApproved(value: string, approvedList: ApprovedList): boolean {
  return approvedList.approvedVerifications.some(v => value.includes(v));
}

// Extract verification tokens from TXT records
export function extractVerificationInfo(txtValue: string): { type: string; token: string } | null {
  const patterns = [
    { regex: /google-site-verification[=:]?\s*([^\s"]+)/i, type: 'Google Site Verification' },
    { regex: /facebook-domain-verification[=:]?\s*([^\s"]+)/i, type: 'Facebook Domain Verification' },
    { regex: /MS[=:]?\s*([^\s"]+)/i, type: 'Microsoft Verification' },
    { regex: /apple-domain-verification[=:]?\s*([^\s"]+)/i, type: 'Apple Domain Verification' },
    { regex: /_github-challenge-[^=]+[=:]?\s*([^\s"]+)/i, type: 'GitHub Verification' },
  ];

  for (const { regex, type } of patterns) {
    const match = txtValue.match(regex);
    if (match) {
      return { type, token: match[1] || match[0] };
    }
  }
  return null;
}

// Generate a unique ID for findings
function generateFindingId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Analyze A/AAAA records for legacy hosting
export async function analyzeARecords(
  records: ScanRecord[],
  approvedList: ApprovedList,
  onProgress?: (msg: string) => void
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const ipGroups = new Map<string, ScanRecord[]>();

  // Group records by IP
  for (const record of records) {
    if (record.type !== 'A' && record.type !== 'AAAA') continue;

    const ip = record.value;
    if (!ipGroups.has(ip)) {
      ipGroups.set(ip, []);
    }
    ipGroups.get(ip)!.push(record);
  }

  // Analyze each unique IP
  for (const [ip, groupedRecords] of ipGroups) {
    if (isApproved(ip, approvedList)) continue;

    onProgress?.(`Checking reverse DNS for ${ip}...`);

    const ptr = await reverseLookup(ip);
    const provider = identifyProvider(ptr);

    if (provider) {
      // Add PTR info to records
      const enrichedRecords = groupedRecords.map(r => ({
        ...r,
        ip,
        ptr: ptr || undefined,
        provider: provider.name,
      }));

      findings.push({
        id: generateFindingId(),
        severity: provider.severity,
        type: 'LEGACY_HOSTING',
        records: enrichedRecords,
        issue: `${groupedRecords.length} record${groupedRecords.length > 1 ? 's' : ''} point to ${provider.name} (${ip})`,
        recommendation: `Review and remove records pointing to decommissioned hosting at ${ip}`,
      });
    }
  }

  return findings;
}

// Analyze CNAME records for dangling references
export async function analyzeCnameRecords(
  records: ScanRecord[],
  _domain: string,
  onProgress?: (msg: string) => void
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  const cnameRecords = records.filter(r => r.type === 'CNAME');

  for (const record of cnameRecords) {
    onProgress?.(`Checking CNAME target: ${record.value}...`);

    try {
      const answers = await dohLookup(record.value, 'A');

      if (!answers || answers.length === 0) {
        // No A records found - could be dangling CNAME
        findings.push({
          id: generateFindingId(),
          severity: 'critical',
          type: 'DANGLING_CNAME',
          records: [record],
          issue: `CNAME target "${record.value}" has no A records`,
          recommendation: `Remove dangling CNAME record - subdomain takeover risk`,
        });
      }
    } catch {
      // Treat errors as potential issues
      findings.push({
        id: generateFindingId(),
        severity: 'warning',
        type: 'DANGLING_CNAME',
        records: [record],
        issue: `Could not resolve CNAME target "${record.value}"`,
        recommendation: `Verify CNAME target is valid and accessible`,
      });
    }
  }

  return findings;
}

// Analyze TXT records for suspicious verification tokens
export function analyzeTxtRecords(
  records: ScanRecord[],
  approvedList: ApprovedList
): ScanFinding[] {
  const findings: ScanFinding[] = [];

  const txtRecords = records.filter(r => r.type === 'TXT');

  for (const record of txtRecords) {
    const verificationInfo = extractVerificationInfo(record.value);

    if (verificationInfo) {
      if (!isVerificationApproved(verificationInfo.token, approvedList)) {
        findings.push({
          id: generateFindingId(),
          severity: 'warning',
          type: 'SUSPICIOUS_TXT',
          records: [record],
          issue: `Unrecognized ${verificationInfo.type} token`,
          recommendation: `Verify this verification token is legitimate and still needed`,
        });
      }
    }
  }

  return findings;
}

// Load approved list from localStorage
export function loadApprovedList(domain: string): ApprovedList {
  const key = 'zoneshift_approved_lists';
  const stored = localStorage.getItem(key);

  if (stored) {
    try {
      const lists = JSON.parse(stored);
      if (lists[domain]) {
        return lists[domain];
      }
    } catch {
      // Ignore parse errors
    }
  }

  return {
    approvedIPs: [],
    approvedHosts: [],
    approvedVerifications: [],
  };
}

// Save approved list to localStorage
export function saveApprovedList(domain: string, approvedList: ApprovedList): void {
  const key = 'zoneshift_approved_lists';
  const stored = localStorage.getItem(key);
  let lists: Record<string, ApprovedList> = {};

  if (stored) {
    try {
      lists = JSON.parse(stored);
    } catch {
      // Start fresh
    }
  }

  lists[domain] = approvedList;
  localStorage.setItem(key, JSON.stringify(lists));
}

// Save scan result to localStorage
export function saveScanResult(result: ScanResult): void {
  const key = 'zoneshift_scan_results';
  const stored = localStorage.getItem(key);
  let results: ScanResult[] = [];

  if (stored) {
    try {
      results = JSON.parse(stored);
    } catch {
      // Start fresh
    }
  }

  // Add to beginning, keep last 50
  results.unshift(result);
  results = results.slice(0, 50);

  localStorage.setItem(key, JSON.stringify(results));
}

// Generate changeset from findings
export function generateChangesetFromFindings(
  domain: string,
  domainId: number,
  findings: ScanFinding[]
): {
  domain: string;
  domainId: number;
  description: string;
  createdAt: string;
  createdBy: string;
  totalChanges: number;
  changes: Array<{
    action: 'delete';
    recordId?: number;
    type: string;
    name: string;
    value: string;
    ttl: number;
  }>;
} {
  const changes: Array<{
    action: 'delete';
    recordId?: number;
    type: string;
    name: string;
    value: string;
    ttl: number;
  }> = [];

  for (const finding of findings) {
    if (finding.severity === 'critical') {
      for (const record of finding.records) {
        changes.push({
          action: 'delete',
          recordId: record.recordId,
          type: record.type,
          name: record.name,
          value: record.value,
          ttl: record.ttl,
        });
      }
    }
  }

  return {
    domain,
    domainId,
    description: `Security remediation - Remove ${changes.length} vulnerable records`,
    createdAt: new Date().toISOString(),
    createdBy: 'DNS Security Scanner',
    totalChanges: changes.length,
    changes,
  };
}
