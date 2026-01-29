import { useState } from 'react';
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

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];

export default function RecordManager({ domain, credentials }: RecordManagerProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [domainId, setDomainId] = useState<number | null>(null);
  const [records, setRecords] = useState<ConstellixRecord[]>([]);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form state for add/edit
  const [editingRecord, setEditingRecord] = useState<ConstellixRecord | null>(null);
  const [formName, setFormName] = useState('@');
  const [formType, setFormType] = useState('A');
  const [formTtl, setFormTtl] = useState('3600');
  const [formValue, setFormValue] = useState('');
  const [formBusy, setFormBusy] = useState(false);

  async function loadRecords() {
    setMode('loading');
    setError('');
    setSuccessMsg('');

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
    setSuccessMsg('');
    setMode('adding');
  }

  function startEdit(record: ConstellixRecord) {
    setEditingRecord(record);
    setFormName(record.name);
    setFormType(record.type);
    setFormTtl(record.ttl.toString());
    setFormValue(record.value);
    setError('');
    setSuccessMsg('');
    setMode('editing');
  }

  function cancelForm() {
    setEditingRecord(null);
    setMode('viewing');
  }

  async function handleSave() {
    if (!domainId) return;
    setFormBusy(true);
    setError('');

    const ttl = parseInt(formTtl, 10) || 3600;

    if (mode === 'adding') {
      const res = await addRecord(credentials, domainId, formName, formType, ttl, formValue);
      if (res.success) {
        setSuccessMsg(`Added ${formType} record for ${formName}`);
        await loadRecords();
      } else {
        setError(res.error || 'Failed to add record');
        setFormBusy(false);
      }
    } else if (mode === 'editing' && editingRecord) {
      const res = await updateRecord(
        credentials,
        domainId,
        editingRecord.id,
        editingRecord.type,
        formName,
        ttl,
        formValue
      );
      if (res.success) {
        setSuccessMsg(`Updated ${editingRecord.type} record`);
        await loadRecords();
      } else {
        setError(res.error || 'Failed to update record');
        setFormBusy(false);
      }
    }

    setFormBusy(false);
  }

  async function handleDelete(record: ConstellixRecord) {
    if (!domainId) return;
    if (!confirm(`Delete ${record.type} record "${record.name}"?`)) return;

    setError('');
    const res = await deleteRecord(credentials, domainId, record.id, record.type);
    if (res.success) {
      setSuccessMsg(`Deleted ${record.type} record`);
      setRecords(records.filter((r) => r.id !== record.id || r.type !== record.type));
    } else {
      setError(res.error || 'Failed to delete record');
    }
  }

  return (
    <div className="record-manager">
      <h3>Manage Constellix Records</h3>
      <p className="subtitle">
        View, add, edit, or delete records for {domain} in Constellix.
      </p>

      {error && <p className="error-text">{error}</p>}
      {successMsg && <p className="success-text">{successMsg}</p>}

      {mode === 'idle' && (
        <button className="btn btn-secondary" onClick={loadRecords}>
          Load Records from Constellix
        </button>
      )}

      {mode === 'loading' && <p className="muted">Loading records...</p>}

      {(mode === 'viewing' || mode === 'adding' || mode === 'editing') && (
        <>
          <div className="record-manager-actions">
            <button className="btn btn-secondary" onClick={loadRecords} disabled={formBusy}>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={startAdd} disabled={formBusy}>
              Add Record
            </button>
          </div>

          {(mode === 'adding' || mode === 'editing') && (
            <div className="record-form">
              <h4>{mode === 'adding' ? 'Add Record' : 'Edit Record'}</h4>
              <div className="record-form-fields">
                <div className="form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="@ for root"
                    disabled={formBusy}
                  />
                </div>
                <div className="form-field">
                  <label>Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    disabled={formBusy || mode === 'editing'}
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
                    disabled={formBusy}
                  />
                </div>
                <div className="form-field form-field-wide">
                  <label>Value {formType === 'MX' && '(priority server)'}</label>
                  <input
                    type="text"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder={getValuePlaceholder(formType)}
                    disabled={formBusy}
                  />
                </div>
              </div>
              <div className="record-form-actions">
                <button className="btn btn-ghost" onClick={cancelForm} disabled={formBusy}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={formBusy || !formValue.trim()}
                >
                  {formBusy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {records.length === 0 && mode === 'viewing' && (
            <p className="muted">No records found in Constellix for this domain.</p>
          )}

          {records.length > 0 && (
            <div className="table-container">
              <table className="record-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>TTL</th>
                    <th>Value</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={`${rec.type}-${rec.id}`}>
                      <td>{rec.name}</td>
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
                          disabled={formBusy}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-icon btn-icon-danger"
                          onClick={() => handleDelete(rec)}
                          title="Delete"
                          disabled={formBusy}
                        >
                          Del
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
    default: return '';
  }
}
