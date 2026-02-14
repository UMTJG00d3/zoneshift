import { useState, useEffect, useMemo } from 'react';
import { ConstellixDomain, listDomains } from '../../utils/constellixApi';
import { dohLookup } from '../../utils/dnsLookup';
import { useCredentials } from '../../context/CredentialsContext';
import { navigate } from '../../utils/router';
import { validateSpf, validateDmarc, type Severity } from '../../utils/emailAuthValidation';
import { fetchAllScanResults, formatScanAge, type StoredScanResult } from '../../utils/scanResults';
import { HealthScoreBadge } from '../common/HealthScore';

interface DomainNSInfo {
  nameservers: string[];
  isConstellix: boolean;
  loading: boolean;
  error?: string;
}

interface DomainEmailQuick {
  spf: Severity;
  dmarc: Severity;
  overall: Severity;
  loading: boolean;
}

export default function DomainsPage() {
  const { credentials, loading: credsLoading } = useCredentials();
  const [domains, setDomains] = useState<ConstellixDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [nsInfo, setNsInfo] = useState<Record<string, DomainNSInfo>>({});
  const [loadingNS, setLoadingNS] = useState(false);
  const [emailHealth, setEmailHealth] = useState<Record<string, DomainEmailQuick>>({});
  const [storedScans, setStoredScans] = useState<Record<string, StoredScanResult>>({});
  const [scansLoaded, setScansLoaded] = useState(false);

  // Load stored scan results immediately (no credentials needed)
  useEffect(() => {
    fetchAllScanResults().then(results => {
      const map: Record<string, StoredScanResult> = {};
      for (const r of results) map[r.domain] = r;
      setStoredScans(map);
      setScansLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (credentials) {
      loadDomains();
    }
  }, [credentials]);

  async function loadDomains() {
    if (!credentials) return;
    setLoading(true);
    setError(null);

    const result = await listDomains(credentials);
    if (result.error) {
      setError(result.error);
    } else {
      const sorted = result.domains.sort((a, b) => a.name.localeCompare(b.name));
      setDomains(sorted);
      loadAllNSRecords(sorted);
    }
    setLoading(false);
  }

  async function loadAllNSRecords(domainList: ConstellixDomain[]) {
    setLoadingNS(true);
    const initial: Record<string, DomainNSInfo> = {};
    domainList.forEach(d => {
      initial[d.name] = { nameservers: [], isConstellix: false, loading: true };
    });
    setNsInfo(initial);

    const batchSize = 5;
    for (let i = 0; i < domainList.length; i += batchSize) {
      const batch = domainList.slice(i, i + batchSize);
      await Promise.all(batch.map(async (domain) => {
        try {
          const answers = await dohLookup(domain.name, 'NS');
          const nameservers = answers.map(a => a.data.toLowerCase().replace(/\.$/, ''));
          const isConstellix = nameservers.some(ns =>
            ns.includes('constellix.com') || ns.includes('constellix.net')
          );
          setNsInfo(prev => ({
            ...prev,
            [domain.name]: { nameservers, isConstellix, loading: false }
          }));
        } catch (err) {
          setNsInfo(prev => ({
            ...prev,
            [domain.name]: {
              nameservers: [], isConstellix: false, loading: false,
              error: (err as Error).message
            }
          }));
        }
      }));
      if (i + batchSize < domainList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    setLoadingNS(false);

    // Start quick email health scan after NS records load
    loadEmailHealth(domainList);
  }

  async function loadEmailHealth(domainList: ConstellixDomain[]) {
    const initial: Record<string, DomainEmailQuick> = {};
    domainList.forEach(d => {
      initial[d.name] = { spf: 'info', dmarc: 'info', overall: 'info', loading: true };
    });
    setEmailHealth(initial);

    const batchSize = 3;
    for (let i = 0; i < domainList.length; i += batchSize) {
      const batch = domainList.slice(i, i + batchSize);
      await Promise.all(batch.map(async (domain) => {
        try {
          const [spf, dmarc] = await Promise.all([
            validateSpf(domain.name),
            validateDmarc(domain.name),
          ]);
          const overall: Severity = [spf.status, dmarc.status].includes('fail') ? 'fail'
            : [spf.status, dmarc.status].includes('warn') ? 'warn' : 'pass';
          setEmailHealth(prev => ({
            ...prev,
            [domain.name]: { spf: spf.status, dmarc: dmarc.status, overall, loading: false }
          }));
        } catch {
          setEmailHealth(prev => ({
            ...prev,
            [domain.name]: { spf: 'info', dmarc: 'info', overall: 'info', loading: false }
          }));
        }
      }));
      if (i + batchSize < domainList.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  const filteredDomains = useMemo(() =>
    domains.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [domains, searchTerm]
  );

  if (credsLoading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Domains</h2>
        <p className="text-text-muted">Loading credentials...</p>
      </div>
    );
  }

  if (!credentials) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4">Domains</h2>
        <div className="bg-surface border border-border rounded-lg p-4 text-text-secondary">
          No Constellix credentials configured.{' '}
          <a href="#/settings" className="text-accent-blue underline">Go to Settings</a>{' '}
          to add your API keys.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Domains</h2>
          <p className="text-text-secondary text-sm mt-0.5">Manage DNS records and monitor domain health</p>
        </div>
        <a href="#/migrate" className="btn btn-primary">
          Add Domain
        </a>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search domains..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full font-sans text-sm py-3 pl-11 pr-4 bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-secondary"
            onClick={loadDomains}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          {loadingNS && <span className="text-text-muted text-xs">Checking NS records...</span>}
        </div>
      </div>

      {error && <p className="text-accent-red text-sm">{error}</p>}

      {loading && domains.length === 0 && (
        <p className="text-text-muted">Loading domains...</p>
      )}

      {!loading && domains.length === 0 && !error && (
        <p className="text-text-muted">No domains found in your Constellix account.</p>
      )}

      {filteredDomains.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-surface-card/50 text-text-secondary text-xs">
            {filteredDomains.length} domain{filteredDomains.length !== 1 ? 's' : ''}
            {searchTerm && ` matching "${searchTerm}"`}
          </div>
          <div className="overflow-x-auto">
            <table className="domain-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Health</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Current Nameservers</th>
                  <th>DNS Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDomains.map(domain => {
                  const ns = nsInfo[domain.name];
                  const scan = storedScans[domain.name];
                  return (
                    <tr
                      key={domain.id}
                      className="domain-row"
                      onClick={() => navigate(`/domains/${encodeURIComponent(domain.name)}`)}
                    >
                      <td className="domain-name-cell">
                        <span className="domain-name">{domain.name}</span>
                        {scan && (
                          <span className="text-text-muted text-[10px] ml-2" title={`Last scan: ${scan.scannedAt}`}>
                            {formatScanAge(scan.scannedAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        {scan ? (
                          <HealthScoreBadge score={scan.healthScore} size="sm" />
                        ) : scansLoaded ? (
                          <span className="text-text-muted text-xs">—</span>
                        ) : (
                          <span className="text-text-muted text-xs">...</span>
                        )}
                      </td>
                      <td>
                        <span className={`domain-status status-${domain.status.toLowerCase()}`}>
                          {domain.status}
                        </span>
                      </td>
                      <td>
                        <EmailQuickBadge info={emailHealth[domain.name]} />
                      </td>
                      <td className="ns-cell">
                        {ns?.loading ? (
                          <span className="muted">checking...</span>
                        ) : ns?.error ? (
                          <span className="error-text" title={ns.error}>error</span>
                        ) : ns?.nameservers.length ? (
                          <span className="ns-list-inline" title={ns.nameservers.join('\n')}>
                            {ns.nameservers[0]}
                            {ns.nameservers.length > 1 && (
                              <span className="ns-more">+{ns.nameservers.length - 1}</span>
                            )}
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        {ns?.loading ? (
                          <span className="dns-status dns-status-checking">...</span>
                        ) : ns?.isConstellix ? (
                          <span className="dns-status dns-status-live">LIVE</span>
                        ) : ns?.nameservers.length ? (
                          <span className="dns-status dns-status-notpointed">NOT POINTED</span>
                        ) : (
                          <span className="dns-status dns-status-unknown">?</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailQuickBadge({ info }: { info?: DomainEmailQuick }) {
  if (!info || info.loading) {
    return <span className="text-text-muted text-xs">...</span>;
  }

  const colorMap: Record<Severity, string> = {
    pass: 'bg-accent-green/20 text-accent-green border-accent-green/30',
    warn: 'bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30',
    fail: 'bg-accent-red/20 text-accent-red border-accent-red/30',
    info: 'bg-surface-card/50 text-text-muted border-border',
  };

  const iconMap: Record<Severity, string> = {
    pass: '✓', warn: '⚠', fail: '✗', info: '—',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${colorMap[info.overall]}`}
      title={`SPF: ${info.spf}, DMARC: ${info.dmarc}`}
    >
      {iconMap[info.overall]}
    </span>
  );
}
