import { useState, useEffect, useCallback } from 'react';
import ConstellixCredentials from './ConstellixCredentials';
import RecordManager from './RecordManager';
import { getConstellixCredentials, saveConstellixCredentials } from '../utils/userSettings';

interface DomainManagerProps {
  domain: string;
  onBack: () => void;
}

export default function DomainManager({ domain, onBack }: DomainManagerProps) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load saved credentials on mount
  useEffect(() => {
    getConstellixCredentials().then((creds) => {
      if (creds) {
        setApiKey(creds.apiKey);
        setSecretKey(creds.secretKey);
      }
      setCredentialsLoaded(true);
    });
  }, []);

  // Auto-save credentials when they change (debounced)
  const saveCredentials = useCallback(async (key: string, secret: string) => {
    if (!key.trim() || !secret.trim()) return;
    setSaveStatus('saving');
    const success = await saveConstellixCredentials(key.trim(), secret.trim());
    setSaveStatus(success ? 'saved' : 'error');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, []);

  useEffect(() => {
    if (!credentialsLoaded) return;
    if (!apiKey.trim() || !secretKey.trim()) return;

    const timeout = setTimeout(() => {
      saveCredentials(apiKey, secretKey);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [apiKey, secretKey, credentialsLoaded, saveCredentials]);

  const hasCredentials = apiKey.trim() && secretKey.trim();

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

      <ConstellixCredentials
        apiKey={apiKey}
        secretKey={secretKey}
        onApiKeyChange={setApiKey}
        onSecretKeyChange={setSecretKey}
      />

      {saveStatus !== 'idle' && (
        <div className={`save-status save-status-${saveStatus}`}>
          {saveStatus === 'saving' && 'Saving credentials...'}
          {saveStatus === 'saved' && 'Credentials saved'}
          {saveStatus === 'error' && 'Failed to save credentials'}
        </div>
      )}

      {!hasCredentials && (
        <p className="muted">Enter your Constellix API credentials above to manage records.</p>
      )}

      {hasCredentials && (
        <RecordManager
          domain={domain}
          credentials={{ apiKey: apiKey.trim(), secretKey: secretKey.trim() }}
        />
      )}
    </div>
  );
}
