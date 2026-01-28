import { useState } from 'react';
import { lookupNS } from '../utils/dnsLookup';

interface NSLookupProps {
  domain: string;
  onNSFound: (nameservers: string[]) => void;
}

export default function NSLookup({ domain, onNSFound }: NSLookupProps) {
  const [nameservers, setNameservers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLookup() {
    setLoading(true);
    setError('');
    try {
      const ns = await lookupNS(domain);
      setNameservers(ns);
      onNSFound(ns);
    } catch (err) {
      setError(`Failed to lookup NS records for ${domain}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ns-lookup">
      <h2>Current Nameservers</h2>
      <p className="subtitle">
        Detect the current authoritative nameservers for <strong>{domain}</strong>.
      </p>

      <button
        className="btn btn-primary"
        onClick={handleLookup}
        disabled={loading}
      >
        {loading ? 'Looking up...' : 'Lookup Current NS'}
      </button>

      {error && <p className="error-text">{error}</p>}

      {nameservers.length > 0 && (
        <div className="ns-results">
          <h3>Current NS Records</h3>
          <ul className="ns-list">
            {nameservers.map((ns) => (
              <li key={ns}>{ns}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
