/** Client-side API for fetching stored health scan results */

export interface StoredScanResult {
  domain: string;
  healthScore: number;
  scannedAt: string;
  mxCount: number;
  spfFound: boolean;
  spfQualifier: string;
  spfLookupCount: number;
  spfStatus: 'pass' | 'warn' | 'fail';
  dmarcFound: boolean;
  dmarcPolicy: string;
  dmarcStatus: 'pass' | 'warn' | 'fail';
  sslStatus: 'valid' | 'expiring' | 'critical' | 'expired' | 'error';
  sslDaysRemaining: number;
  sslIssuer: string;
  sslValidTo: string;
}

export interface ScanResultsResponse {
  results: StoredScanResult[];
  count: number;
}

export interface ScanHistoryResponse {
  domain: string;
  results: StoredScanResult[];
  count: number;
}

/** Fetch latest scan results for all domains */
export async function fetchAllScanResults(): Promise<StoredScanResult[]> {
  try {
    const res = await fetch('/api/health/results');
    if (!res.ok) return [];
    const data: ScanResultsResponse = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

/** Fetch latest scan result for a single domain */
export async function fetchDomainScanResult(domain: string): Promise<StoredScanResult | null> {
  try {
    const res = await fetch(`/api/health/results?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data || null;
  } catch {
    return null;
  }
}

/** Fetch scan history for a domain (up to 30 scans) */
export async function fetchDomainHistory(domain: string): Promise<StoredScanResult[]> {
  try {
    const res = await fetch(`/api/health/results?domain=${encodeURIComponent(domain)}&history=true`);
    if (!res.ok) return [];
    const data: ScanHistoryResponse = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

/** Format a scan result's time as relative string */
export function formatScanAge(scannedAt: string): string {
  const diff = Date.now() - new Date(scannedAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
