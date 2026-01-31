import { useState, useEffect } from 'react';
import { ConstellixDomain, listDomains, ConstellixCredentials } from '../utils/constellixApi';
import { getConstellixCredentials } from '../utils/userSettings';
import RecordManager from './RecordManager';

export default function DomainBrowser() {
  const [creds, setCreds] = useState<ConstellixCredentials | null>(null);
  const [credsLoading, setCredsLoading] = useState(true);
  const [domains, setDomains] = useState<ConstellixDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<ConstellixDomain | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

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
      setDomains(result.domains.sort((a, b) => a.name.localeCompare(b.name)));
    }

    setLoading(false);
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
          </div>
          <div className="domain-grid">
            {filteredDomains.map((domain) => (
              <button
                key={domain.id}
                className="domain-card"
                onClick={() => handleSelectDomain(domain)}
              >
                <span className="domain-name">{domain.name}</span>
                <span className={`domain-status status-${domain.status.toLowerCase()}`}>
                  {domain.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
