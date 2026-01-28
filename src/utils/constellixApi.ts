import { DnsRecord } from './zoneParser';
import { mapRecordsForConstellix, ConstellixRecordBody } from './constellixRecordMapper';

export interface ConstellixCredentials {
  apiKey: string;
  secretKey: string;
}

interface ProxyResponse {
  success: boolean;
  status: number;
  data: unknown;
  error?: string;
}

export interface PushProgress {
  phase: 'creating_domain' | 'pushing_records' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
  errors: PushError[];
  successes: number;
}

export interface PushError {
  record: string;
  type: string;
  error: string;
}

async function proxyRequest(
  creds: ConstellixCredentials,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ProxyResponse> {
  const res = await fetch('/api/proxy/constellix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
      method,
      path,
      body,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: ProxyResponse;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { success: false, status: res.status, data: null, error: text };
    }
    return parsed;
  }

  return res.json();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createDomain(
  creds: ConstellixCredentials,
  domain: string
): Promise<{ id: number | null; error?: string }> {
  // Try to create the domain
  const createRes = await proxyRequest(creds, 'POST', '/domains', {
    names: [domain],
  });

  if (createRes.success && Array.isArray(createRes.data) && createRes.data.length > 0) {
    return { id: (createRes.data[0] as { id: number }).id };
  }

  // If domain already exists, search for it
  if (createRes.status === 409 || createRes.status === 400) {
    const searchRes = await proxyRequest(creds, 'GET', '/domains');
    if (searchRes.success && Array.isArray(searchRes.data)) {
      const found = searchRes.data.find(
        (d: unknown) => (d as { name: string }).name === domain
      );
      if (found) {
        return { id: (found as { id: number }).id };
      }
    }
    return { id: null, error: `Domain may already exist but could not find it: ${JSON.stringify(createRes.data)}` };
  }

  return { id: null, error: `Failed to create domain: ${JSON.stringify(createRes.data)}` };
}

export async function createRecord(
  creds: ConstellixCredentials,
  domainId: number,
  record: ConstellixRecordBody
): Promise<{ success: boolean; error?: string }> {
  const path = `/domains/${domainId}/records/${record.type}`;
  const body = {
    name: record.name,
    ttl: record.ttl,
    ...record.body,
  };

  const res = await proxyRequest(creds, 'POST', path, body);

  if (res.success) return { success: true };

  // Handle rate limiting with retry
  if (res.status === 429) {
    await sleep(2000);
    const retryRes = await proxyRequest(creds, 'POST', path, body);
    if (retryRes.success) return { success: true };
    return { success: false, error: `Rate limited: ${JSON.stringify(retryRes.data)}` };
  }

  return { success: false, error: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
}

export async function pushAllRecords(
  creds: ConstellixCredentials,
  domain: string,
  records: DnsRecord[],
  onProgress: (progress: PushProgress) => void
): Promise<PushProgress> {
  const errors: PushError[] = [];
  let successes = 0;

  // Phase 1: Create domain
  onProgress({
    phase: 'creating_domain',
    current: 0,
    total: 0,
    message: `Creating domain ${domain}...`,
    errors: [],
    successes: 0,
  });

  const domainResult = await createDomain(creds, domain);
  if (!domainResult.id) {
    const progress: PushProgress = {
      phase: 'error',
      current: 0,
      total: 0,
      message: domainResult.error || 'Failed to create domain',
      errors: [{ record: domain, type: 'DOMAIN', error: domainResult.error || 'Unknown error' }],
      successes: 0,
    };
    onProgress(progress);
    return progress;
  }

  const domainId = domainResult.id;

  // Phase 2: Push records
  const mapped = mapRecordsForConstellix(records, domain);
  const total = mapped.length;

  for (let i = 0; i < mapped.length; i++) {
    const rec = mapped[i];
    const displayName = rec.name || '@';

    onProgress({
      phase: 'pushing_records',
      current: i + 1,
      total,
      message: `Pushing ${rec.type.toUpperCase()} record: ${displayName}`,
      errors: [...errors],
      successes,
    });

    const result = await createRecord(creds, domainId, rec);

    if (result.success) {
      successes++;
    } else {
      errors.push({
        record: displayName,
        type: rec.type.toUpperCase(),
        error: result.error || 'Unknown error',
      });
    }

    // Rate limit: 1.2s between calls
    if (i < mapped.length - 1) {
      await sleep(1200);
    }
  }

  const finalProgress: PushProgress = {
    phase: 'done',
    current: total,
    total,
    message: `Pushed ${successes}/${total} records${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
    errors,
    successes,
  };
  onProgress(finalProgress);
  return finalProgress;
}
