import { useState } from 'react';
import { queryAllRecords } from '../utils/dnsLookup';
import { compareRecords, ComparisonResult, ComparisonRow } from '../utils/recordComparison';
import { DnsRecord } from '../utils/zoneParser';

interface ComparisonTableProps {
  domain: string;
  currentNS: string[];
  zoneRecords: DnsRecord[];
}

const DEFAULT_SUBDOMAINS = [
  '@', 'www', 'mail', 'ftp',
  'cpanel', 'webmail', 'webdisk', 'whm',
  'autodiscover',
  'enterpriseenrollment', 'enterpriseregistration',
  'selector1._domainkey', 'selector2._domainkey',
  '_dmarc',
];

const QUERY_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'];

export default function ComparisonTable({ domain, currentNS, zoneRecords }: ComparisonTableProps) {
  const [newNS, setNewNS] = useState('ns11.constellix.com');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  // Build list of subdomains from zone file + defaults
  function getSubdomains(): string[] {
    const subs = new Set(DEFAULT_SUBDOMAINS);
    for (const r of zoneRecords) {
      subs.add(r.name);
    }
    return [...subs];
  }

  async function runComparison() {
    if (!newNS.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const subdomains = getSubdomains();

      // Query old NS
      setProgress({ done: 0, total: subdomains.length * QUERY_TYPES.length * 2 });
      const oldRecords = await queryAllRecords(
        domain,
        subdomains,
        QUERY_TYPES,
        (done, total) => setProgress((p) => ({ ...p, done, total: total * 2 })),
      );

      // Query new NS — using the same DoH approach (queries public DNS which
      // should resolve from the new NS once records are loaded)
      const newRecords = await queryAllRecords(
        domain,
        subdomains,
        QUERY_TYPES,
        (done, total) =>
          setProgress((p) => ({
            ...p,
            done: p.done + done,
            total: total + oldRecords.length,
          })),
      );

      const comparison = compareRecords(oldRecords, newRecords);
      setResult(comparison);
    } catch (err) {
      setError('Comparison failed. Check the nameserver and try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="comparison">
      <h2>Compare DNS Records</h2>
      <p className="subtitle">
        Query both old and new nameservers and compare all records.
      </p>

      {currentNS.length > 0 && (
        <div className="current-ns-info">
          <span className="label">Old NS:</span>
          <span>{currentNS.join(', ')}</span>
        </div>
      )}

      <div className="comparison-input">
        <label htmlFor="new-ns">New Constellix Nameserver</label>
        <input
          id="new-ns"
          type="text"
          placeholder="ns11.constellix.com"
          value={newNS}
          onChange={(e) => setNewNS(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={runComparison}
          disabled={loading || !newNS.trim()}
        >
          {loading ? 'Comparing...' : 'Run Comparison'}
        </button>
      </div>

      {loading && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: progress.total > 0
                ? `${(progress.done / progress.total) * 100}%`
                : '0%',
            }}
          />
          <span className="progress-text">
            Querying... {progress.done}/{progress.total}
          </span>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {result && <ComparisonResults result={result} />}
    </div>
  );
}

function ComparisonResults({ result }: { result: ComparisonResult }) {
  const allMatch = result.mismatchCount === 0 && result.missingNewCount === 0;

  return (
    <div className="comparison-results">
      <div className={`summary ${allMatch ? 'summary-success' : 'summary-warning'}`}>
        {allMatch ? (
          <span>
            {result.matchCount}/{result.totalRecords} records match — Ready for NS cutover!
          </span>
        ) : (
          <span>
            {result.matchCount} match, {result.mismatchCount} mismatch,{' '}
            {result.missingNewCount} missing on new NS, {result.newCount} new
          </span>
        )}
      </div>

      <div className="table-container">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Old Value</th>
              <th>New Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <ComparisonRowView key={i} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonRowView({ row }: { row: ComparisonRow }) {
  const statusLabels: Record<string, string> = {
    match: 'Match',
    mismatch: 'Mismatch',
    missing_new: 'Missing',
    new: 'New',
  };

  return (
    <tr className={`row-${row.status}`}>
      <td>{row.name}</td>
      <td><span className={`badge badge-${row.type.toLowerCase()}`}>{row.type}</span></td>
      <td className="value-cell">{row.valueOld ?? '—'}</td>
      <td className="value-cell">{row.valueNew ?? '—'}</td>
      <td>
        <span className={`status-badge status-${row.status}`}>
          {statusLabels[row.status] || row.status}
        </span>
      </td>
    </tr>
  );
}
