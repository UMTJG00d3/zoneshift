import { useState, useRef, useEffect } from 'react';
import {
  ConstellixCredentials,
  ConstellixRecord,
  getDomainId,
  listRecords,
  addRecord,
  updateRecord,
  deleteRecord,
} from '../utils/constellixApi';

interface RecordManagerProps {
  domain: string;
  credentials: ConstellixCredentials;
}

type Mode = 'idle' | 'loading' | 'viewing' | 'adding' | 'editing';

interface PendingChange {
  id: string;
  action: 'add' | 'edit' | 'delete';
  record: {
    id?: number;
    name: string;
    type: string;
    ttl: number;
    value: string;
  };
  originalRecord?: ConstellixRecord;
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

export default function RecordManager({ domain, credentials }: RecordManagerProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [domainId, setDomainId] = useState<number | null>(null);
  const [records, setRecords] = useState<ConstellixRecord[]>([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Pending changes queue
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ current: number; total: number } | null>(null);

  // Form state for add/edit
  const [editingRecord, setEditingRecord] = useState<ConstellixRecord | null>(null);
  const [formName, setFormName] = useState('@');
  const [formType, setFormType] = useState('A');
  const [formTtl, setFormTtl] = useState('3600');
  const [formValue, setFormValue] = useState('');

  // Refs for scroll-into-view
  const formRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);

  // Filter/search
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');

  // Multi-select for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  async function loadRecords(preserveMessages = false) {
    setMode('loading');
    if (!preserveMessages) {
      setError('');
      setSuccessMsg('');
    }

    // Get domain ID first
    const domainRes = await getDomainId(credentials, domain);
    if (!domainRes.id) {
      setError(domainRes.error || 'Domain not found');
      setMode('idle');
      return;
    }

    setDomainId(domainRes.id);

    // Load records
    const recordsRes = await listRecords(credentials, domainRes.id);
    if (recordsRes.error) {
      setError(recordsRes.error);
      setMode('idle');
      return;
    }

    setRecords(recordsRes.records);
    setMode('viewing');
  }

  function startAdd() {
    setEditingRecord(null);
    setFormName('@');
    setFormType('A');
    setFormTtl('3600');
    setFormValue('');
    setError('');
    setMode('adding');
  }

  function startEdit(record: ConstellixRecord) {
    setEditingRecord(record);
    setFormName(record.name);
    setFormType(record.type);
    setFormTtl(record.ttl.toString());
    setFormValue(record.value);
    setError('');
    setMode('editing');
    // Scroll handled by useEffect below
  }

  // Scroll form into view when editing/adding
  useEffect(() => {
    if ((mode === 'editing' || mode === 'adding') && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mode]);

  function cancelForm() {
    setEditingRecord(null);
    setMode('viewing');
  }

  // Queue a change instead of immediately applying
  function queueChange() {
    const ttl = parseInt(formTtl, 10) || 3600;
    const changeId = `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (mode === 'adding') {
      const newChange: PendingChange = {
        id: changeId,
        action: 'add',
        record: {
          name: formName,
          type: formType,
          ttl,
          value: formValue,
        },
      };
      setPendingChanges([...pendingChanges, newChange]);
      setSuccessMsg(`Queued: Add ${formType} record for ${formName}`);
    } else if (mode === 'editing' && editingRecord) {
      // Check if there's already a pending edit for this record
      const existingIndex = pendingChanges.findIndex(
        c => c.action === 'edit' && c.record.id === editingRecord.id && c.record.type === editingRecord.type
      );

      const editChange: PendingChange = {
        id: changeId,
        action: 'edit',
        record: {
          id: editingRecord.id,
          name: formName,
          type: editingRecord.type,
          ttl,
          value: formValue,
        },
        originalRecord: editingRecord,
      };

      if (existingIndex >= 0) {
        const updated = [...pendingChanges];
        updated[existingIndex] = editChange;
        setPendingChanges(updated);
      } else {
        setPendingChanges([...pendingChanges, editChange]);
      }
      setSuccessMsg(`Queued: Edit ${editingRecord.type} record ${editingRecord.name}`);
    }

    setEditingRecord(null);
    setMode('viewing');
    // Scroll pending panel into view so user sees the queued change
    setTimeout(() => {
      pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    setTimeout(() => setSuccessMsg(''), 5000);
  }

  function removeFromQueue(changeId: string) {
    setPendingChanges(pendingChanges.filter(c => c.id !== changeId));
  }

  function clearQueue() {
    setPendingChanges([]);
  }

  async function applyAllChanges() {
    if (!domainId || pendingChanges.length === 0) return;

    setApplying(true);
    setError('');
    setApplyProgress({ current: 0, total: pendingChanges.length });

    const results: { change: PendingChange; success: boolean; error?: string }[] = [];

    for (let i = 0; i < pendingChanges.length; i++) {
      const change = pendingChanges[i];
      setApplyProgress({ current: i + 1, total: pendingChanges.length });

      try {
        if (change.action === 'add') {
          const res = await addRecord(
            credentials,
            domainId,
            change.record.name,
            change.record.type,
            change.record.ttl,
            change.record.value
          );
          results.push({ change, success: res.success, error: res.error });
        } else if (change.action === 'edit' && change.record.id) {
          const res = await updateRecord(
            credentials,
            domainId,
            change.record.id,
            change.record.type,
            change.record.name,
            change.record.ttl,
            change.record.value
          );
          results.push({ change, success: res.success, error: res.error });
        } else if (change.action === 'delete' && change.record.id) {
          const res = await deleteRecord(credentials, domainId, change.record.id, change.record.type);
          results.push({ change, success: res.success, error: res.error });
        }
      } catch (err) {
        results.push({ change, success: false, error: (err as Error).message });
      }

      // Small delay between operations
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (failCount > 0) {
      const failedOps = results.filter(r => !r.success).map(r =>
        `${r.change.action} ${r.change.record.type} ${r.change.record.name}: ${r.error}`
      );
      setError(`${failCount} operation(s) failed:\n${failedOps.join('\n')}`);
    }

    if (successCount > 0) {
      setSuccessMsg(`${successCount} change(s) applied successfully`);
    }

    setPendingChanges([]);
    setApplying(false);
    setApplyProgress(null);

    // Reload records to show updated state (preserve error/success messages)
    await loadRecords(true);
  }

  // Check if a record has pending changes
  function getRecordPendingStatus(record: ConstellixRecord): 'delete' | 'edit' | null {
    const pending = pendingChanges.find(
      c => c.record.id === record.id && c.record.type === record.type
    );
    if (pending) return pending.action as 'delete' | 'edit';
    return null;
  }

  // Filter records
  const filteredRecords = records.filter(rec => {
    if (filterType !== 'all' && rec.type !== filterType) return false;
    if (filterText) {
      const search = filterText.toLowerCase();
      return (
        rec.name.toLowerCase().includes(search) ||
        rec.value.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const recordTypes = [...new Set(records.map(r => r.type))].sort();

  // Helper to create unique record key
  function getRecordKey(rec: ConstellixRecord): string {
    return `${rec.type}-${rec.id}`;
  }

  // Handle checkbox click with shift/ctrl support
  function handleSelect(rec: ConstellixRecord, index: number, event: React.MouseEvent) {
    const key = getRecordKey(rec);
    const newSelected = new Set(selectedIds);

    if (event.shiftKey && lastSelectedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(getRecordKey(filteredRecords[i]));
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: toggle single item
      if (newSelected.has(key)) {
        newSelected.delete(key);
      } else {
        newSelected.add(key);
      }
    } else {
      // Normal click: toggle single, clear others
      if (newSelected.has(key) && newSelected.size === 1) {
        newSelected.clear();
      } else {
        newSelected.clear();
        newSelected.add(key);
      }
    }

    setSelectedIds(newSelected);
    setLastSelectedIndex(index);
  }

  // Select/deselect all visible
  function toggleSelectAll() {
    if (selectedIds.size === filteredRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => getRecordKey(r))));
    }
    setLastSelectedIndex(null);
  }

  // Queue delete for all selected records
  function queueDeleteSelected() {
    const toDelete = filteredRecords.filter(r => selectedIds.has(getRecordKey(r)));
    let added = 0;

    toDelete.forEach(record => {
      // Check if already queued for deletion
      const alreadyQueued = pendingChanges.some(
        c => c.action === 'delete' && c.record.id === record.id && c.record.type === record.type
      );
      if (!alreadyQueued) {
        const changeId = `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const deleteChange: PendingChange = {
          id: changeId,
          action: 'delete',
          record: {
            id: record.id,
            name: record.name,
            type: record.type,
            ttl: record.ttl,
            value: record.value,
          },
          originalRecord: record,
        };
        setPendingChanges(prev => [...prev, deleteChange]);
        added++;
      }
    });

    if (added > 0) {
      setSuccessMsg(`Queued ${added} record(s) for deletion`);
      setTimeout(() => setSuccessMsg(''), 3000);
    }

    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  }

  // Check if a record is selected
  function isSelected(rec: ConstellixRecord): boolean {
    return selectedIds.has(getRecordKey(rec));
  }

  return (
    <div className="record-manager">
      <h3>DNS Records</h3>

      {error && <pre className="error-text">{error}</pre>}
      {successMsg && <p className="success-text">{successMsg}</p>}

      {mode === 'idle' && (
        <button className="btn btn-primary" onClick={() => loadRecords()}>
          Load Records from Constellix
        </button>
      )}

      {mode === 'loading' && <p className="muted">Loading records...</p>}

      {(mode === 'viewing' || mode === 'adding' || mode === 'editing') && (
        <>
          {/* Pending Changes Panel */}
          {pendingChanges.length > 0 && (
            <div className="pending-changes-panel" ref={pendingRef}>
              <div className="pending-header">
                <h4>Pending Changes ({pendingChanges.length})</h4>
                <div className="pending-actions">
                  <button className="btn btn-ghost btn-sm" onClick={clearQueue} disabled={applying}>
                    Clear All
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={applyAllChanges}
                    disabled={applying}
                  >
                    {applying
                      ? `Applying ${applyProgress?.current}/${applyProgress?.total}...`
                      : 'Apply All Changes'}
                  </button>
                </div>
              </div>
              <div className="pending-list">
                {pendingChanges.map(change => (
                  <div key={change.id} className={`pending-item pending-${change.action}`}>
                    <span className={`pending-action action-${change.action}`}>
                      {change.action.toUpperCase()}
                    </span>
                    <span className={`badge badge-${change.record.type.toLowerCase()}`}>
                      {change.record.type}
                    </span>
                    <span className="pending-name">{change.record.name}</span>
                    <span className="pending-value">{change.record.value}</span>
                    <button
                      className="btn-icon btn-icon-danger"
                      onClick={() => removeFromQueue(change.id)}
                      disabled={applying}
                      title="Remove from queue"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Bar */}
          <div className="record-manager-actions">
            <button className="btn btn-secondary" onClick={() => loadRecords()} disabled={applying}>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={startAdd} disabled={applying}>
              Add Record
            </button>
            {selectedIds.size > 0 && (
              <button
                className="btn btn-secondary btn-danger-text"
                onClick={queueDeleteSelected}
                disabled={applying}
              >
                Delete Selected ({selectedIds.size})
              </button>
            )}
            <div className="record-filters">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Types</option>
                {recordTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Search name or value..."
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="filter-input"
              />
            </div>
          </div>

          {/* Add/Edit Form */}
          {(mode === 'adding' || mode === 'editing') && (
            <div className="record-form" ref={formRef}>
              <h4>{mode === 'adding' ? 'Add Record' : 'Edit Record'}</h4>
              <div className="record-form-fields">
                <div className="form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="@ for root"
                    disabled={applying}
                  />
                </div>
                <div className="form-field">
                  <label>Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    disabled={applying || mode === 'editing'}
                  >
                    {RECORD_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>TTL</label>
                  <input
                    type="number"
                    value={formTtl}
                    onChange={(e) => setFormTtl(e.target.value)}
                    disabled={applying}
                  />
                </div>
                <div className="form-field form-field-wide">
                  <label>Value {formType === 'MX' && '(priority server)'}</label>
                  <input
                    type="text"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder={getValuePlaceholder(formType)}
                    disabled={applying}
                  />
                </div>
              </div>
              <div className="record-form-actions">
                <button className="btn btn-ghost" onClick={cancelForm} disabled={applying}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={queueChange}
                  disabled={applying || !formValue.trim()}
                >
                  {mode === 'adding' ? 'Queue Add' : 'Queue Edit'}
                </button>
              </div>
            </div>
          )}

          {/* Records Table */}
          {records.length === 0 && mode === 'viewing' && (
            <p className="muted">No records found in Constellix for this domain.</p>
          )}

          {records.length > 0 && (
            <>
              <div className="record-count">
                Showing {filteredRecords.length} of {records.length} records
              </div>
              <div className="table-container">
                <table className="record-table">
                  <thead>
                    <tr>
                      <th className="checkbox-cell">
                        <input
                          type="checkbox"
                          checked={filteredRecords.length > 0 && selectedIds.size === filteredRecords.length}
                          onChange={toggleSelectAll}
                          disabled={applying}
                          title="Select all"
                        />
                      </th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>TTL</th>
                      <th>Value</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((rec, index) => {
                      const pendingStatus = getRecordPendingStatus(rec);
                      const selected = isSelected(rec);
                      return (
                        <tr
                          key={`${rec.type}-${rec.id}`}
                          className={`${pendingStatus ? `row-pending row-pending-${pendingStatus}` : ''} ${selected ? 'row-selected' : ''}`}
                        >
                          <td className="checkbox-cell">
                            <input
                              type="checkbox"
                              checked={selected}
                              onClick={(e) => handleSelect(rec, index, e)}
                              onChange={() => {}} // Controlled by onClick
                              disabled={applying || pendingStatus === 'delete'}
                            />
                          </td>
                          <td>
                            {rec.name}
                            {pendingStatus && (
                              <span className={`pending-badge pending-badge-${pendingStatus}`}>
                                {pendingStatus}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge badge-${rec.type.toLowerCase()}`}>
                              {rec.type}
                            </span>
                          </td>
                          <td>{rec.ttl}</td>
                          <td className="value-cell">{rec.value}</td>
                          <td className="action-cell">
                            <button
                              className="btn-icon"
                              onClick={() => startEdit(rec)}
                              title="Edit"
                              disabled={applying || pendingStatus === 'delete'}
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function getValuePlaceholder(type: string): string {
  switch (type) {
    case 'A': return '192.168.1.1';
    case 'AAAA': return '2001:db8::1';
    case 'CNAME': return 'target.example.com';
    case 'MX': return '10 mail.example.com';
    case 'TXT': return 'v=spf1 include:...';
    case 'NS': return 'ns1.example.com';
    case 'SRV': return '10 5 5060 sipserver.example.com';
    case 'CAA': return '0 issue "letsencrypt.org"';
    default: return '';
  }
}
