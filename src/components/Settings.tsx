import { useState, useEffect } from 'react';
import { getConstellixCredentials, saveConstellixCredentials } from '../utils/userSettings';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loading, setLoading] = useState(true);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  // Load saved credentials on mount
  useEffect(() => {
    setLoading(true);
    getConstellixCredentials()
      .then(saved => {
        if (saved) {
          setApiKey(saved.apiKey);
          setSecretKey(saved.secretKey);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!apiKey || !secretKey) return;

    setSaveStatus('saving');
    const success = await saveConstellixCredentials(apiKey, secretKey);
    setSaveStatus(success ? 'saved' : 'error');

    // Reset status after 3 seconds
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleTest = async () => {
    if (!apiKey || !secretKey) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const res = await fetch('/api/proxy/constellix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          secretKey,
          method: 'GET',
          path: '/domains',
        }),
      });

      const data = await res.json();

      if (data.success) {
        setTestStatus('success');
        setTimeout(() => setTestStatus('idle'), 3000);
      } else {
        setTestStatus('error');
        setTestError(data.error || `HTTP ${data.status}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestError((err as Error).message);
    }
  };

  const hasCreds = apiKey && secretKey;

  if (loading) {
    return (
      <div className="settings">
        <h2>Settings</h2>
        <p className="muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings">
      <h2>Settings</h2>
      <p className="subtitle">Configure your API credentials and preferences</p>

      <section className="settings-section">
        <h3>Constellix API Credentials</h3>
        <p className="settings-description">
          Your credentials are stored securely on the server and synced across all your devices.
          Get your API key and secret from the{' '}
          <a href="https://dns.constellix.com/settings/security" target="_blank" rel="noopener noreferrer">
            Constellix Security Settings
          </a>.
        </p>

        <div className="settings-form">
          <div className="form-field">
            <label htmlFor="settings-api-key">API Key</label>
            <input
              id="settings-api-key"
              type="text"
              placeholder="Enter your Constellix API Key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="form-field">
            <label htmlFor="settings-secret-key">Secret Key</label>
            <input
              id="settings-secret-key"
              type="password"
              placeholder="Enter your Constellix Secret Key"
              value={secretKey}
              onChange={e => setSecretKey(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!hasCreds || saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving...' : 'Save Credentials'}
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleTest}
              disabled={!hasCreds || testStatus === 'testing'}
            >
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>

            {saveStatus === 'saved' && (
              <span className="status-message status-success">Credentials saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="status-message status-error">Failed to save</span>
            )}
            {testStatus === 'success' && (
              <span className="status-message status-success">Connection successful</span>
            )}
            {testStatus === 'error' && (
              <span className="status-message status-error">
                Connection failed{testError ? `: ${testError}` : ''}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>About</h3>
        <div className="about-info">
          <p><strong>ZoneShift</strong> — DNS Migration &amp; Management Tool</p>
          <p className="muted">Built for Umetech MSP</p>
          <ul className="feature-list">
            <li>Import &amp; compare DNS zones before migration</li>
            <li>Bulk changes with changeset JSON files</li>
            <li>Security scanning for legacy hosting and vulnerabilities</li>
            <li>Direct Constellix API integration</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
