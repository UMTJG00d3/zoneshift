import { ParsedZone, formatForConstellix } from '../utils/zoneParser';

interface FormattedOutputProps {
  parsed: ParsedZone;
}

export default function FormattedOutput({ parsed }: FormattedOutputProps) {
  const output = formatForConstellix(parsed);

  function copyToClipboard() {
    navigator.clipboard.writeText(output);
  }

  function downloadFile() {
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${parsed.origin || 'zone'}-constellix.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="formatted-output">
      <h2>Constellix-Ready Output</h2>
      <div className="output-meta">
        <span>Domain: <strong>{parsed.origin}</strong></span>
        <span>Records: <strong>{parsed.records.length}</strong></span>
      </div>

      <pre className="zone-preview">{output}</pre>

      <div className="output-actions">
        <button className="btn btn-primary" onClick={copyToClipboard}>
          Copy to Clipboard
        </button>
        <button className="btn btn-secondary" onClick={downloadFile}>
          Download .txt
        </button>
      </div>
    </div>
  );
}
