import { useState, useCallback, useMemo } from 'react';
import {
  SourceConfig,
  SourcedRecord,
  queryMultipleSources,
} from '../utils/dnsLookup';
import { parseZoneFile, DnsRecord, formatForConstellix } from '../utils/zoneParser';
import { pushAllRecords, PushProgress, PushError } from '../utils/constellixApi';
import { getConstellixCredentials } from '../utils/userSettings';

const SOURCE_COLORS = [
  '#f97316', // orange
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#10b981', // emerald
  '#f59e0b', // amber
  '#6366f1', // indigo
  '#14b8a6', // teal
];

const CONSTELLIX_COLOR = '#3b82f6'; // blue

const DEFAULT_SUBDOMAINS = [
  '@', 'www', 'mail', 'ftp', 'cpanel', 'webmail', 'webdisk', 'whm',
  'autodiscover', 'autoconfig', 'enterpriseenrollment', 'enterpriseregistration',
  'selector1._domainkey', 'selector2._domainkey', '_dmarc',
];

const QUERY_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'];

const FILTER_TYPES = ['All', 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

let sourceCounter = 0;
function nextSourceId() {
  return `src-${++sourceCounter}`;
}

function makeDefaultSources(): SourceConfig[] {
  return [
    {
      id: nextSourceId(),
      label: 'Old NS',
      hostname: '',
      color: SOURCE_COLORS[0],
    },
    {
      id: nextSourceId(),
      label: 'Constellix',
      hostname: 'ns11.constellix.com',
      color: CONSTELLIX_COLOR,
    },
  ];
}

interface ScannedRecord extends SourcedRecord {
  selected: boolean;
  relativeName: string; // @, www, mail, etc.
}

type PushPhase = 'idle' | 'creating_domain' | 'pushing_records' | 'done' | 'error';

export default function MigrateView() {
  // Section A: Domain & Sources
  const [domain, setDomain] = useState('');
  const [sources, setSources] = useState<SourceConfig[]>(makeDefaultSources);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, label: '' });
  const [scanError, setScanError] = useState('');

  // Section B: Records
  const [records, setRecords] = useState<ScannedRecord[]>([]);
  const [hasScanned, setHasScanned] = useState(false);

  // Filters
  const [nameFilter, setNameFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');

  // Zone file import
  const [showZoneImport, setShowZoneImport] = useState(false);
  const [zoneText, setZoneText] = useState('');
  const [zoneImportMsg, setZoneImportMsg] = useState('');

  // Section C: Push
  const [pushPhase, setPushPhase] = useState<PushPhase>('idle');
  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null);

  // Convert FQDN to relative name for display
  const toRelativeName = useCallback((fqdn: string) => {
    const clean = fqdn.replace(/\.$/, '').toLowerCase();
    const domainLower = domain.toLowerCase();
    if (clean === domainLower) return '@';
    if (clean.endsWith('.' + domainLower)) {
      return clean.slice(0, -(domainLower.length + 1));
    }
    return clean;
  }, [domain]);

  // Find the Constellix source ID
  const constellixSourceId = useMemo(() => {
    return sources.find(s =>
      s.hostname.toLowerCase().includes('constellix')
    )?.id;
  }, [sources]);

  // Source management
  function addSource() {
    const colorIdx = sources.length % SOURCE_COLORS.length;
    setSources([
      ...sources,
      {
        id: nextSourceId(),
        label: '',
        hostname: '',
        color: SOURCE_COLORS[colorIdx],
      },
    ]);
  }

  function removeSource(id: string) {
    setSources(sources.filter(s => s.id !== id));
  }

  function updateSource(id: string, field: 'label' | 'hostname', value: string) {
    setSources(sources.map(s => s.id === id ? { ...s, [field]: value } : s));
  }

  // Scan all sources
  async function handleScan() {
    const trimmedDomain = domain.trim().replace(/\.$/, '');
    if (!trimmedDomain) return;

    const activeSources = sources.filter(s => s.hostname.trim());
    if (activeSources.length === 0) {
      setScanError('Add at least one nameserver to scan.');
      return;
    }

    setScanning(true);
    setScanError('');
    setScanProgress({ done: 0, total: 0, label: '' });

    try {
      const sourcedRecords = await queryMultipleSources(
        activeSources,
        trimmedDomain,
        DEFAULT_SUBDOMAINS,
        QUERY_TYPES,
        (done, total, label) => {
          setScanProgress({ done, total, label });
        },
      );

      // Convert to ScannedRecords with relative names and selection state
      const activeSourceCount = activeSources.length;
      const scanned: ScannedRecord[] = sourcedRecords.map(r => {
        const relativeName = toRelativeName(r.name);
        // Only pre-select records found on ALL scanned sources
        const onAllSources = r.sources.length >= activeSourceCount;
        return {
          ...r,
          relativeName,
          selected: onAllSources,
        };
      });

      setRecords(scanned);
      setHasScanned(true);
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  // Zone file import
  function handleZoneImport() {
    if (!zoneText.trim()) return;
    try {
      const parsed = parseZoneFile(zoneText);
      if (parsed.records.length === 0) {
        setZoneImportMsg('No records found in zone file.');
        return;
      }

      // If domain is empty, set it from the zone file origin
      if (!domain && parsed.origin) {
        setDomain(parsed.origin);
      }

      // Convert DnsRecords to ScannedRecords with a "Zone File" source
      const zoneSourceId = 'zone-file';
      const zoneRecords: ScannedRecord[] = parsed.records.map(r => ({
        name: r.name === '@' && parsed.origin ? parsed.origin : r.name.includes('.') ? r.name : `${r.name}.${parsed.origin || domain}`,
        type: r.type,
        value: r.value,
        ttl: r.ttl,
        sources: [zoneSourceId],
        selected: true,
        relativeName: r.name,
      }));

      // Merge with existing records
      const existing = new Map<string, ScannedRecord>();
      for (const rec of records) {
        const key = `${rec.relativeName.toLowerCase()}|${rec.type}|${rec.value.toLowerCase().trim()}`;
        existing.set(key, rec);
      }

      let added = 0;
      for (const zr of zoneRecords) {
        const key = `${zr.relativeName.toLowerCase()}|${zr.type}|${zr.value.toLowerCase().trim()}`;
        if (existing.has(key)) {
          const ex = existing.get(key)!;
          if (!ex.sources.includes(zoneSourceId)) {
            ex.sources.push(zoneSourceId);
          }
        } else {
          existing.set(key, zr);
          added++;
        }
      }

      setRecords([...existing.values()]);
      setHasScanned(true);
      setZoneImportMsg(`Imported ${added} new records from zone file (${parsed.records.length} total parsed).`);
      setShowZoneImport(false);
    } catch (err) {
      setZoneImportMsg(`Parse error: ${(err as Error).message}`);
    }
  }

  // Record selection
  function toggleRecord(index: number) {
    setRecords(prev => prev.map((r, i) => i === index ? { ...r, selected: !r.selected } : r));
  }

  function selectAllVisible() {
    const visibleIndices = new Set(filtered.map(r => records.indexOf(r)));
    setRecords(prev => prev.map((r, i) => visibleIndices.has(i) ? { ...r, selected: true } : r));
  }

  function deselectAll() {
    const visibleIndices = new Set(filtered.map(r => records.indexOf(r)));
    setRecords(prev => prev.map((r, i) => visibleIndices.has(i) ? { ...r, selected: false } : r));
  }

  // Filtered records
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (typeFilter !== 'All' && r.type !== typeFilter) return false;
      if (sourceFilter !== 'All' && !r.sources.includes(sourceFilter)) return false;
      if (nameFilter) {
        const search = nameFilter.toLowerCase();
        return r.relativeName.toLowerCase().includes(search) ||
               r.value.toLowerCase().includes(search);
      }
      return true;
    });
  }, [records, typeFilter, sourceFilter, nameFilter]);

  const selectedCount = records.filter(r => r.selected).length;

  // Get source config by ID
  const sourceMap = useMemo(() => {
    const map = new Map<string, SourceConfig>();
    for (const s of sources) {
      map.set(s.id, s);
    }
    // Add zone-file pseudo-source
    map.set('zone-file', { id: 'zone-file', label: 'Zone File', hostname: '', color: '#94a3b8' });
    return map;
  }, [sources]);

  // Push to Constellix
  async function handlePush() {
    const creds = await getConstellixCredentials();
    if (!creds) {
      setScanError('No Constellix credentials configured. Go to Settings to add your API keys.');
      return;
    }

    const selectedRecords = records.filter(r => r.selected);
    if (selectedRecords.length === 0) return;

    // Convert ScannedRecords to DnsRecords for the push API
    const dnsRecords: DnsRecord[] = selectedRecords.map(r => ({
      name: r.relativeName,
      ttl: r.ttl,
      class: 'IN',
      type: r.type,
      value: r.value,
    }));

    setPushPhase('creating_domain');
    setPushProgress(null);

    await pushAllRecords(
      creds,
      domain.trim().replace(/\.$/, ''),
      dnsRecords,
      (p) => {
        setPushProgress(p);
        setPushPhase(p.phase as PushPhase);
      },
    );
  }

  // Export as zone file
  function handleExport() {
    const selectedRecords = records.filter(r => r.selected);
    const dnsRecords: DnsRecord[] = selectedRecords.map(r => ({
      name: r.relativeName,
      ttl: r.ttl,
      class: 'IN',
      type: r.type,
      value: r.value,
    }));

    const output = formatForConstellix({
      origin: domain.trim().replace(/\.$/, ''),
      records: dnsRecords,
    });

    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${domain.trim()}-zone-export.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pushBusy = pushPhase === 'creating_domain' || pushPhase === 'pushing_records';

  return (
    <div className="migrate-view">
      {/* Section A: Domain & Sources */}
      <div className="migrate-sources-card">
        <h2>DNS Migration</h2>
        <p className="subtitle">
          Enter a domain and the nameservers you want to scan. Records from all sources are merged into a single curation view.
        </p>

        <div className="migrate-domain-row">
          <div className="form-field" style={{ flex: 2 }}>
            <label>Domain</label>
            <input
              type="text"
              placeholder="example.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              disabled={scanning}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Nameserver Sources
          </label>
          {sources.map(source => (
            <div key={source.id} className="source-row">
              <span className="source-color-dot" style={{ background: source.color }} />
              <div className="form-field" style={{ flex: 1 }}>
                <input
                  type="text"
                  placeholder="Label (e.g., Old Registrar)"
                  value={source.label}
                  onChange={e => updateSource(source.id, 'label', e.target.value)}
                  disabled={scanning}
                />
              </div>
              <div className="form-field" style={{ flex: 2 }}>
                <input
                  type="text"
                  placeholder="Nameserver hostname (e.g., ns65.worldnic.com)"
                  value={source.hostname}
                  onChange={e => updateSource(source.id, 'hostname', e.target.value)}
                  disabled={scanning}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
              {sources.length > 1 && (
                <button
                  className="source-remove-btn"
                  onClick={() => removeSource(source.id)}
                  disabled={scanning}
                  title="Remove source"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="migrate-actions">
          <button className="btn btn-ghost btn-sm" onClick={addSource} disabled={scanning}>
            + Add Source
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            onClick={handleScan}
            disabled={scanning || !domain.trim()}
          >
            {scanning ? 'Scanning...' : 'Scan All Sources'}
          </button>
        </div>

        {scanning && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: scanProgress.total ? `${(scanProgress.done / scanProgress.total) * 100}%` : '0%' }}
            />
            <span className="progress-text">
              {scanProgress.label && `${scanProgress.label} — `}
              {scanProgress.done}/{scanProgress.total} queries
            </span>
          </div>
        )}

        {scanError && <p className="error-text">{scanError}</p>}
        {zoneImportMsg && <p className={zoneImportMsg.startsWith('Parse') ? 'error-text' : 'success-text'}>{zoneImportMsg}</p>}

        {/* Zone File Import (collapsible) */}
        <div className="zone-import-section">
          <button
            className="zone-import-toggle"
            onClick={() => setShowZoneImport(!showZoneImport)}
          >
            {showZoneImport ? '▾' : '▸'} Import Zone File
          </button>
          {showZoneImport && (
            <div className="zone-import-body">
              <textarea
                className="zone-textarea"
                rows={8}
                placeholder="Paste BIND zone file or cPanel export here..."
                value={zoneText}
                onChange={e => setZoneText(e.target.value)}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleZoneImport}
                disabled={!zoneText.trim()}
              >
                Parse & Import
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Section B: Record Curation Table */}
      {hasScanned && (
        <div className="curation-card">
          <h3>Record Curation</h3>

          {/* Toolbar */}
          <div className="curation-toolbar">
            <input
              type="text"
              placeholder="Search by name or value..."
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              className="filter-input"
            />
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="filter-select"
            >
              {FILTER_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="filter-select"
            >
              <option value="All">All Sources</option>
              {sources.filter(s => s.hostname.trim()).map(s => (
                <option key={s.id} value={s.id}>{s.label || s.hostname}</option>
              ))}
              {records.some(r => r.sources.includes('zone-file')) && (
                <option value="zone-file">Zone File</option>
              )}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={selectAllVisible}>Select Visible</button>
            <button className="btn btn-ghost btn-sm" onClick={deselectAll}>Deselect</button>
            <span className="curation-count">
              {selectedCount} of {records.length} selected
            </span>
          </div>

          {/* Table */}
          <div className="table-container">
            <table className="curation-table">
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => r.selected)}
                      onChange={() => {
                        if (filtered.every(r => r.selected)) {
                          deselectAll();
                        } else {
                          selectAllVisible();
                        }
                      }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>TTL</th>
                  <th>Sources</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => {
                  const globalIndex = records.indexOf(rec);
                  const isOnConstellix = constellixSourceId && rec.sources.includes(constellixSourceId);
                  return (
                    <tr
                      key={`${rec.relativeName}-${rec.type}-${rec.value}`}
                      className={`${!rec.selected ? 'curation-row-unchecked' : ''} ${isOnConstellix ? 'curation-row-constellix' : ''}`}
                    >
                      <td className="checkbox-cell">
                        <input
                          type="checkbox"
                          checked={rec.selected}
                          onChange={() => toggleRecord(globalIndex)}
                        />
                      </td>
                      <td className="curation-name">{rec.relativeName}</td>
                      <td>
                        <span className={`badge badge-${rec.type.toLowerCase()}`}>{rec.type}</span>
                      </td>
                      <td className="curation-value" title={rec.value}>{rec.value}</td>
                      <td className="curation-ttl">{rec.ttl}</td>
                      <td className="curation-sources">
                        {rec.sources.map(sid => {
                          const src = sourceMap.get(sid);
                          if (!src) return null;
                          const shortLabel = src.label || src.hostname.split('.')[0];
                          return (
                            <span
                              key={sid}
                              className="source-pill"
                              style={{ background: `${src.color}20`, color: src.color }}
                            >
                              <span className="source-dot" style={{ background: src.color }} />
                              {shortLabel}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
              No records match your filters.
            </p>
          )}
        </div>
      )}

      {/* Section C: Actions */}
      {hasScanned && records.length > 0 && (
        <div className="migrate-actions-card">
          <button
            className="btn btn-primary"
            onClick={handlePush}
            disabled={pushBusy || selectedCount === 0}
          >
            {pushBusy ? 'Pushing...' : `Push ${selectedCount} Records to Constellix`}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={selectedCount === 0}
          >
            Export as Zone File
          </button>
          <div style={{ flex: 1 }} />
          {selectedCount === 0 && (
            <span className="muted">Select records to enable actions</span>
          )}
        </div>
      )}

      {/* Push Progress / Results */}
      {pushBusy && pushProgress && (
        <div className="card">
          <div className="push-progress">
            <div className="phase-indicator">
              <span className={`phase-dot phase-${pushPhase}`} />
              <span>
                {pushPhase === 'creating_domain' && 'Creating domain...'}
                {pushPhase === 'pushing_records' && 'Pushing records...'}
              </span>
            </div>
            {pushProgress.total > 0 && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(pushProgress.current / pushProgress.total) * 100}%` }}
                />
                <span className="progress-text">
                  {pushProgress.message} ({pushProgress.current}/{pushProgress.total})
                </span>
              </div>
            )}
            {pushProgress.total === 0 && (
              <p className="muted">{pushProgress.message}</p>
            )}
          </div>
        </div>
      )}

      {pushPhase === 'done' && pushProgress && (
        <div className="card">
          <div className={`summary ${pushProgress.errors.length === 0 ? 'summary-success' : 'summary-warning'}`}>
            {pushProgress.errors.length === 0 ? (
              <span>All {pushProgress.successes} records pushed successfully.</span>
            ) : (
              <span>{pushProgress.successes} succeeded, {pushProgress.errors.length} failed</span>
            )}
          </div>
          {pushProgress.errors.length > 0 && (
            <PushErrorTable errors={pushProgress.errors} />
          )}
        </div>
      )}

      {pushPhase === 'error' && pushProgress && (
        <div className="card">
          <p className="error-text">{pushProgress.message}</p>
          {pushProgress.errors.length > 0 && (
            <PushErrorTable errors={pushProgress.errors} />
          )}
        </div>
      )}
    </div>
  );
}

function PushErrorTable({ errors }: { errors: PushError[] }) {
  return (
    <div className="table-container" style={{ marginTop: '0.75rem' }}>
      <table className="record-table">
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
                <span className={`badge badge-${err.type.toLowerCase()}`}>{err.type}</span>
              </td>
              <td className="value-cell error-text">{err.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
