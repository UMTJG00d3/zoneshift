import { useState, useEffect } from 'react';
import { ConstellixDomain, listDomains, ConstellixCredentials } from '../utils/constellixApi';
import { getConstellixCredentials } from '../utils/userSettings';
import { dohLookup } from '../utils/dnsLookup';
import RecordManager from './RecordManager';

interface DomainNSInfo {
  nameservers: string[];
  isConstellix: boolean;
  loading: boolean;
  error?: string;
}

export default function DomainBrowser() {
  const [creds, setCreds] = useState<ConstellixCredentials | null>(null);
  const [credsLoading, setCredsLoading] = useState(true);
  const [domains, setDomains] = useState<ConstellixDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<ConstellixDomain | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [nsInfo, setNsInfo] = useState<Record<string, DomainNSInfo>>({});
  const [loadingNS, setLoadingNS] = useState(false);

  // Load credentials on mount
  useEffect(() => {
    setCredsLoading(true);
    getConstellixCredentials()
      .then((saved) => setCreds(saved))
      .finally(() => setCredsLoading(false));
  }, []);

  // Load domains when credentials are available
  useEffect(() => {
    if (creds) {
      loadDomains();
    }
  }, [creds]);

  async function loadDomains() {
    if (!creds) return;

    setLoading(true);
    setError(null);

    const result = await listDomains(creds);

    if (result.error) {
      setError(result.error);
    } else {
      const sortedDomains = result.domains.sort((a, b) => a.name.localeCompare(b.name));
      setDomains(sortedDomains);
      // Start loading NS records for all domains
      loadAllNSRecords(sortedDomains);
    }

    setLoading(false);
  }

  async function loadAllNSRecords(domainList: ConstellixDomain[]) {
    setLoadingNS(true);

    // Initialize all as loading
    const initialState: Record<string, DomainNSInfo> = {};
    domainList.forEach(d => {
      initialState[d.name] = { nameservers: [], isConstellix: false, loading: true };
    });
    setNsInfo(initialState);

    // Query NS records in batches to avoid overwhelming
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
              nameservers: [],
              isConstellix: false,
              loading: false,
              error: (err as Error).message
            }
          }));
        }
      }));
      // Small delay between batches
      if (i + batchSize < domainList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    setLoadingNS(false);
  }

  function handleSelectDomain(domain: ConstellixDomain) {
    setSelectedDomain(domain);
  }

  function handleBack() {
    setSelectedDomain(null);
  }

  const filteredDomains = domains.filter(d =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const hasCreds = creds !== null;

  // Show loading state
  if (credsLoading) {
    return (
      <div className="domain-browser">
        <h2>Constellix Domains</h2>
        <p className="muted">Loading credentials...</p>
      </div>
    );
  }

  // Show credentials missing message
  if (!hasCreds) {
    return (
      <div className="domain-browser">
        <h2>Constellix Domains</h2>
        <div className="creds-status creds-missing">
          <span>No Constellix credentials configured. </span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'settings' }));
            }}
          >
            Go to Settings
          </a>
          <span> to add your API keys.</span>
        </div>
      </div>
    );
  }

  // Show selected domain's records
  if (selectedDomain) {
    return (
      <div className="domain-browser">
        <div className="domain-browser-header">
          <button className="btn btn-ghost" onClick={handleBack}>
            &larr; Back to Domains
          </button>
          <h2>{selectedDomain.name}</h2>
        </div>
        <RecordManager
          domain={selectedDomain.name}
          credentials={creds}
        />
      </div>
    );
  }

  // Show domain list
  return (
    <div className="domain-browser">
      <h2>Constellix Domains</h2>
      <p className="subtitle">Select a domain to view and manage its DNS records</p>

      <div className="domain-browser-actions">
        <input
          type="text"
          placeholder="Search domains..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="domain-search"
        />
        <button
          className="btn btn-secondary"
          onClick={loadDomains}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {loading && domains.length === 0 && (
        <p className="muted">Loading domains...</p>
      )}

      {!loading && domains.length === 0 && !error && (
        <p className="muted">No domains found in your Constellix account.</p>
      )}

      {filteredDomains.length > 0 && (
        <div className="domain-list">
          <div className="domain-count">
            {filteredDomains.length} domain{filteredDomains.length !== 1 ? 's' : ''}
            {searchTerm && ` matching "${searchTerm}"`}
            {loadingNS && <span className="muted"> (checking NS records...)</span>}
          </div>
          <div className="domain-table-container">
            <table className="domain-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Constellix</th>
                  <th>Current Nameservers</th>
                  <th>DNS Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDomains.map((domain) => {
                  const ns = nsInfo[domain.name];
                  return (
                    <tr
                      key={domain.id}
                      className="domain-row"
                      onClick={() => handleSelectDomain(domain)}
                    >
                      <td className="domain-name-cell">
                        <span className="domain-name">{domain.name}</span>
                      </td>
                      <td>
                        <span className={`domain-status status-${domain.status.toLowerCase()}`}>
                          {domain.status}
                        </span>
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
