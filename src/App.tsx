import { useState, useEffect } from 'react';
import StepIndicator from './components/StepIndicator';
import ZoneFileImport from './components/ZoneFileImport';
import RecordTable from './components/RecordTable';
import FormattedOutput from './components/FormattedOutput';
import NSLookup from './components/NSLookup';
import ComparisonTable from './components/ComparisonTable';
import ConstellixPush from './components/ConstellixPush';
import DomainManager from './components/DomainManager';
import BulkChanges from './components/BulkChanges';
import DomainBrowser from './components/DomainBrowser';
import SecurityScanner from './components/SecurityScanner';
import Settings from './components/Settings';
import { parseZoneFile, ParsedZone } from './utils/zoneParser';
import { exportForOversite } from './utils/oversiteExport';

const STEPS = [
  'Import Zone File',
  'Review & Export',
  'Current NS',
  'Compare',
  'Push to Constellix',
];

type AppTab = 'import' | 'domains' | 'bulk-changes' | 'security-scan' | 'settings';
type AppMode = 'import' | 'manage';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('import');
  const [mode, setMode] = useState<AppMode>('import');
  const [step, setStep] = useState(1);

  // Handle navigation events from child components
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail && ['import', 'domains', 'bulk-changes', 'security-scan', 'settings'].includes(customEvent.detail)) {
        setActiveTab(customEvent.detail as AppTab);
      }
    };
    window.addEventListener('navigate-tab', handleNavigate);
    return () => window.removeEventListener('navigate-tab', handleNavigate);
  }, []);
  const [parsed, setParsed] = useState<ParsedZone | null>(null);
  const [currentNS, setCurrentNS] = useState<string[]>([]);
  const [manageDomain, setManageDomain] = useState('');

  function handleImport(content: string) {
    const result = parseZoneFile(content);
    setParsed(result);
    setStep(2);
  }

  function handleManageDomain(domain: string) {
    setManageDomain(domain);
    setMode('manage');
  }

  function handleBackToStart() {
    setMode('import');
    setStep(1);
    setParsed(null);
    setManageDomain('');
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
    if (target === 5 && parsed) setStep(5);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo">Z</span>
          ZoneShift
        </h1>
        <span className="header-subtitle">DNS Migration &amp; Management</span>
      </header>

      {/* Tab Navigation */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'import' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Import &amp; Compare
        </button>
        <button
          className={`tab-btn ${activeTab === 'domains' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('domains')}
        >
          Domains
        </button>
        <button
          className={`tab-btn ${activeTab === 'bulk-changes' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('bulk-changes')}
        >
          Bulk Changes
        </button>
        <button
          className={`tab-btn ${activeTab === 'security-scan' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('security-scan')}
        >
          Security Scan
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      {activeTab === 'import' && mode === 'import' && <StepIndicator currentStep={step} steps={STEPS} />}

      <main className="app-main">
        {/* Domains Tab */}
        {activeTab === 'domains' && <DomainBrowser />}

        {/* Bulk Changes Tab */}
        {activeTab === 'bulk-changes' && <BulkChanges />}

        {/* Security Scan Tab */}
        {activeTab === 'security-scan' && <SecurityScanner />}

        {/* Settings Tab */}
        {activeTab === 'settings' && <Settings />}

        {/* Import Tab */}
        {activeTab === 'import' && mode === 'manage' && (
          <DomainManager domain={manageDomain} onBack={handleBackToStart} />
        )}

        {activeTab === 'import' && mode === 'import' && step === 1 && (
          <ZoneFileImport onImport={handleImport} onManageDomain={handleManageDomain} />
        )}

        {activeTab === 'import' && mode === 'import' && step === 2 && parsed && (
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
              <div className="step-nav-right">
                <button className="btn btn-secondary" onClick={() => setStep(5)}>
                  Push to Constellix
                </button>
                <button className="btn btn-primary" onClick={() => setStep(3)}>
                  Next: Lookup NS
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'import' && mode === 'import' && step === 3 && parsed && (
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

        {activeTab === 'import' && mode === 'import' && step === 4 && parsed && (
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
              <button className="btn btn-secondary" onClick={() => setStep(5)}>
                Push to Constellix
              </button>
            </div>
          </div>
        )}

        {activeTab === 'import' && mode === 'import' && step === 5 && parsed && (
          <div className="step-content">
            <ConstellixPush domain={parsed.origin} records={parsed.records} />
            <div className="step-nav">
              <button className="btn btn-ghost" onClick={() => goToStep(2)}>
                Back to Review
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <span>ZoneShift &mdash; Umetech MSP</span>
        <button className="btn btn-ghost btn-sm export-btn" onClick={exportForOversite}>
          Export for Over-Site
        </button>
      </footer>
    </div>
  );
}
