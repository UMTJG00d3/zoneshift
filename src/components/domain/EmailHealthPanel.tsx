import { useState, useEffect, useCallback } from 'react';
import {
  validateEmailHealth,
  EmailHealthResult,
  SpfResult,
  DkimResult,
  DkimSelectorResult,
  DmarcResult,
  Finding,
  Severity,
} from '../../utils/emailAuthValidation';

interface EmailHealthPanelProps {
  domain: string;
  onResult?: (result: EmailHealthResult) => void;
}

// Cache results per domain to avoid re-scanning on tab switches
const resultCache = new Map<string, EmailHealthResult>();

export default function EmailHealthPanel({ domain, onResult }: EmailHealthPanelProps) {
  const [result, setResult] = useState<EmailHealthResult | null>(resultCache.get(domain) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await validateEmailHealth(domain);
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
        <div className="text-text-secondary mb-2">Scanning email authentication...</div>
        <div className="text-text-muted text-sm">Checking SPF, DKIM selectors, and DMARC</div>
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
        <h3 className="text-lg font-semibold">Email Authentication</h3>
        <button
          className="btn btn-ghost btn-sm"
          onClick={runScan}
          disabled={loading}
        >
          {loading ? 'Scanning...' : 'Re-scan'}
        </button>
      </div>

      <SpfSection spf={result.spf} />
      <DkimSection dkim={result.dkim} />
      <DmarcSection dmarc={result.dmarc} />
    </div>
  );
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function statusIcon(severity: Severity): string {
  switch (severity) {
    case 'pass': return '✓';
    case 'warn': return '⚠';
    case 'fail': return '✗';
    case 'info': return 'ℹ';
  }
}

function statusColor(severity: Severity): string {
  switch (severity) {
    case 'pass': return 'text-accent-green';
    case 'warn': return 'text-accent-yellow';
    case 'fail': return 'text-accent-red';
    case 'info': return 'text-accent-blue';
  }
}

function StatusBadge({ severity, label }: { severity: Severity; label: string }) {
  const bgMap: Record<Severity, string> = {
    pass: 'bg-accent-green/20 text-accent-green border-accent-green/30',
    warn: 'bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30',
    fail: 'bg-accent-red/20 text-accent-red border-accent-red/30',
    info: 'bg-accent-blue/20 text-accent-blue border-accent-blue/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${bgMap[severity]}`}>
      {statusIcon(severity)} {label}
    </span>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="flex flex-col gap-1 mt-2">
      {findings.map((f, i) => (
        <li key={i} className={`text-sm flex items-start gap-2 ${statusColor(f.severity)}`}>
          <span className="shrink-0 mt-0.5">{statusIcon(f.severity)}</span>
          <span className="text-text-secondary">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

function RecordDisplay({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-2">
      <div className="text-text-muted text-xs uppercase tracking-wide mb-1">{label}</div>
      <pre className="text-xs bg-surface-dark border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-text-secondary">
        {value}
      </pre>
    </div>
  );
}

// ─── SPF Section ─────────────────────────────────────────────────────────────

function SpfSection({ spf }: { spf: SpfResult }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">SPF</span>
          <StatusBadge severity={spf.status} label={spf.found ? spf.qualifier : 'Missing'} />
        </div>
      </div>

      {/* DNS lookup counter bar */}
      {spf.found && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>DNS Lookups</span>
            <span className={spf.lookupCount > 10 ? 'text-accent-red font-semibold' : ''}>
              {spf.lookupCount} / {spf.maxLookups}
            </span>
          </div>
          <div className="w-full h-2 bg-surface-dark rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                spf.lookupCount > 10 ? 'bg-accent-red' :
                spf.lookupCount > 7 ? 'bg-accent-yellow' : 'bg-accent-green'
              }`}
              style={{ width: `${Math.min(100, (spf.lookupCount / spf.maxLookups) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <RecordDisplay label="SPF Record" value={spf.record} />
      <FindingsList findings={spf.findings} />
    </div>
  );
}

// ─── DKIM Section ────────────────────────────────────────────────────────────

function DkimSection({ dkim }: { dkim: DkimResult }) {
  const [showAll, setShowAll] = useState(false);
  const foundSelectors = dkim.selectors.filter(s => s.found);
  const missingSelectors = dkim.selectors.filter(s => !s.found);

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DKIM</span>
          <StatusBadge
            severity={dkim.status}
            label={dkim.foundCount > 0 ? `${dkim.foundCount} found` : 'None found'}
          />
        </div>
      </div>

      {/* Selector grid */}
      {foundSelectors.length > 0 && (
        <div className="mb-3">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-1">Found Selectors</div>
          <div className="flex flex-wrap gap-1.5">
            {foundSelectors.map(s => (
              <SelectorChip key={s.selector} selector={s} />
            ))}
          </div>
        </div>
      )}

      {showAll && missingSelectors.length > 0 && (
        <div className="mb-3">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-1">Not Found</div>
          <div className="flex flex-wrap gap-1.5">
            {missingSelectors.map(s => (
              <span key={s.selector} className="px-2 py-0.5 rounded text-xs bg-surface-dark text-text-muted border border-border">
                {s.selector}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        className="text-xs text-accent-blue hover:underline"
        onClick={() => setShowAll(!showAll)}
      >
        {showAll ? 'Hide' : 'Show'} all {dkim.selectors.length} selectors checked
      </button>

      <FindingsList findings={dkim.findings} />
    </div>
  );
}

function SelectorChip({ selector }: { selector: DkimSelectorResult }) {
  const strengthColor = selector.keyLength === 'strong' ? 'border-accent-green/50' :
    selector.keyLength === 'ok' ? 'border-accent-yellow/50' :
    selector.keyLength === 'weak' ? 'border-accent-red/50' : 'border-border';

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs bg-accent-green/10 text-accent-green border ${strengthColor}`}
      title={selector.record ? `${selector.keyType || 'rsa'} key (${selector.keyLength || 'delegated'})\n${selector.record}` : ''}
    >
      {selector.selector}
      {selector.keyLength && (
        <span className="ml-1 opacity-60">
          {selector.keyLength === 'strong' ? '2048+' : selector.keyLength === 'ok' ? '1024' : '<1024'}
        </span>
      )}
    </span>
  );
}

// ─── DMARC Section ───────────────────────────────────────────────────────────

function DmarcSection({ dmarc }: { dmarc: DmarcResult }) {
  const policySteps = ['none', 'quarantine', 'reject'] as const;
  const currentIdx = dmarc.policy ? policySteps.indexOf(dmarc.policy as typeof policySteps[number]) : -1;

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DMARC</span>
          <StatusBadge
            severity={dmarc.status}
            label={dmarc.policy ? `p=${dmarc.policy}` : 'Missing'}
          />
        </div>
      </div>

      {/* Policy progression roadmap */}
      {dmarc.found && (
        <div className="mb-3">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-2">Policy Progression</div>
          <div className="flex items-center gap-0">
            {policySteps.map((step, idx) => {
              const isActive = idx <= currentIdx;
              const isCurrent = idx === currentIdx;
              return (
                <div key={step} className="flex items-center">
                  {idx > 0 && (
                    <div className={`w-8 h-0.5 ${isActive ? 'bg-accent-green' : 'bg-border'}`} />
                  )}
                  <div className={`flex flex-col items-center ${isCurrent ? '' : 'opacity-50'}`}>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                        isActive ? 'bg-accent-green/20 border-accent-green text-accent-green' : 'bg-surface-dark border-border text-text-muted'
                      }`}
                    >
                      {isActive ? '✓' : idx + 1}
                    </div>
                    <span className={`text-xs mt-1 ${isCurrent ? 'text-text-primary font-medium' : 'text-text-muted'}`}>
                      {step}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Report URIs */}
      {dmarc.rua.length > 0 && (
        <div className="mb-2">
          <span className="text-text-muted text-xs">Reports (rua): </span>
          <span className="text-xs text-text-secondary font-mono">{dmarc.rua.join(', ')}</span>
        </div>
      )}

      <RecordDisplay label="DMARC Record" value={dmarc.record} />
      <FindingsList findings={dmarc.findings} />
    </div>
  );
}

// ─── Export summary for overview cards ───────────────────────────────────────

export function getEmailHealthSummary(result: EmailHealthResult | null): {
  spf: { status: Severity; label: string };
  dkim: { status: Severity; label: string };
  dmarc: { status: Severity; label: string };
} {
  if (!result) {
    return {
      spf: { status: 'info', label: 'Not scanned' },
      dkim: { status: 'info', label: 'Not scanned' },
      dmarc: { status: 'info', label: 'Not scanned' },
    };
  }
  return {
    spf: { status: result.spf.status, label: result.spf.found ? result.spf.qualifier : 'Missing' },
    dkim: { status: result.dkim.status, label: result.dkim.foundCount > 0 ? `${result.dkim.foundCount} selectors` : 'None found' },
    dmarc: { status: result.dmarc.status, label: result.dmarc.policy ? `p=${result.dmarc.policy}` : 'Missing' },
  };
}
