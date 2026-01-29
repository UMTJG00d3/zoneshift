import { useState, useRef, DragEvent } from 'react';

interface ZoneFileImportProps {
  onImport: (content: string) => void;
  onManageDomain: (domain: string) => void;
}

export default function ZoneFileImport({ onImport, onManageDomain }: ZoneFileImportProps) {
  const [dragging, setDragging] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [manageDomain, setManageDomain] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
