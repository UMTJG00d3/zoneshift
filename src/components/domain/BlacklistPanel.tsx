import { useState, useEffect, useCallback } from 'react';
import { validateMx, MxValidationResult, MxHost } from '../../utils/mxValidation';

interface BlacklistPanelProps {
  domain: string;
  onResult?: (result: MxValidationResult) => void;
}

const resultCache = new Map<string, MxValidationResult>();

export default function BlacklistPanel({ domain, onResult }: BlacklistPanelProps) {
  const [result, setResult] = useState<MxValidationResult | null>(resultCache.get(domain) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await validateMx(domain);
      resultCache.set(domain, res);
      setResult(res);
      onResult?.(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, onResult]);

  useEffect(() => {
    if (!result) {
      runScan();
    } else {
      onResult?.(result);
    }
  }, [domain]);

  if (loading && !result) {
    return (
      <div className="bg-surface border border-border rounded-lg p-8 text-center">
        <div className="text-text-secondary mb-2">Validating MX records and checking blacklists...</div>
        <div className="text-text-muted text-sm">Resolving MX hosts and querying DNSBLs</div>
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4">
        <p className="text-accent-red text-sm">{error}</p>
        <button className="btn btn-secondary btn-sm mt-2" onClick={runScan}>Retry</button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">MX & Blacklist Validation</h3>
        <button className="btn btn-ghost btn-sm" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning...' : 'Re-scan'}
        </button>
      </div>

      {/* MX Hosts */}
      {result.hosts.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-text-muted text-xs uppercase tracking-wide">
            MX Records ({result.hosts.length})
          </div>
          <div className="divide-y divide-border">
            {result.hosts.map((host, i) => (
              <MxHostRow key={i} host={host} />
            ))}
          </div>
        </div>
      )}

      {/* API availability note */}
      {!result.apiAvailable && (
        <div className="bg-surface-dark border border-border rounded-lg p-3 text-center">
          <div className="text-text-secondary text-sm">Blacklist and SMTP testing requires server-side APIs</div>
          <p className="text-text-muted text-xs mt-1">
            Deploy the <span className="font-mono">api/emailBlacklist</span> and <span className="font-mono">api/emailSmtpTest</span> Azure Functions for full validation.
          </p>
        </div>
      )}

      {/* Findings */}
      {result.findings.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-2">Findings</div>
          <ul className="flex flex-col gap-1">
            {result.findings.map((f, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 ${
                  f.severity === 'pass' ? 'text-accent-green' :
                  f.severity === 'warn' ? 'text-accent-yellow' :
                  f.severity === 'fail' ? 'text-accent-red' : 'text-accent-blue'
                }`}>
                  {f.severity === 'pass' ? '✓' : f.severity === 'warn' ? '⚠' : f.severity === 'fail' ? '✗' : 'ℹ'}
                </span>
                <span className="text-text-secondary">{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MxHostRow({ host }: { host: MxHost }) {
  const hasBlacklist = host.blacklistStatus && host.blacklistStatus.listed.length > 0;

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted font-mono w-6 text-right">{host.priority}</span>
        <span className="text-sm font-mono text-text-primary">{host.hostname}</span>
        {hasBlacklist && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-accent-red/20 text-accent-red border border-accent-red/30">
            LISTED
          </span>
        )}
        {host.smtpStatus?.reachable && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-accent-green/20 text-accent-green border border-accent-green/30">
            SMTP OK
          </span>
        )}
        {host.smtpStatus && !host.smtpStatus.reachable && (
          <span className="px-1.5 py-0.5 rounded text-xs bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/30">
            SMTP FAIL
          </span>
        )}
      </div>

      {host.ips.length > 0 && (
        <div className="ml-9 flex flex-wrap gap-1.5">
          {host.ips.map(ip => (
            <span key={ip} className="text-xs font-mono text-text-secondary bg-surface-dark px-1.5 py-0.5 rounded border border-border">
              {ip}
            </span>
          ))}
        </div>
      )}

      {hasBlacklist && host.blacklistStatus && (
        <div className="ml-9">
          <span className="text-xs text-accent-red">
            Listed on: {host.blacklistStatus.listed.map(l => l.name).join(', ')}
          </span>
        </div>
      )}

      {host.smtpStatus?.banner && (
        <div className="ml-9 text-xs text-text-muted font-mono truncate" title={host.smtpStatus.banner}>
          {host.smtpStatus.banner}
        </div>
      )}
    </div>
  );
}
