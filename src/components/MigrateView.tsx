import { useState, useCallback, useMemo } from 'react';
import {
  SourceConfig,
  SourcedRecord,
  queryMultipleSources,
} from '../utils/dnsLookup';
import { parseZoneFile, DnsRecord, formatForConstellix } from '../utils/zoneParser';
import {
  ConstellixRecord,
  PushError,
  getDomainId,
  createDomain,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
} from '../utils/constellixApi';
import { mapRecordsForConstellix } from '../utils/constellixRecordMapper';
import { getConstellixCredentials } from '../utils/userSettings';
import { normalizeValue } from '../utils/recordComparison';

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
  relativeName: string;
}

// Push plan types
type PlanAction = 'create' | 'update' | 'skip' | 'delete';

interface PlanItem {
  action: PlanAction;
  name: string;
  type: string;
  value: string;
  ttl: number;
  // For updates: the existing Constellix record to update
  existingRecord?: ConstellixRecord;
  // For deletes: the orphaned Constellix record
  orphanRecord?: ConstellixRecord;
  // Whether user wants to include this delete
  includeDelete?: boolean;
}

type PushPhase = 'idle' | 'reviewing' | 'executing' | 'done' | 'error';

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

  // Section C: Push plan
  const [pushPhase, setPushPhase] = useState<PushPhase>('idle');
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [showOrphans, setShowOrphans] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  // Execution state
  const [execProgress, setExecProgress] = useState({ current: 0, total: 0, message: '' });
  const [execErrors, setExecErrors] = useState<PushError[]>([]);
  const [execSuccesses, setExecSuccesses] = useState(0);

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
    // Reset push state on rescan
    setPushPhase('idle');
    setPlanItems([]);

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

      // Identify which sources are Constellix (to exclude Constellix-only records)
      const constellixIds = new Set(
        activeSources
          .filter(s => s.hostname.toLowerCase().includes('constellix'))
          .map(s => s.id),
      );
      const nonConstellixSourceCount = activeSources.filter(
        s => !s.hostname.toLowerCase().includes('constellix'),
      ).length;

      // Filter out records only found on Constellix — they're already migrated
      const relevantRecords = constellixIds.size > 0
        ? sourcedRecords.filter(r => r.sources.some(sid => !constellixIds.has(sid)))
        : sourcedRecords;

      const scanned: ScannedRecord[] = relevantRecords.map(r => {
        const relativeName = toRelativeName(r.name);
        // Pre-select records found on all non-Constellix sources
        const nonConstellixSources = r.sources.filter(sid => !constellixIds.has(sid));
        const onAllNonConstellix = nonConstellixSourceCount > 0
          ? nonConstellixSources.length >= nonConstellixSourceCount
          : r.sources.length >= activeSources.length;
        return {
          ...r,
          relativeName,
          selected: onAllNonConstellix,
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

      if (!domain && parsed.origin) {
        setDomain(parsed.origin);
      }

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
    map.set('zone-file', { id: 'zone-file', label: 'Zone File', hostname: '', color: '#94a3b8' });
    return map;
  }, [sources]);

  // ========================
  // PUSH PLAN: Build review
  // ========================
  async function handleReviewPush() {
    const creds = await getConstellixCredentials();
    if (!creds) {
      setPlanError('No Constellix credentials configured. Go to Settings to add your API keys.');
      return;
    }

    setPlanLoading(true);
    setPlanError('');
    setPlanItems([]);
    setShowOrphans(false);

    const trimmedDomain = domain.trim().replace(/\.$/, '');

    try {
      // Get or create domain in Constellix
      let domainId: number | null = null;
      const domainRes = await getDomainId(creds, trimmedDomain);
      if (domainRes.id) {
        domainId = domainRes.id;
      }
      // If domain doesn't exist yet, everything is a create
      // (domain will be created at execute time)

      // Fetch existing Constellix records
      let existingRecords: ConstellixRecord[] = [];
      if (domainId) {
        const listRes = await listRecords(creds, domainId);
        if (listRes.error) {
          setPlanError(`Failed to fetch existing records: ${listRes.error}`);
          setPlanLoading(false);
          return;
        }
        existingRecords = listRes.records;
      }

      // Build lookup of existing records by normalized name|type|value
      const existingByKey = new Map<string, ConstellixRecord>();
      // Also track by name|type for update matching
      const existingByNameType = new Map<string, ConstellixRecord[]>();

      for (const rec of existingRecords) {
        const normName = (rec.name || '@').toLowerCase();
        const normType = rec.type.toUpperCase();

        // For value matching — Constellix returns values in various forms
        // Multi-value roundRobin records have comma-separated values
        const values = rec.value.split(', ').map(v => normalizeValue(v));
        for (const v of values) {
          const key = `${normName}|${normType}|${v}`;
          existingByKey.set(key, rec);
        }

        const ntKey = `${normName}|${normType}`;
        if (!existingByNameType.has(ntKey)) existingByNameType.set(ntKey, []);
        existingByNameType.get(ntKey)!.push(rec);
      }

      // Diff selected records against existing
      const plan: PlanItem[] = [];
      const matchedExistingIds = new Set<string>(); // track which existing records we matched

      const selectedRecords = records.filter(r => r.selected);

      for (const rec of selectedRecords) {
        const normName = rec.relativeName.toLowerCase();
        const normType = rec.type.toUpperCase();
        const normVal = normalizeValue(rec.value);
        const exactKey = `${normName}|${normType}|${normVal}`;

        if (existingByKey.has(exactKey)) {
          // Exact match — skip (already there)
          const existing = existingByKey.get(exactKey)!;
          matchedExistingIds.add(`${existing.type}-${existing.id}`);
          plan.push({
            action: 'skip',
            name: rec.relativeName,
            type: rec.type,
            value: rec.value,
            ttl: rec.ttl,
            existingRecord: existing,
          });
        } else {
          // Check if same name+type exists with different value
          const ntKey = `${normName}|${normType}`;
          const sameNameType = existingByNameType.get(ntKey);

          if (sameNameType && sameNameType.length > 0) {
            // Same name+type exists with different value — update
            const existing = sameNameType[0];
            matchedExistingIds.add(`${existing.type}-${existing.id}`);
            plan.push({
              action: 'update',
              name: rec.relativeName,
              type: rec.type,
              value: rec.value,
              ttl: rec.ttl,
              existingRecord: existing,
            });
          } else {
            // Doesn't exist at all — create
            plan.push({
              action: 'create',
              name: rec.relativeName,
              type: rec.type,
              value: rec.value,
              ttl: rec.ttl,
            });
          }
        }
      }

      // Find orphans: records in Constellix that we didn't match to any selected record
      for (const rec of existingRecords) {
        const key = `${rec.type}-${rec.id}`;
        if (!matchedExistingIds.has(key)) {
          plan.push({
            action: 'delete',
            name: rec.name || '@',
            type: rec.type,
            value: rec.value,
            ttl: rec.ttl,
            orphanRecord: rec,
            includeDelete: false, // unchecked by default
          });
        }
      }

      // Sort: creates first, then updates, then skips, then deletes
      const actionOrder: Record<PlanAction, number> = { create: 0, update: 1, skip: 2, delete: 3 };
      plan.sort((a, b) => {
        const orderDiff = actionOrder[a.action] - actionOrder[b.action];
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
      });

      setPlanItems(plan);
      setPushPhase('reviewing');
    } catch (err) {
      setPlanError((err as Error).message);
    } finally {
      setPlanLoading(false);
    }
  }

  // Toggle orphan deletion
  function toggleOrphanDelete(index: number) {
    setPlanItems(prev => prev.map((item, i) =>
      i === index && item.action === 'delete'
        ? { ...item, includeDelete: !item.includeDelete }
        : item
    ));
  }

  // Plan stats
  const planStats = useMemo(() => {
    const creates = planItems.filter(i => i.action === 'create').length;
    const updates = planItems.filter(i => i.action === 'update').length;
    const skips = planItems.filter(i => i.action === 'skip').length;
    const orphans = planItems.filter(i => i.action === 'delete');
    const deletes = orphans.filter(i => i.includeDelete).length;
    return { creates, updates, skips, orphanTotal: orphans.length, deletes };
  }, [planItems]);

  const actionCount = planStats.creates + planStats.updates + planStats.deletes;

  // ========================
  // EXECUTE PLAN
  // ========================
  async function handleExecutePlan() {
    const creds = await getConstellixCredentials();
    if (!creds) return;

    setPushPhase('executing');
    setExecErrors([]);
    setExecSuccesses(0);

    const trimmedDomain = domain.trim().replace(/\.$/, '');
    const errors: PushError[] = [];
    let successes = 0;

    // Ensure domain exists
    setExecProgress({ current: 0, total: actionCount, message: 'Ensuring domain exists...' });
    const domainResult = await createDomain(creds, trimmedDomain);
    if (!domainResult.id) {
      setExecErrors([{ record: trimmedDomain, type: 'DOMAIN', error: domainResult.error || 'Failed' }]);
      setPushPhase('error');
      return;
    }
    const domainId = domainResult.id;

    // Execute creates
    const creates = planItems.filter(i => i.action === 'create');
    if (creates.length > 0) {
      const dnsRecords: DnsRecord[] = creates.map(i => ({
        name: i.name,
        ttl: i.ttl,
        class: 'IN',
        type: i.type,
        value: i.value,
      }));

      const mapped = mapRecordsForConstellix(dnsRecords, trimmedDomain);

      for (let j = 0; j < mapped.length; j++) {
        const rec = mapped[j];
        const displayName = rec.name || '@';
        setExecProgress({
          current: successes + errors.length + 1,
          total: actionCount,
          message: `Creating ${rec.type.toUpperCase()} ${displayName}`,
        });

        const result = await createRecord(creds, domainId, rec);
        if (result.success) {
          successes++;
        } else {
          errors.push({ record: displayName, type: rec.type.toUpperCase(), error: result.error || 'Unknown error' });
        }

        await new Promise(r => setTimeout(r, 1200));
      }
    }

    // Execute updates
    const updates = planItems.filter(i => i.action === 'update' && i.existingRecord);
    for (const item of updates) {
      const rec = item.existingRecord!;
      setExecProgress({
        current: successes + errors.length + 1,
        total: actionCount,
        message: `Updating ${item.type} ${item.name}`,
      });

      const result = await updateRecord(
        creds, domainId, rec.id, rec.type,
        item.name === '@' ? '' : item.name,
        item.ttl, item.value,
      );
      if (result.success) {
        successes++;
      } else {
        errors.push({ record: item.name, type: item.type, error: result.error || 'Unknown error' });
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    // Execute deletes (only the ones user checked)
    const deletes = planItems.filter(i => i.action === 'delete' && i.includeDelete && i.orphanRecord);
    for (const item of deletes) {
      const rec = item.orphanRecord!;
      setExecProgress({
        current: successes + errors.length + 1,
        total: actionCount,
        message: `Deleting ${item.type} ${item.name}`,
      });

      const result = await deleteRecord(creds, domainId, rec.id, rec.type);
      if (result.success) {
        successes++;
      } else {
        errors.push({ record: item.name, type: item.type, error: result.error || 'Unknown error' });
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    setExecSuccesses(successes);
    setExecErrors(errors);
    setExecProgress({ current: actionCount, total: actionCount, message: 'Done' });
    setPushPhase('done');
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

  function handleCancelPlan() {
    setPushPhase('idle');
    setPlanItems([]);
    setPlanError('');
  }

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
      {hasScanned && records.length > 0 && pushPhase === 'idle' && (
        <div className="migrate-actions-card">
          <button
            className="btn btn-primary"
            onClick={handleReviewPush}
            disabled={planLoading || selectedCount === 0}
          >
            {planLoading ? 'Checking Constellix...' : `Review & Push ${selectedCount} Records`}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={selectedCount === 0}
          >
            Export as Zone File
          </button>
          <div style={{ flex: 1 }} />
          {planError && <span className="error-text">{planError}</span>}
          {selectedCount === 0 && (
            <span className="muted">Select records to enable actions</span>
          )}
        </div>
      )}

      {/* Push Review Plan */}
      {pushPhase === 'reviewing' && (
        <div className="push-plan">
          <h3>Push Plan</h3>
          <p className="subtitle">
            Compared your {selectedCount} selected records against what's currently in Constellix.
          </p>

          {/* Stats */}
          <div className="push-plan-stats">
            {planStats.creates > 0 && (
              <div className="plan-stat plan-stat-create">
                <span className="plan-stat-num">{planStats.creates}</span> to create
              </div>
            )}
            {planStats.updates > 0 && (
              <div className="plan-stat plan-stat-update">
                <span className="plan-stat-num">{planStats.updates}</span> to update
              </div>
            )}
            {planStats.skips > 0 && (
              <div className="plan-stat plan-stat-skip">
                <span className="plan-stat-num">{planStats.skips}</span> already there
              </div>
            )}
            {planStats.orphanTotal > 0 && (
              <div className="plan-stat plan-stat-delete">
                <span className="plan-stat-num">{planStats.orphanTotal}</span> in Constellix not selected
              </div>
            )}
          </div>

          {/* Detail table for creates and updates */}
          {(planStats.creates > 0 || planStats.updates > 0) && (
            <div className="push-plan-details">
              <table className="push-plan-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {planItems.filter(i => i.action === 'create' || i.action === 'update').map((item, idx) => (
                    <tr key={`${item.action}-${idx}`}>
                      <td>
                        <span className={`plan-action-badge plan-action-${item.action}`}>
                          {item.action}
                        </span>
                      </td>
                      <td className="curation-name">{item.name}</td>
                      <td><span className={`badge badge-${item.type.toLowerCase()}`}>{item.type}</span></td>
                      <td className="curation-value" title={item.value}>
                        {item.value}
                        {item.action === 'update' && item.existingRecord && (
                          <span className="muted" style={{ display: 'block', fontSize: '0.72rem' }}>
                            was: {item.existingRecord.value}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {planStats.creates === 0 && planStats.updates === 0 && planStats.orphanTotal === 0 && (
            <div className="summary summary-success">
              All selected records already exist in Constellix. Nothing to do.
            </div>
          )}

          {/* Orphans section */}
          {planStats.orphanTotal > 0 && (
            <div className="push-plan-orphans">
              <button className="orphan-toggle" onClick={() => setShowOrphans(!showOrphans)}>
                {showOrphans ? '▾' : '▸'} {planStats.orphanTotal} record{planStats.orphanTotal !== 1 ? 's' : ''} in Constellix not in your selection
                {planStats.deletes > 0 && ` (${planStats.deletes} marked for deletion)`}
              </button>
              {showOrphans && (
                <div className="orphan-list">
                  <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                    Check any records you want to <strong>delete</strong> from Constellix. Unchecked orphans will be left alone.
                  </p>
                  {planItems.filter(i => i.action === 'delete').map((item, idx) => {
                    const globalIdx = planItems.indexOf(item);
                    return (
                      <div key={`orphan-${idx}`} className="orphan-row">
                        <div className="checkbox-cell">
                          <input
                            type="checkbox"
                            checked={item.includeDelete || false}
                            onChange={() => toggleOrphanDelete(globalIdx)}
                          />
                        </div>
                        <span className={`badge badge-${item.type.toLowerCase()}`}>{item.type}</span>
                        <span className="orphan-name">{item.name}</span>
                        <span className="orphan-value" title={item.value}>{item.value}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="push-plan-actions">
            <button className="btn btn-ghost" onClick={handleCancelPlan}>
              Cancel
            </button>
            <div style={{ flex: 1 }} />
            {actionCount > 0 ? (
              <button className="btn btn-primary" onClick={handleExecutePlan}>
                Execute: {planStats.creates > 0 ? `${planStats.creates} create` : ''}
                {planStats.creates > 0 && planStats.updates > 0 ? ', ' : ''}
                {planStats.updates > 0 ? `${planStats.updates} update` : ''}
                {(planStats.creates > 0 || planStats.updates > 0) && planStats.deletes > 0 ? ', ' : ''}
                {planStats.deletes > 0 ? `${planStats.deletes} delete` : ''}
              </button>
            ) : (
              <span className="muted">Nothing to execute</span>
            )}
          </div>
        </div>
      )}

      {/* Execution Progress */}
      {pushPhase === 'executing' && (
        <div className="card">
          <div className="push-progress">
            <div className="phase-indicator">
              <span className="phase-dot phase-pushing_records" />
              <span>Executing changes...</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: execProgress.total ? `${(execProgress.current / execProgress.total) * 100}%` : '0%' }}
              />
              <span className="progress-text">
                {execProgress.message} ({execProgress.current}/{execProgress.total})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Done */}
      {pushPhase === 'done' && (
        <div className="card">
          <div className={`summary ${execErrors.length === 0 ? 'summary-success' : 'summary-warning'}`}>
            {execErrors.length === 0 ? (
              <span>All {execSuccesses} changes applied successfully.</span>
            ) : (
              <span>{execSuccesses} succeeded, {execErrors.length} failed</span>
            )}
          </div>
          {execErrors.length > 0 && (
            <PushErrorTable errors={execErrors} />
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-ghost" onClick={() => setPushPhase('idle')}>
              Back to Curation
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {pushPhase === 'error' && (
        <div className="card">
          <p className="error-text">
            {execErrors.length > 0 ? execErrors[0].error : 'An error occurred.'}
          </p>
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-ghost" onClick={() => setPushPhase('idle')}>
              Back
            </button>
          </div>
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
