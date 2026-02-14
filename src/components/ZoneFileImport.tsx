import { useState, useRef, DragEvent } from 'react';

interface ZoneFileImportProps {
  onImport: (content: string) => void;
  onManageDomain: (domain: string) => void;
}

interface DiscoveredRecord {
  name: string;
  type: string;
  ttl: number;
  value: string;
}

export default function ZoneFileImport({ onImport, onManageDomain }: ZoneFileImportProps) {
  const [dragging, setDragging] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [manageDomain, setManageDomain] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DNS Discovery state
  const [discoveryNS, setDiscoveryNS] = useState('');
  const [discoveryDomain, setDiscoveryDomain] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [discoveredRecords, setDiscoveredRecords] = useState<DiscoveredRecord[]>([]);
  const [discoveryStats, setDiscoveryStats] = useState<{ checked: number; servers: number; totalFound: number } | null>(null);
  const [discoveryProgress, setDiscoveryProgress] = useState('');

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  function handleFileSelect() {
    const file = fileInputRef.current?.files?.[0];
    if (file) readFile(file);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) onImport(text);
    };
    reader.readAsText(file);
  }

  function handlePasteSubmit() {
    if (pasteContent.trim()) {
      onImport(pasteContent);
    }
  }

  async function handleDiscovery() {
    if (!discoveryNS.trim() || !discoveryDomain.trim()) return;

    setDiscovering(true);
    setDiscoveryError('');
    setDiscoveredRecords([]);
    setDiscoveryStats(null);
    setDiscoveryProgress('');

    // Parse multiple nameservers (comma, newline, or space separated)
    const nameservers = discoveryNS
      .split(/[,\n\s]+/)
      .map(ns => ns.trim())
      .filter(ns => ns.length > 0);

    if (nameservers.length === 0) {
      setDiscoveryError('No valid nameservers provided');
      setDiscovering(false);
      return;
    }

    const allRecords: DiscoveredRecord[] = [];
    const errors: string[] = [];
    let totalChecked = 0;

    for (let i = 0; i < nameservers.length; i++) {
      const ns = nameservers[i];
      setDiscoveryProgress(`Querying ${ns} (${i + 1}/${nameservers.length})...`);

      try {
        const res = await fetch('/api/dns/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nameserver: ns,
            domain: discoveryDomain.trim(),
            discover: true,
          }),
          credentials: 'include',
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          errors.push(`${ns}: ${data.error || `HTTP ${res.status}`}`);
          continue;
        }

        totalChecked += data.subdomainsChecked || 0;
        if (data.records) {
          allRecords.push(...data.records);
        }
      } catch (err) {
        errors.push(`${ns}: ${(err as Error).message}`);
      }
    }

    // Deduplicate records (same name + type + value)
    const seen = new Set<string>();
    const uniqueRecords = allRecords.filter(rec => {
      const key = `${rec.name}|${rec.type}|${rec.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by name, then type
    uniqueRecords.sort((a, b) => {
      const aName = a.name === '@' ? '' : a.name;
      const bName = b.name === '@' ? '' : b.name;
      if (aName !== bName) return aName.localeCompare(bName);
      return a.type.localeCompare(b.type);
    });

    setDiscoveredRecords(uniqueRecords);
    setDiscoveryStats({
      checked: totalChecked,
      servers: nameservers.length,
      totalFound: allRecords.length,
    });
    setDiscoveryProgress('');

    if (errors.length > 0 && uniqueRecords.length === 0) {
      setDiscoveryError(errors.join('; '));
    } else if (errors.length > 0) {
      // Partial success - show warning but don't block
      setDiscoveryError(`Warning: ${errors.join('; ')}`);
    }

    setDiscovering(false);
  }

  function handleImportDiscovered() {
    if (discoveredRecords.length === 0) return;

    // Convert discovered records to BIND zone file format
    const domain = discoveryDomain.trim();
    const lines: string[] = [`$ORIGIN ${domain}.`];

    // Group by type for cleaner output
    const byType = new Map<string, DiscoveredRecord[]>();
    for (const rec of discoveredRecords) {
      if (!byType.has(rec.type)) byType.set(rec.type, []);
      byType.get(rec.type)!.push(rec);
    }

    const typeOrder = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'];
    const sortedTypes = [
      ...typeOrder.filter(t => byType.has(t)),
      ...[...byType.keys()].filter(t => !typeOrder.includes(t)),
    ];

    for (const type of sortedTypes) {
      lines.push(`; ${type} Records`);
      for (const rec of byType.get(type)!) {
        lines.push(`${rec.name}\t${rec.ttl}\tIN\t${rec.type}\t${rec.value}`);
      }
    }

    onImport(lines.join('\n'));
  }

  return (
    <div className="zone-import">
      <h2>Import Zone File</h2>
      <p className="subtitle">
        Drag & drop a GoDaddy DNS zone export, or paste the contents below.
      </p>

      <div
        className={`drop-zone ${dragging ? 'drop-zone-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <span className="drop-icon">{dragging ? '\u21E9' : '\u2191'}</span>
        <span>Drop zone file here or click to browse</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.zone,.db"
          onChange={handleFileSelect}
          hidden
        />
      </div>

      <div className="divider">
        <span>or paste zone file content</span>
      </div>

      <textarea
        className="zone-textarea"
        placeholder={`; Domain: example.com\n$ORIGIN example.com.\n@ 600 IN A 1.2.3.4\n...`}
        value={pasteContent}
        onChange={(e) => setPasteContent(e.target.value)}
        rows={12}
      />

      <button
        className="btn btn-primary"
        onClick={handlePasteSubmit}
        disabled={!pasteContent.trim()}
      >
        Parse Zone File
      </button>

      <div className="divider">
        <span>or discover records from old nameserver</span>
      </div>

      <div className="dns-discovery-section">
        <p className="discovery-help">
          Query old nameservers directly to discover all DNS records, even if the domain's
          NS no longer points there. Enter multiple nameservers (comma or newline separated) to
          query all and get deduplicated results.
        </p>
        <div className="discovery-inputs">
          <div className="form-field">
            <label>Nameserver(s)</label>
            <input
              type="text"
              placeholder="ns1.netsol.com, ns1.fastcomet.com"
              value={discoveryNS}
              onChange={(e) => setDiscoveryNS(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Domain</label>
            <input
              type="text"
              placeholder="example.com"
              value={discoveryDomain}
              onChange={(e) => setDiscoveryDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && discoveryNS.trim() && discoveryDomain.trim()) {
                  handleDiscovery();
                }
              }}
            />
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleDiscovery}
            disabled={discovering || !discoveryNS.trim() || !discoveryDomain.trim()}
          >
            {discovering ? 'Discovering...' : 'Discover Records'}
          </button>
        </div>

        {discoveryProgress && <p className="discovery-progress">{discoveryProgress}</p>}

        {discoveryError && <p className="error-text">{discoveryError}</p>}

        {discoveryStats && (
          <p className="discovery-stats">
            Queried {discoveryStats.servers} nameserver{discoveryStats.servers !== 1 ? 's' : ''},{' '}
            checked {discoveryStats.checked} subdomains, found {discoveryStats.totalFound} records{' '}
            → <strong>{discoveredRecords.length}</strong> unique after deduplication
          </p>
        )}

        {discoveredRecords.length > 0 && (
          <div className="discovered-records">
            <div className="discovered-header">
              <h4>Discovered Records</h4>
              <button className="btn btn-primary btn-sm" onClick={handleImportDiscovered}>
                Import These Records
              </button>
            </div>
            <div className="discovered-table-container">
              <table className="discovered-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>TTL</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredRecords.map((rec, i) => (
                    <tr key={i}>
                      <td>{rec.name}</td>
                      <td><span className={`record-type type-${rec.type.toLowerCase()}`}>{rec.type}</span></td>
                      <td>{rec.ttl}</td>
                      <td className="value-cell">{rec.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="divider">
        <span>or manage existing Constellix domain</span>
      </div>

      <div className="manage-domain-section">
        <input
          type="text"
          className="manage-domain-input"
          placeholder="example.com"
          value={manageDomain}
          onChange={(e) => setManageDomain(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && manageDomain.trim()) {
              onManageDomain(manageDomain.trim());
            }
          }}
        />
        <button
          className="btn btn-secondary"
          onClick={() => onManageDomain(manageDomain.trim())}
          disabled={!manageDomain.trim()}
        >
          Manage Domain
        </button>
      </div>
    </div>
  );
}
