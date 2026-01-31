import { useState, useEffect } from 'react';
import RecordManager from './RecordManager';
import { getConstellixCredentials } from '../utils/userSettings';
import { ConstellixCredentials } from '../utils/constellixApi';

interface DomainManagerProps {
  domain: string;
  onBack: () => void;
}

export default function DomainManager({ domain, onBack }: DomainManagerProps) {
  const [creds, setCreds] = useState<ConstellixCredentials | null>(null);
  const [loading, setLoading] = useState(true);

  // Load saved credentials on mount
  useEffect(() => {
    setLoading(true);
    getConstellixCredentials()
      .then((saved) => {
        if (saved) {
          setCreds(saved);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const hasCreds = creds !== null;

  return (
    <div className="domain-manager">
      <div className="domain-manager-header">
        <button className="btn btn-ghost" onClick={onBack}>
          &larr; Back
        </button>
        <h2>Manage: {domain}</h2>
      </div>

      <p className="subtitle">
        View, add, edit, and delete DNS records for this domain in Constellix.
      </p>

      {/* Credentials Status */}
      <div className="creds-status">
        {loading ? (
          <span className="muted">Loading credentials...</span>
        ) : hasCreds ? (
          <span className="creds-ok">Constellix API credentials configured</span>
        ) : (
          <span className="creds-missing">
            No Constellix credentials configured.{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'settings' }));
              }}
            >
              Go to Settings
            </a>{' '}
            to add your API keys.
          </span>
        )}
      </div>

      {hasCreds && (
        <RecordManager
          domain={domain}
          credentials={creds}
        />
      )}
    </div>
  );
}
