export interface SSLCertInfo {
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  sans: string[];
  fingerprint: string;
  protocol: string;
}

export type SSLStatus = 'valid' | 'expiring' | 'critical' | 'expired' | 'error' | 'unchecked';

export interface SSLCheckResult {
  domain: string;
  cert: SSLCertInfo | null;
  status: SSLStatus;
  statusLabel: string;
  error: string | null;
  timestamp: number;
}

function classifyExpiry(daysRemaining: number): { status: SSLStatus; statusLabel: string } {
  if (daysRemaining <= 0) return { status: 'expired', statusLabel: 'Expired' };
  if (daysRemaining <= 7) return { status: 'critical', statusLabel: `${daysRemaining}d left` };
  if (daysRemaining <= 30) return { status: 'expiring', statusLabel: `${daysRemaining}d left` };
  return { status: 'valid', statusLabel: `${daysRemaining}d left` };
}

export async function checkSSL(domain: string, port = 443): Promise<SSLCheckResult> {
  try {
    const res = await fetch('/api/ssl/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ domain, port }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return {
          domain, cert: null, status: 'unchecked',
          statusLabel: 'API not deployed',
          error: 'SSL check API is not yet available. Deploy the Azure Function to enable SSL monitoring.',
          timestamp: Date.now(),
        };
      }
      const text = await res.text();
      throw new Error(`SSL check failed: ${res.status} ${text}`);
    }

    const data = await res.json();

    if (data.error) {
      return {
        domain, cert: null, status: 'error',
        statusLabel: 'Error', error: data.error,
        timestamp: Date.now(),
      };
    }

    const cert: SSLCertInfo = {
      domain: data.domain,
      issuer: data.issuer,
      validFrom: data.validFrom,
      validTo: data.validTo,
      daysRemaining: data.daysRemaining,
      sans: data.sans || [],
      fingerprint: data.fingerprint || '',
      protocol: data.protocol || '',
    };

    const { status, statusLabel } = classifyExpiry(cert.daysRemaining);

    return { domain, cert, status, statusLabel, error: null, timestamp: Date.now() };
  } catch (err) {
    const message = (err as Error).message;
    // Network errors often mean the API function isn't deployed yet
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      return {
        domain, cert: null, status: 'unchecked',
        statusLabel: 'Unavailable',
        error: 'SSL check API not reachable. It may not be deployed yet.',
        timestamp: Date.now(),
      };
    }
    return {
      domain, cert: null, status: 'error',
      statusLabel: 'Error', error: message,
      timestamp: Date.now(),
    };
  }
}

export function sslStatusColor(status: SSLStatus): string {
  switch (status) {
    case 'valid': return 'text-accent-green';
    case 'expiring': return 'text-accent-yellow';
    case 'critical': return 'text-accent-red';
    case 'expired': return 'text-accent-red';
    case 'error': return 'text-accent-red';
    case 'unchecked': return 'text-text-muted';
  }
}
