import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Changeset,
  ChangesetChange,
  parseChangeset,
  getChangeStats,
  ChangesetValidationError,
  ExecutionProgress,
  ExecutionSummary,
} from '../utils/changesetTypes';
import {
  executeChangeset,
  exportBackup,
  downloadJson,
  saveToHistory,
  ExecutorControl,
} from '../utils/changesetExecutor';
import { ConstellixCredentials as ConstellixCredsType } from '../utils/constellixApi';
import { getConstellixCredentials, saveConstellixCredentials } from '../utils/userSettings';
import ConstellixCredentialsForm from './ConstellixCredentials';

type ViewPhase = 'import' | 'preview' | 'executing' | 'done';

export default function BulkChanges() {
  const [phase, setPhase] = useState<ViewPhase>('import');
  const [changeset, setChangeset] = useState<Changeset | null>(null);
  const [parseErrors, setParseErrors] = useState<ChangesetValidationError[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [creds, setCreds] = useState<ConstellixCredsType>({ apiKey: '', secretKey: '' });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [progress, setProgress] = useState<ExecutionProgress | null>(null);
  const [summary, setSummary] = useState<ExecutionSummary | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const controlRef = useRef<ExecutorControl>({ isPaused: false, isCancelled: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load saved credentials
  useEffect(() => {
    getConstellixCredentials().then(saved => {
      if (saved) {
        setCreds(saved);
      }
    });
  }, []);

  // Save credentials when they change
  useEffect(() => {
    if (creds.apiKey && creds.secretKey) {
      setSaveStatus('saving');
      saveConstellixCredentials(creds.apiKey, creds.secretKey)
        .then((success) => setSaveStatus(success ? 'saved' : 'error'))
        .catch(() => setSaveStatus('error'));
    }
  }, [creds]);

  const handleParse = useCallback((content: string) => {
    const { changeset: parsed, errors } = parseChangeset(content);
    setParseErrors(errors);

    if (parsed) {
      setChangeset(parsed);
      // Select all by default
      setSelectedIndices(new Set(parsed.changes.map((_, i) => i)));
      setPhase('preview');
    }
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);

      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/json') {
        const reader = new FileReader();
        reader.onload = () => {
          handleParse(reader.result as string);
        };
        reader.readAsText(file);
      }
    },
    [handleParse]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          handleParse(reader.result as string);
        };
        reader.readAsText(file);
      }
    },
    [handleParse]
  );

  const handlePasteImport = useCallback(() => {
    const content = textareaRef.current?.value || '';
    if (content.trim()) {
      handleParse(content);
    }
  }, [handleParse]);

  const toggleSelect = (index: number) => {
    const newSet = new Set(selectedIndices);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setSelectedIndices(newSet);
  };

  const selectAll = () => {
    if (changeset) {
      setSelectedIndices(new Set(getFilteredChanges().map((_, i) => changeset.changes.indexOf(getFilteredChanges()[i]))));
    }
  };

  const deselectAll = () => {
    setSelectedIndices(new Set());
  };

  const getFilteredChanges = (): ChangesetChange[] => {
    if (!changeset) return [];
    return changeset.changes.filter(c => {
      if (filterAction !== 'all' && c.action !== filterAction) return false;
      if (filterText && !c.name.toLowerCase().includes(filterText.toLowerCase())) return false;
      return true;
    });
  };

  const handleExportBackup = async () => {
    if (!changeset || !creds.apiKey || !creds.secretKey) return;

    setBackupError(null);
    const { backup, error } = await exportBackup(
      creds,
      changeset.domain,
      changeset.domainId
    );

    if (error) {
      setBackupError(error);
      return;
    }

    if (backup) {
      downloadJson(backup, `${changeset.domain}-backup-${Date.now()}.json`);
    }
  };

  const handleExecute = async () => {
    if (!changeset || !creds.apiKey || !creds.secretKey || selectedIndices.size === 0) return;

    setPhase('executing');
    controlRef.current = { isPaused: false, isCancelled: false };

    const result = await executeChangeset(
      creds,
      changeset,
      selectedIndices,
      controlRef.current,
      setProgress
    );

    setSummary(result);
    saveToHistory(changeset, result);
    setPhase('done');
  };

  const handlePause = () => {
    controlRef.current.isPaused = !controlRef.current.isPaused;
    if (progress) {
      setProgress({ ...progress, isPaused: controlRef.current.isPaused });
    }
  };

  const handleCancel = () => {
    controlRef.current.isCancelled = true;
  };

  const handleReset = () => {
    setPhase('import');
    setChangeset(null);
    setParseErrors([]);
    setSelectedIndices(new Set());
    setFilterAction('all');
    setFilterText('');
    setConfirmed(false);
    setProgress(null);
    setSummary(null);
    setBackupError(null);
    if (textareaRef.current) {
      textareaRef.current.value = '';
    }
  };

  const handleDownloadResults = () => {
    if (!summary || !changeset) return;
    const log = {
      domain: changeset.domain,
      executedAt: new Date().toISOString(),
      summary: {
        success: summary.success,
        failed: summary.failed,
        skipped: summary.skipped,
      },
      results: summary.results.map(r => ({
        action: r.change.action,
        type: r.change.type,
        name: r.change.name,
        status: r.status,
        error: r.error || null,
      })),
    };
    downloadJson(log, `${changeset.domain}-results-${Date.now()}.json`);
  };

  const stats = changeset ? getChangeStats(changeset.changes) : { create: 0, update: 0, delete: 0 };
  const selectedStats = changeset
    ? getChangeStats(changeset.changes.filter((_, i) => selectedIndices.has(i)))
    : { create: 0, update: 0, delete: 0 };
  const hasCreds = creds.apiKey && creds.secretKey;

  return (
    <div className="bulk-changes">
      <h2>Bulk DNS Changes</h2>
      <p className="subtitle">Import a changeset JSON file to execute mass DNS record operations</p>

      {/* Credentials */}
      <div className="bulk-changes-creds">
        <ConstellixCredentialsForm
          apiKey={creds.apiKey}
          secretKey={creds.secretKey}
          onApiKeyChange={(v) => setCreds(c => ({ ...c, apiKey: v }))}
          onSecretKeyChange={(v) => setCreds(c => ({ ...c, secretKey: v }))}
        />
        {saveStatus === 'saved' && <span className="save-status save-status-saved">Credentials saved</span>}
        {saveStatus === 'error' && <span className="save-status save-status-error">Failed to save</span>}
      </div>

      {/* Import Phase */}
      {phase === 'import' && (
        <div className="bulk-import-section">
          <div
            className={`drop-zone ${dragActive ? 'drop-zone-active' : ''}`}
            onDragOver={e => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleFileDrop}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <span className="drop-icon">📁</span>
            <span>Drop changeset JSON file here or click to browse</span>
            <input
              id="file-input"
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          <div className="divider">or paste JSON below</div>

          <textarea
            ref={textareaRef}
            className="zone-textarea"
            rows={12}
            placeholder={`{
  "domain": "example.com",
  "domainId": 123456,
  "description": "Remove legacy records",
  "changes": [
    { "action": "delete", "recordId": 789, "type": "A", "name": "old", "value": "1.2.3.4", "ttl": 3600 }
  ]
}`}
          />

          <button className="btn btn-primary" onClick={handlePasteImport}>
            Parse Changeset
          </button>

          {parseErrors.length > 0 && (
            <div className="parse-errors">
              <h4>Validation Errors</h4>
              <ul>
                {parseErrors.map((err, i) => (
                  <li key={i} className="error-text">
                    {err.index >= 0 ? `Change #${err.index + 1}: ` : ''}
                    {err.field}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Preview Phase */}
      {phase === 'preview' && changeset && (
        <div className="bulk-preview-section">
          <div className="changeset-details">
            <h3>Changeset Details</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Domain:</span>
                <span className="detail-value">{changeset.domain} (ID: {changeset.domainId})</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Description:</span>
                <span className="detail-value">{changeset.description || '(none)'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Created:</span>
                <span className="detail-value">
                  {new Date(changeset.createdAt).toLocaleString()} by {changeset.createdBy}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Total Changes:</span>
                <span className="detail-value">
                  {changeset.totalChanges} ({stats.create} create, {stats.update} update, {stats.delete} delete)
                </span>
              </div>
            </div>
          </div>

          <div className="preview-controls">
            <div className="preview-filters">
              <label>
                <input
                  type="checkbox"
                  checked={selectedIndices.size === changeset.changes.length}
                  onChange={() =>
                    selectedIndices.size === changeset.changes.length ? deselectAll() : selectAll()
                  }
                />{' '}
                Select All
              </label>
              <select value={filterAction} onChange={e => setFilterAction(e.target.value)}>
                <option value="all">All Actions</option>
                <option value="delete">Delete Only</option>
                <option value="create">Create Only</option>
                <option value="update">Update Only</option>
              </select>
              <input
                type="text"
                placeholder="Filter by name..."
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="selection-info">
              Selected: {selectedIndices.size} / {changeset.changes.length}
              {selectedIndices.size > 0 && (
                <span className="selection-stats">
                  ({selectedStats.create} create, {selectedStats.update} update, {selectedStats.delete} delete)
                </span>
              )}
            </div>
          </div>

          <div className="table-container">
            <table className="record-table bulk-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th style={{ width: '80px' }}>Action</th>
                  <th style={{ width: '60px' }}>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                  <th style={{ width: '60px' }}>TTL</th>
                </tr>
              </thead>
              <tbody>
                {getFilteredChanges().map((change, displayIndex) => {
                  const realIndex = changeset.changes.indexOf(change);
                  return (
                    <tr
                      key={realIndex}
                      className={`action-row action-row-${change.action}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIndices.has(realIndex)}
                          onChange={() => toggleSelect(realIndex)}
                        />
                      </td>
                      <td>
                        <span className={`action-badge action-badge-${change.action}`}>
                          {change.action.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${change.type.toLowerCase()}`}>
                          {change.type}
                        </span>
                      </td>
                      <td className="name-cell">{change.name || '@'}</td>
                      <td className="value-cell">{change.value}</td>
                      <td>{change.ttl}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedStats.delete > 0 && (
            <div className="warning-box">
              <span className="warning-icon">⚠️</span>
              <span>
                WARNING: You are about to delete {selectedStats.delete} DNS record
                {selectedStats.delete !== 1 ? 's' : ''}. This action cannot be undone.
                Make sure you have a backup.
              </span>
            </div>
          )}

          <div className="confirmation-section">
            <label className="confirm-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
              />{' '}
              I understand this will modify production DNS
            </label>
          </div>

          {backupError && <p className="error-text">{backupError}</p>}

          <div className="bulk-actions">
            <button className="btn btn-ghost" onClick={handleReset}>
              Cancel
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleExportBackup}
              disabled={!hasCreds}
            >
              Export Backup First
            </button>
            <button
              className="btn btn-primary"
              onClick={handleExecute}
              disabled={!confirmed || selectedIndices.size === 0 || !hasCreds}
            >
              Execute {selectedIndices.size} Change{selectedIndices.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Executing Phase */}
      {phase === 'executing' && progress && (
        <div className="bulk-executing-section">
          <h3>Executing Changes...</h3>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
            <span className="progress-text">
              {progress.current}/{progress.total} ({Math.round((progress.current / progress.total) * 100)}%)
            </span>
          </div>

          <div className="current-operation">
            {progress.isPaused ? (
              <span className="status-paused">⏸ Paused</span>
            ) : (
              <span>
                {progress.action === 'delete' ? '🗑️ Deleting' : progress.action === 'create' ? '➕ Creating' : '✏️ Updating'}:{' '}
                {progress.currentRecord} ({progress.action.toUpperCase()})
              </span>
            )}
          </div>

          <div className="execution-log">
            {progress.results.slice(-10).map((r, i) => (
              <div key={i} className={`log-entry log-${r.status}`}>
                {r.status === 'success' ? '✓' : r.status === 'failed' ? '✗' : '⏭'}{' '}
                {r.change.action}: {r.change.name || '@'} ({r.change.type})
                {r.error && <span className="log-error"> - {r.error}</span>}
              </div>
            ))}
          </div>

          <div className="execution-controls">
            <button className="btn btn-secondary" onClick={handlePause}>
              {progress.isPaused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-ghost" onClick={handleCancel}>
              Cancel Remaining
            </button>
          </div>
        </div>
      )}

      {/* Done Phase */}
      {phase === 'done' && summary && (
        <div className="bulk-done-section">
          <h3>Execution Complete</h3>

          <div className="results-summary">
            <div className="result-stat result-success">
              <span className="stat-value">{summary.success}</span>
              <span className="stat-label">Success</span>
            </div>
            <div className="result-stat result-failed">
              <span className="stat-value">{summary.failed}</span>
              <span className="stat-label">Failed</span>
            </div>
            <div className="result-stat result-skipped">
              <span className="stat-value">{summary.skipped}</span>
              <span className="stat-label">Skipped</span>
            </div>
          </div>

          {summary.failed > 0 && (
            <div className="failed-records">
              <h4>Failed Records</h4>
              <div className="table-container">
                <table className="record-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.results
                      .filter(r => r.status === 'failed')
                      .map((r, i) => (
                        <tr key={i}>
                          <td>{r.change.action}</td>
                          <td>{r.change.type}</td>
                          <td>{r.change.name || '@'}</td>
                          <td className="error-text">{r.error}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bulk-actions">
            <button className="btn btn-ghost" onClick={handleReset}>
              Start Over
            </button>
            <button className="btn btn-secondary" onClick={handleDownloadResults}>
              Download Results Log
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
