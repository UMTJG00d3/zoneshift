import { useState } from 'react';
import ConstellixCredentials from './ConstellixCredentials';
import { pushAllRecords, PushProgress, PushError } from '../utils/constellixApi';
import { DnsRecord } from '../utils/zoneParser';

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
        Credentials are sent through the server proxy and are never stored.
      </p>

      <ConstellixCredentials
        apiKey={apiKey}
        secretKey={secretKey}
        onApiKeyChange={setApiKey}
        onSecretKeyChange={setSecretKey}
      />

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
