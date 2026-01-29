import { useState, useEffect, useCallback } from 'react';
import ConstellixCredentials from './ConstellixCredentials';
import RecordManager from './RecordManager';
import { pushAllRecords, PushProgress, PushError } from '../utils/constellixApi';
import { DnsRecord } from '../utils/zoneParser';
import { getConstellixCredentials, saveConstellixCredentials } from '../utils/userSettings';

interface ConstellixPushProps {
  domain: string;
  records: DnsRecord[];
}

type Phase = 'idle' | 'creating_domain' | 'pushing_records' | 'done' | 'error';

export default function ConstellixPush({ domain, records }: ConstellixPushProps) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<PushProgress | null>(null);
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
    // Reset status after a delay
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

  const busy = phase === 'creating_domain' || phase === 'pushing_records';
  const canPush = apiKey.trim() && secretKey.trim() && !busy;

  async function handlePush() {
    setPhase('creating_domain');
    setProgress(null);

    await pushAllRecords(
      { apiKey: apiKey.trim(), secretKey: secretKey.trim() },
      domain,
      records,
      (p) => {
        setProgress(p);
        setPhase(p.phase as Phase);
      }
    );
  }

  return (
    <div className="constellix-push">
      <h2>Push to Constellix</h2>
      <p className="subtitle">
        Create the domain and push all parsed records to Constellix DNS via API.
        Credentials are saved to your account and synced across devices.
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

      <div className="push-domain-info">
        <span className="label">Domain:</span>
        <span>{domain}</span>
        <span className="muted">({records.length} records)</span>
      </div>

      <button
        className="btn btn-primary"
        onClick={handlePush}
        disabled={!canPush}
      >
        {busy ? 'Pushing...' : 'Push to Constellix'}
      </button>

      {busy && progress && (
        <div className="push-progress">
          <PhaseIndicator phase={phase} />
          {progress.total > 0 && (
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
              <span className="progress-text">
                {progress.message} ({progress.current}/{progress.total})
              </span>
            </div>
          )}
          {progress.total === 0 && (
            <p className="muted">{progress.message}</p>
          )}
        </div>
      )}

      {phase === 'done' && progress && (
        <PushResults progress={progress} />
      )}

      {phase === 'error' && progress && (
        <div className="push-error">
          <p className="error-text">{progress.message}</p>
          {progress.errors.length > 0 && (
            <ErrorTable errors={progress.errors} />
          )}
        </div>
      )}

      {apiKey && secretKey && (
        <RecordManager
          domain={domain}
          credentials={{ apiKey: apiKey.trim(), secretKey: secretKey.trim() }}
        />
      )}
    </div>
  );
}

function PhaseIndicator({ phase }: { phase: Phase }) {
  const labels: Record<Phase, string> = {
    idle: '',
    creating_domain: 'Creating domain...',
    pushing_records: 'Pushing records...',
    done: 'Complete',
    error: 'Error',
  };

  return (
    <div className="phase-indicator">
      <span className={`phase-dot phase-${phase}`} />
      <span>{labels[phase]}</span>
    </div>
  );
}

function PushResults({ progress }: { progress: PushProgress }) {
  const allGood = progress.errors.length === 0;

  return (
    <div className="push-results">
      <div className={`summary ${allGood ? 'summary-success' : 'summary-warning'}`}>
        {allGood ? (
          <span>
            All {progress.successes} records pushed successfully.
          </span>
        ) : (
          <span>
            {progress.successes} succeeded, {progress.errors.length} failed
          </span>
        )}
      </div>

      {progress.errors.length > 0 && (
        <ErrorTable errors={progress.errors} />
      )}
    </div>
  );
}

function ErrorTable({ errors }: { errors: PushError[] }) {
  return (
    <div className="table-container">
      <table className="record-table push-error-table">
        <thead>
          <tr>
            <th>Record</th>
            <th>Type</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((err, i) => (
            <tr key={i}>
              <td>{err.record}</td>
              <td>
                <span className={`badge badge-${err.type.toLowerCase()}`}>
                  {err.type}
                </span>
              </td>
              <td className="value-cell error-text">{err.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
