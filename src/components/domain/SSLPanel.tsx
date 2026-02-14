import { useState, useEffect, useCallback } from 'react';
import { checkSSL, SSLCheckResult, sslStatusColor } from '../../utils/sslCheck';

interface SSLPanelProps {
  domain: string;
  onResult?: (result: SSLCheckResult) => void;
}

const resultCache = new Map<string, SSLCheckResult>();

export default function SSLPanel({ domain, onResult }: SSLPanelProps) {
  const [result, setResult] = useState<SSLCheckResult | null>(resultCache.get(domain) ?? null);
  const [loading, setLoading] = useState(false);

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const res = await checkSSL(domain);
      resultCache.set(domain, res);
      setResult(res);
      onResult?.(res);
    } finally {
      setLoading(false);
    }
  }, [domain, onResult]);

  useEffect(() => {
    if (!result) {
      runCheck();
    } else {
      onResult?.(result);
    }
  }, [domain]);

  if (loading && !result) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center">
        <div className="text-text-secondary mb-2">Checking SSL certificate...</div>
      </div>
    );
  }

  if (!result) return null;

  if (result.status === 'unchecked') {
    return (
      <div className="bg-surface border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">SSL Certificate</h3>
        <div className="bg-surface-dark border border-border rounded-lg p-4 text-center">
          <div className="text-text-secondary text-sm mb-2">SSL check requires a server-side API</div>
          <p className="text-text-muted text-xs">{result.error}</p>
          <p className="text-text-muted text-xs mt-2">
            Deploy the <span className="font-mono">api/sslCheck</span> Azure Function to enable this feature.
          </p>
        </div>
      </div>
    );
  }

  if (result.status === 'error' || !result.cert) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">SSL Certificate</h3>
        <div className="text-accent-red text-sm">{result.error}</div>
        <button className="btn btn-secondary btn-sm mt-3" onClick={runCheck} disabled={loading}>
          {loading ? 'Checking...' : 'Retry'}
        </button>
      </div>
    );
  }

  const cert = result.cert;
  const statusClr = sslStatusColor(result.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">SSL Certificate</h3>
        <button className="btn btn-ghost btn-sm" onClick={runCheck} disabled={loading}>
          {loading ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {/* Status card */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center gap-4 mb-4">
          <div className={`text-3xl font-bold ${statusClr}`}>
            {cert.daysRemaining <= 0 ? 'EXPIRED' : `${cert.daysRemaining}d`}
          </div>
          <div>
            <div className={`text-sm font-medium ${statusClr}`}>
              {result.status === 'valid' ? 'Certificate Valid' :
               result.status === 'expiring' ? 'Expiring Soon' :
               result.status === 'critical' ? 'Expiring Critical' : 'Expired'}
            </div>
            <div className="text-text-muted text-xs">
              Expires {new Date(cert.validTo).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Detail label="Issuer" value={cert.issuer} />
          <Detail label="Valid From" value={new Date(cert.validFrom).toLocaleDateString()} />
          <Detail label="Valid To" value={new Date(cert.validTo).toLocaleDateString()} />
          {cert.protocol && <Detail label="Protocol" value={cert.protocol} />}
          {cert.fingerprint && <Detail label="Fingerprint" value={cert.fingerprint} mono />}
        </div>
      </div>

      {/* SANs */}
      {cert.sans.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-2">
            Subject Alternative Names ({cert.sans.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cert.sans.map(san => (
              <span
                key={san}
                className="px-2 py-0.5 rounded text-xs font-mono bg-surface-dark border border-border text-text-secondary"
              >
                {san}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-text-muted text-xs">{label}</div>
      <div className={`text-text-secondary ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</div>
    </div>
  );
}
