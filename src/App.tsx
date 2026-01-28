import { useState } from 'react';
import StepIndicator from './components/StepIndicator';
import ZoneFileImport from './components/ZoneFileImport';
import RecordTable from './components/RecordTable';
import FormattedOutput from './components/FormattedOutput';
import NSLookup from './components/NSLookup';
import ComparisonTable from './components/ComparisonTable';
import { parseZoneFile, ParsedZone } from './utils/zoneParser';

const STEPS = [
  'Import Zone File',
  'Review & Export',
  'Current NS',
  'Compare',
];

export default function App() {
  const [step, setStep] = useState(1);
  const [parsed, setParsed] = useState<ParsedZone | null>(null);
  const [currentNS, setCurrentNS] = useState<string[]>([]);

  function handleImport(content: string) {
    const result = parseZoneFile(content);
    setParsed(result);
    setStep(2);
  }

  function handleNSFound(ns: string[]) {
    setCurrentNS(ns);
  }

  function goToStep(target: number) {
    // Only allow going to steps that are unlocked
    if (target === 1) setStep(1);
    if (target === 2 && parsed) setStep(2);
    if (target === 3 && parsed) setStep(3);
    if (target === 4 && parsed) setStep(4);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo">Z</span>
          ZoneShift
        </h1>
        <span className="header-subtitle">DNS Migration Tool</span>
      </header>

      <StepIndicator currentStep={step} steps={STEPS} />

      <main className="app-main">
        {step === 1 && (
          <ZoneFileImport onImport={handleImport} />
        )}

        {step === 2 && parsed && (
          <div className="step-content">
            <FormattedOutput parsed={parsed} />
            <details className="record-details">
              <summary>View Parsed Records ({parsed.records.length})</summary>
              <RecordTable records={parsed.records} />
            </details>
            <div className="step-nav">
              <button className="btn btn-ghost" onClick={() => goToStep(1)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                Next: Lookup NS
              </button>
            </div>
          </div>
        )}

        {step === 3 && parsed && (
          <div className="step-content">
            <NSLookup domain={parsed.origin} onNSFound={handleNSFound} />
            <div className="step-nav">
              <button className="btn btn-ghost" onClick={() => goToStep(2)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(4)}>
                Next: Compare
              </button>
            </div>
          </div>
        )}

        {step === 4 && parsed && (
          <div className="step-content">
            <ComparisonTable
              domain={parsed.origin}
              currentNS={currentNS}
              zoneRecords={parsed.records}
            />
            <div className="step-nav">
              <button className="btn btn-ghost" onClick={() => goToStep(3)}>
                Back
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>ZoneShift &mdash; Umetech MSP</span>
      </footer>
    </div>
  );
}
