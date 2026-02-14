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
    credentials: 'include',
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

// --- Single Record Management ---

export interface ConstellixRecord {
  id: number;
  name: string;
  type: string;
  ttl: number;
  value: string;
  // Individual roundRobin values for multi-value records
  values?: string[];
  // Raw data from API for updates
  rawData?: unknown;
}

export interface ConstellixDomain {
  id: number;
  name: string;
  status: string;
  createdAt?: string;
}

export async function listDomains(
  creds: ConstellixCredentials
): Promise<{ domains: ConstellixDomain[]; error?: string }> {
  const res = await proxyRequest(creds, 'GET', '/domains');
  if (!res.success) {
    return { domains: [], error: `Failed to fetch domains: ${res.error || JSON.stringify(res.data)}` };
  }

  if (Array.isArray(res.data)) {
    const domains = res.data.map((d: unknown) => {
      const domain = d as { id: number; name: string; status?: string; createdTs?: number };
      return {
        id: domain.id,
        name: domain.name,
        status: domain.status || 'active',
        createdAt: domain.createdTs ? new Date(domain.createdTs).toISOString() : undefined,
      };
    });
    return { domains };
  }

  return { domains: [], error: 'Unexpected response format' };
}

export async function getDomainId(
  creds: ConstellixCredentials,
  domain: string
): Promise<{ id: number | null; error?: string }> {
  const res = await proxyRequest(creds, 'GET', '/domains');
  if (!res.success) {
    return { id: null, error: `Failed to fetch domains: ${JSON.stringify(res.data)}` };
  }

  if (Array.isArray(res.data)) {
    const found = res.data.find((d: unknown) => (d as { name: string }).name === domain);
    if (found) {
      return { id: (found as { id: number }).id };
    }
  }

  return { id: null, error: `Domain "${domain}" not found in Constellix` };
}

export async function listRecords(
  creds: ConstellixCredentials,
  domainId: number
): Promise<{ records: ConstellixRecord[]; error?: string }> {
  const types = ['a', 'aaaa', 'cname', 'mx', 'txt', 'ns', 'srv', 'caa'];
  const allRecords: ConstellixRecord[] = [];

  for (const type of types) {
    const res = await proxyRequest(creds, 'GET', `/domains/${domainId}/records/${type}`);
    if (res.success && Array.isArray(res.data)) {
      for (const rec of res.data) {
        const r = rec as { id: number; name: string; ttl: number; roundRobin?: Array<{ value: string; level?: number }>; host?: string };
        let value = '';
        let values: string[] | undefined;

        if (r.roundRobin && r.roundRobin.length > 0) {
          const mapped = r.roundRobin.map((rr) => {
            if (rr.level !== undefined) return `${rr.level} ${rr.value}`;
            return rr.value;
          });
          value = mapped.join(', ');
          if (mapped.length > 1) {
            values = mapped;
          }
        } else if (r.host) {
          value = r.host;
        }

        allRecords.push({
          id: r.id,
          name: r.name || '@',
          type: type.toUpperCase(),
          ttl: r.ttl,
          value,
          values,
          rawData: rec,
        });
      }
    }
    // Small delay to avoid rate limits
    await sleep(300);
  }

  return { records: allRecords };
}

export async function addRecord(
  creds: ConstellixCredentials,
  domainId: number,
  name: string,
  type: string,
  ttl: number,
  value: string
): Promise<{ success: boolean; error?: string }> {
  const typeLower = type.toLowerCase();
  const path = `/domains/${domainId}/records/${typeLower}`;
  const recordName = name === '@' ? '' : name;

  // For roundRobin types, check if a record already exists at this name.
  // Constellix doesn't allow two records of the same type at the same name —
  // you must append to the existing record's roundRobin array.
  if (['a', 'aaaa', 'txt', 'ns'].includes(typeLower)) {
    const existingRes = await proxyRequest(creds, 'GET', path);
    console.log('[addRecord] GET existing', path, 'success:', existingRes.success, 'data:', existingRes.data);

    if (existingRes.success && Array.isArray(existingRes.data)) {
      // Normalize name for matching — Constellix may return "" or "@" or the name
      const normName = (s: string | null | undefined) => (s || '').toLowerCase().replace(/^@$/, '');
      const existing = existingRes.data.find(
        (r: unknown) => normName((r as { name: string }).name) === normName(recordName)
      ) as { id: number; name: string; ttl: number; roundRobin: Array<{ value: string; disableFlag?: boolean; level?: number }> } | undefined;

      console.log('[addRecord] Looking for name:', JSON.stringify(recordName), 'found:', existing ? `id=${existing.id} with ${existing.roundRobin?.length} values` : 'none');

      if (existing) {
        // Append new value to existing roundRobin
        const existingRR = existing.roundRobin || [];
        const newRoundRobin = [...existingRR, { value, disableFlag: false }];
        const updatePath = `${path}/${existing.id}`;
        const updateBody = {
          name: existing.name,
          ttl,
          roundRobin: newRoundRobin,
        };
        console.log('[addRecord] Appending via PUT', updatePath, JSON.stringify(updateBody));
        const updateRes = await proxyRequest(creds, 'PUT', updatePath, updateBody);
        console.log('[addRecord] PUT result:', updateRes.success, updateRes.status, JSON.stringify(updateRes.data));
        if (updateRes.success) return { success: true };
        return { success: false, error: `Failed to append to existing record: HTTP ${updateRes.status}: ${JSON.stringify(updateRes.data)}` };
      }
    }

    // If GET failed, log it and fall through to POST
    if (!existingRes.success) {
      console.log('[addRecord] GET failed, falling through to POST. Status:', existingRes.status, 'error:', existingRes.error);
    }
  }

  let body: Record<string, unknown>;

  switch (typeLower) {
    case 'a':
    case 'aaaa':
    case 'txt':
    case 'ns':
      body = {
        name: recordName,
        ttl,
        roundRobin: [{ value, disableFlag: false }],
      };
      break;
    case 'cname':
      body = {
        name: recordName,
        ttl,
        host: value.endsWith('.') ? value : value + '.',
      };
      break;
    case 'mx': {
      const parts = value.split(/\s+/);
      const level = parseInt(parts[0], 10) || 10;
      const server = parts[1] || parts[0];
      body = {
        name: recordName,
        ttl,
        roundRobin: [{ value: server.endsWith('.') ? server : server + '.', level, disableFlag: false }],
      };
      break;
    }
    default:
      return { success: false, error: `Unsupported record type: ${type}` };
  }

  const res = await proxyRequest(creds, 'POST', path, body);
  if (res.success) return { success: true };
  return { success: false, error: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
}

export async function updateRecord(
  creds: ConstellixCredentials,
  domainId: number,
  recordId: number,
  type: string,
  name: string,
  ttl: number,
  value: string
): Promise<{ success: boolean; error?: string }> {
  const typeLower = type.toLowerCase();
  const path = `/domains/${domainId}/records/${typeLower}/${recordId}`;
  const recordName = name === '@' ? '' : name;

  let body: Record<string, unknown>;

  switch (typeLower) {
    case 'a':
    case 'aaaa':
    case 'txt':
    case 'ns':
      body = {
        name: recordName,
        ttl,
        roundRobin: [{ value, disableFlag: false }],
      };
      break;
    case 'cname':
      body = {
        name: recordName,
        ttl,
        host: value.endsWith('.') ? value : value + '.',
      };
      break;
    case 'mx': {
      const parts = value.split(/\s+/);
      const level = parseInt(parts[0], 10) || 10;
      const server = parts[1] || parts[0];
      body = {
        name: recordName,
        ttl,
        roundRobin: [{ value: server.endsWith('.') ? server : server + '.', level, disableFlag: false }],
      };
      break;
    }
    default:
      return { success: false, error: `Unsupported record type: ${type}` };
  }

  const res = await proxyRequest(creds, 'PUT', path, body);
  if (res.success) return { success: true };
  return { success: false, error: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
}

export async function deleteRecord(
  creds: ConstellixCredentials,
  domainId: number,
  recordId: number,
  type: string
): Promise<{ success: boolean; error?: string }> {
  const path = `/domains/${domainId}/records/${type.toLowerCase()}/${recordId}`;
  const res = await proxyRequest(creds, 'DELETE', path);
  if (res.success) return { success: true };
  return { success: false, error: `HTTP ${res.status}: ${JSON.stringify(res.data)}` };
}
