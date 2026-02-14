import { useState, useEffect } from 'react';
import MigrateView from './components/MigrateView';
import DomainBrowser from './components/DomainBrowser';
import SecurityScanner from './components/SecurityScanner';
import Settings from './components/Settings';
import { exportForOversite } from './utils/oversiteExport';

type AppTab = 'migrate' | 'domains' | 'security' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('migrate');

  // Handle navigation events from child components
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const tab = customEvent.detail;
      if (tab === 'settings' || tab === 'domains' || tab === 'security' || tab === 'migrate') {
        setActiveTab(tab as AppTab);
      }
    };
    window.addEventListener('navigate-tab', handleNavigate);
    return () => window.removeEventListener('navigate-tab', handleNavigate);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo">Z</span>
          ZoneShift
        </h1>
        <span className="header-subtitle">DNS Migration &amp; Management</span>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'migrate' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('migrate')}
        >
          Migrate
        </button>
        <button
          className={`tab-btn ${activeTab === 'domains' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('domains')}
        >
          Domains
        </button>
        <button
          className={`tab-btn ${activeTab === 'security' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          Security
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'tab-btn-active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'migrate' && <MigrateView />}
        {activeTab === 'domains' && <DomainBrowser />}
        {activeTab === 'security' && <SecurityScanner />}
        {activeTab === 'settings' && <Settings />}
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
