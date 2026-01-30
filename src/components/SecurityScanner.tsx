import { useState, useEffect, useCallback } from 'react';
import {
  ScanFinding,
  ScanRecord,
  ScanResult,
  ScanProgress,
  ApprovedList,
  analyzeARecords,
  analyzeCnameRecords,
  analyzeTxtRecords,
  loadApprovedList,
  saveApprovedList,
  saveScanResult,
  generateChangesetFromFindings,
} from '../utils/securityScanner';
import { downloadJson } from '../utils/changesetExecutor';
import { ConstellixCredentials as ConstellixCredsType, listRecords, getDomainId } from '../utils/constellixApi';
import { getConstellixCredentials, saveConstellixCredentials } from '../utils/userSettings';
import ConstellixCredentialsForm from './ConstellixCredentials';

type ScanPhase = 'input' | 'scanning' | 'results';

export default function SecurityScanner() {
  const [phase, setPhase] = useState<ScanPhase>('input');
  const [domain, setDomain] = useState('');
  const [domainId, setDomainId] = useState<number | null>(null);
  const [creds, setCreds] = useState<ConstellixCredsType>({ apiKey: '', secretKey: '' });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvedList, setApprovedList] = useState<ApprovedList>({
    approvedIPs: [],
    approvedHosts: [],
    approvedVerifications: [],
  });
  const [showApprovedEditor, setShowApprovedEditor] = useState(false);

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
        .then(success => setSaveStatus(success ? 'saved' : 'error'))
        .catch(() => setSaveStatus('error'));
    }
  }, [creds]);

  // Load approved list when domain changes
  useEffect(() => {
    if (domain) {
      const list = loadApprovedList(domain);
      setApprovedList(list);
    }
  }, [domain]);

  const handleScan = useCallback(async () => {
    if (!domain || !creds.apiKey || !creds.secretKey) return;

    setPhase('scanning');
    setError(null);
    setProgress({ phase: 'fetching', current: 0, total: 0, message: 'Looking up domain...' });

    try {
      // Get domain ID from Constellix
      const domainResult = await getDomainId(creds, domain);
      if (!domainResult.id) {
        setError(domainResult.error || 'Domain not found in Constellix');
        setPhase('input');
        return;
      }

      setDomainId(domainResult.id);
      setProgress({ phase: 'fetching', current: 0, total: 0, message: 'Fetching DNS records...' });

      // Fetch all records
      const { records: constellixRecords, error: listError } = await listRecords(creds, domainResult.id);
      if (listError) {
        setError(listError);
        setPhase('input');
        return;
      }

      // Convert to ScanRecords
      const scanRecords: ScanRecord[] = constellixRecords.map(r => ({
        recordId: r.id,
        name: r.name,
        type: r.type,
        value: r.value,
        ttl: r.ttl,
      }));

      const totalRecords = scanRecords.length;
      setProgress({ phase: 'analyzing', current: 0, total: totalRecords, message: 'Analyzing records...' });

      // Run analysis
      const findings: ScanFinding[] = [];

      // Analyze A/AAAA records
      const aFindings = await analyzeARecords(scanRecords, approvedList, (msg) => {
        setProgress(p => p ? { ...p, message: msg } : null);
      });
      findings.push(...aFindings);

      // Analyze CNAME records
      const cnameFindings = await analyzeCnameRecords(scanRecords, domain, (msg) => {
        setProgress(p => p ? { ...p, message: msg } : null);
      });
      findings.push(...cnameFindings);

      // Analyze TXT records
      const txtFindings = analyzeTxtRecords(scanRecords, approvedList);
      findings.push(...txtFindings);

      // Calculate summary
      const summary = {
        critical: findings.filter(f => f.severity === 'critical').length,
        warning: findings.filter(f => f.severity === 'warning').length,
        info: findings.filter(f => f.severity === 'info').length,
        ok: totalRecords - findings.reduce((acc, f) => acc + f.records.length, 0),
      };

      const scanResult: ScanResult = {
        domain,
        scannedAt: new Date().toISOString(),
        totalRecords,
        findings,
        summary,
      };

      setResult(scanResult);
      saveScanResult(scanResult);
      setProgress({ phase: 'done', current: totalRecords, total: totalRecords, message: 'Scan complete' });
      setPhase('results');

    } catch (err) {
      setError((err as Error).message);
      setPhase('input');
    }
  }, [domain, creds, approvedList]);

  const handleGenerateChangeset = () => {
    if (!result || !domainId) return;

    const changeset = generateChangesetFromFindings(domain, domainId, result.findings);
    downloadJson(changeset, `${domain}-security-changeset-${Date.now()}.json`);
  };

  const handleExportReport = () => {
    if (!result) return;

    const report = {
      ...result,
      exportedAt: new Date().toISOString(),
      exportFormat: 'ZoneShift Security Report v1',
    };
    downloadJson(report, `${domain}-security-report-${Date.now()}.json`);
  };

  const handleSaveApprovedList = () => {
    saveApprovedList(domain, approvedList);
    setShowApprovedEditor(false);
  };

  const handleReset = () => {
    setPhase('input');
    setResult(null);
    setDomainId(null);
    setProgress(null);
    setError(null);
  };

  const hasCreds = creds.apiKey && creds.secretKey;
  const criticalCount = result?.summary.critical || 0;
  const warningCount = result?.summary.warning || 0;

  return (
    <div className="security-scanner">
      <h2>DNS Security Scanner</h2>
      <p className="subtitle">Scan DNS zones for vulnerabilities, legacy hosting, and subdomain takeover risks</p>

      {/* Credentials */}
      <div className="scanner-creds">
        <ConstellixCredentialsForm
          apiKey={creds.apiKey}
          secretKey={creds.secretKey}
          onApiKeyChange={(v) => setCreds(c => ({ ...c, apiKey: v }))}
          onSecretKeyChange={(v) => setCreds(c => ({ ...c, secretKey: v }))}
        />
        {saveStatus === 'saved' && <span className="save-status save-status-saved">Credentials saved</span>}
        {saveStatus === 'error' && <span className="save-status save-status-error">Failed to save</span>}
      </div>

      {/* Input Phase */}
      {phase === 'input' && (
        <div className="scanner-input-section">
          <div className="scanner-domain-input">
            <label>Domain to Scan</label>
            <div className="input-row">
              <input
                type="text"
                placeholder="example.com"
                value={domain}
                onChange={e => setDomain(e.target.value.trim())}
                className="domain-input"
              />
              <button
                className="btn btn-primary"
                onClick={handleScan}
                disabled={!domain || !hasCreds}
              >
                Scan Domain
              </button>
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="approved-list-section">
            <div className="approved-header">
              <h3>Approved List</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowApprovedEditor(!showApprovedEditor)}
              >
                {showApprovedEditor ? 'Hide' : 'Edit'}
              </button>
            </div>

            {showApprovedEditor && (
              <div className="approved-editor">
                <div className="approved-field">
                  <label>Approved IPs (one per line)</label>
                  <textarea
                    value={approvedList.approvedIPs.join('\n')}
                    onChange={e => setApprovedList(l => ({
                      ...l,
                      approvedIPs: e.target.value.split('\n').filter(Boolean),
                    }))}
                    rows={4}
                    placeholder="104.251.211.118&#10;52.xxx.xxx.xxx"
                  />
                </div>
                <div className="approved-field">
                  <label>Approved Hosts (partial match, one per line)</label>
                  <textarea
                    value={approvedList.approvedHosts.join('\n')}
                    onChange={e => setApprovedList(l => ({
                      ...l,
                      approvedHosts: e.target.value.split('\n').filter(Boolean),
                    }))}
                    rows={4}
                    placeholder="azure&#10;cloudflare&#10;constellix"
                  />
                </div>
                <div className="approved-field">
                  <label>Approved Verification Tokens</label>
                  <textarea
                    value={approvedList.approvedVerifications.join('\n')}
                    onChange={e => setApprovedList(l => ({
                      ...l,
                      approvedVerifications: e.target.value.split('\n').filter(Boolean),
                    }))}
                    rows={4}
                    placeholder="CCy-1rX8ytbH5P1neWhIdp8oB80pXIl0iqqhDKa01z8"
                  />
                </div>
                <button className="btn btn-secondary" onClick={handleSaveApprovedList}>
                  Save Approved List
                </button>
              </div>
            )}

            {!showApprovedEditor && (
              <p className="muted">
                {approvedList.approvedIPs.length} IPs, {approvedList.approvedHosts.length} hosts, {approvedList.approvedVerifications.length} verifications approved
              </p>
            )}
          </div>
        </div>
      )}

      {/* Scanning Phase */}
      {phase === 'scanning' && progress && (
        <div className="scanner-progress-section">
          <h3>Scanning {domain}...</h3>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: progress.phase === 'done' ? '100%' : '50%' }}
            />
            <span className="progress-text">{progress.message}</span>
          </div>
        </div>
      )}

      {/* Results Phase */}
      {phase === 'results' && result && (
        <div className="scanner-results-section">
          <div className="scan-summary-header">
            <h3>Scan Results: {result.domain}</h3>
            <span className="muted">
              Scanned {new Date(result.scannedAt).toLocaleString()} · {result.totalRecords} records
            </span>
          </div>

          <div className="scan-summary-stats">
            <div className={`scan-stat ${criticalCount > 0 ? 'scan-stat-critical' : ''}`}>
              <span className="stat-value">{result.summary.critical}</span>
              <span className="stat-label">Critical</span>
            </div>
            <div className={`scan-stat ${warningCount > 0 ? 'scan-stat-warning' : ''}`}>
              <span className="stat-value">{result.summary.warning}</span>
              <span className="stat-label">Warning</span>
            </div>
            <div className="scan-stat scan-stat-ok">
              <span className="stat-value">{result.summary.ok}</span>
              <span className="stat-label">OK</span>
            </div>
          </div>

          {result.findings.length > 0 && (
            <div className="findings-section">
              <h4>Findings</h4>
              <div className="findings-list">
                {result.findings.map(finding => (
                  <div key={finding.id} className={`finding-card finding-${finding.severity}`}>
                    <div className="finding-header">
                      <span className={`severity-badge severity-${finding.severity}`}>
                        {finding.severity.toUpperCase()}
                      </span>
                      <span className="finding-type">{finding.type.replace('_', ' ')}</span>
                    </div>
                    <p className="finding-issue">{finding.issue}</p>
                    <p className="finding-recommendation">{finding.recommendation}</p>

                    {finding.records.length > 0 && (
                      <details className="finding-records">
                        <summary>
                          {finding.records.length} record{finding.records.length !== 1 ? 's' : ''} affected
                        </summary>
                        <div className="table-container">
                          <table className="record-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Value</th>
                                {finding.type === 'LEGACY_HOSTING' && <th>Provider</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {finding.records.slice(0, 10).map((r, i) => (
                                <tr key={i}>
                                  <td>{r.name || '@'}</td>
                                  <td><span className={`badge badge-${r.type.toLowerCase()}`}>{r.type}</span></td>
                                  <td className="value-cell">{r.value}</td>
                                  {finding.type === 'LEGACY_HOSTING' && <td>{r.provider}</td>}
                                </tr>
                              ))}
                              {finding.records.length > 10 && (
                                <tr>
                                  <td colSpan={4} className="muted">
                                    ... and {finding.records.length - 10} more
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.findings.length === 0 && (
            <div className="no-findings">
              <span className="success-icon">✓</span>
              <p>No security issues found!</p>
            </div>
          )}

          <div className="scanner-actions">
            <button className="btn btn-ghost" onClick={handleReset}>
              Scan Another Domain
            </button>
            <button className="btn btn-secondary" onClick={handleExportReport}>
              Export Report
            </button>
            {criticalCount > 0 && (
              <button className="btn btn-primary" onClick={handleGenerateChangeset}>
                Generate Remediation Changeset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
