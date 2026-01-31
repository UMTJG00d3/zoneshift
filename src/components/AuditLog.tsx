import { useState, useEffect } from 'react';

interface AuditLogEntry {
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  details: string;
  ip: string;
  success: boolean;
  errorMessage?: string;
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Date range filter (default: last 7 days)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterSuccess, setFilterSuccess] = useState<'all' | 'success' | 'failed'>('all');

  useEffect(() => {
    loadLogs();
  }, [startDate, endDate]);

  async function loadLogs() {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(
        `/api/audit?startDate=${startDate}&endDate=${endDate}&limit=500`,
        { credentials: 'include' }
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Apply client-side filters
  const filteredLogs = logs.filter(log => {
    if (filterUser && !log.userEmail.toLowerCase().includes(filterUser.toLowerCase())) {
      return false;
    }
    if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) {
      return false;
    }
    if (filterSuccess === 'success' && !log.success) return false;
    if (filterSuccess === 'failed' && log.success) return false;
    return true;
  });

  // Get unique users for quick filter
  const uniqueUsers = [...new Set(logs.map(l => l.userEmail))].sort();

  function formatTimestamp(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function exportLogs() {
    const csv = [
      ['Timestamp', 'User', 'Action', 'Resource', 'Details', 'IP', 'Success', 'Error'].join(','),
      ...filteredLogs.map(log => [
        log.timestamp,
        `"${log.userEmail}"`,
        `"${log.action}"`,
        `"${log.resource}"`,
        `"${log.details.replace(/"/g, '""')}"`,
        log.ip,
        log.success,
        `"${log.errorMessage || ''}"`,
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zoneshift-audit-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="audit-log">
      <h2>Audit Log</h2>
      <p className="subtitle">View all Constellix API activity</p>

      {/* Date Range */}
      <div className="audit-controls">
        <div className="audit-date-range">
          <div className="form-field">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={loadLogs} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div className="audit-filters">
          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            className="filter-select"
          >
            <option value="">All Users</option>
            {uniqueUsers.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter action..."
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="filter-input"
          />
          <select
            value={filterSuccess}
            onChange={e => setFilterSuccess(e.target.value as 'all' | 'success' | 'failed')}
            className="filter-select"
          >
            <option value="all">All Results</option>
            <option value="success">Success Only</option>
            <option value="failed">Failed Only</option>
          </select>
        </div>

        <button className="btn btn-ghost" onClick={exportLogs} disabled={filteredLogs.length === 0}>
          Export CSV
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* Stats */}
      <div className="audit-stats">
        <span className="audit-stat">
          <strong>{filteredLogs.length}</strong> entries
        </span>
        <span className="audit-stat audit-stat-success">
          <strong>{filteredLogs.filter(l => l.success).length}</strong> success
        </span>
        <span className="audit-stat audit-stat-failed">
          <strong>{filteredLogs.filter(l => !l.success).length}</strong> failed
        </span>
      </div>

      {/* Log Table */}
      {loading && logs.length === 0 && <p className="muted">Loading audit logs...</p>}

      {!loading && logs.length === 0 && !error && (
        <p className="muted">No audit logs found for this date range.</p>
      )}

      {filteredLogs.length > 0 && (
        <div className="table-container">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Status</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, i) => (
                <tr key={i} className={log.success ? '' : 'row-failed'}>
                  <td className="timestamp-cell">{formatTimestamp(log.timestamp)}</td>
                  <td className="user-cell">{log.userEmail}</td>
                  <td className="action-cell">{log.action}</td>
                  <td className="resource-cell">{log.resource}</td>
                  <td>
                    {log.success ? (
                      <span className="status-badge status-success">OK</span>
                    ) : (
                      <span className="status-badge status-failed" title={log.errorMessage}>
                        FAIL
                      </span>
                    )}
                  </td>
                  <td className="ip-cell">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
