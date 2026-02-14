import { useState, useEffect } from 'react';
import { navigate } from '../../utils/router';
import { useCredentials } from '../../context/CredentialsContext';
import RecordManager from '../RecordManager';
import SecurityScanner from '../SecurityScanner';
import EmailHealthPanel, { getEmailHealthSummary } from '../domain/EmailHealthPanel';
import SSLPanel from '../domain/SSLPanel';
import BlacklistPanel from '../domain/BlacklistPanel';
import type { EmailHealthResult, Severity } from '../../utils/emailAuthValidation';
import type { SSLCheckResult } from '../../utils/sslCheck';
import type { MxValidationResult } from '../../utils/mxValidation';
import { calculateHealthScore } from '../../utils/healthScore';
import { HealthScoreDetail } from '../common/HealthScore';
import { fetchDomainScanResult, fetchDomainHistory, formatScanAge, type StoredScanResult } from '../../utils/scanResults';

type SubTab = 'overview' | 'records' | 'security' | 'email' | 'ssl';

interface DomainDetailPageProps {
  domain: string;
}

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'records', label: 'Records' },
  { key: 'security', label: 'Security' },
  { key: 'email', label: 'Email Health' },
  { key: 'ssl', label: 'SSL' },
];

export default function DomainDetailPage({ domain }: DomainDetailPageProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('overview');
  const { credentials, loading: credsLoading } = useCredentials();
  const [emailHealth, setEmailHealth] = useState<EmailHealthResult | null>(null);
  const [sslResult, setSSLResult] = useState<SSLCheckResult | null>(null);
  const [mxResult, setMxResult] = useState<MxValidationResult | null>(null);
  const [storedScan, setStoredScan] = useState<StoredScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<StoredScanResult[]>([]);

  useEffect(() => {
    fetchDomainScanResult(domain).then(setStoredScan);
    fetchDomainHistory(domain).then(setScanHistory);
  }, [domain]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/domains')}
        >
          &larr; Back
        </button>
        <h2 className="text-xl font-semibold">{domain}</h2>
        <span className="text-text-muted text-xs">&mdash;</span>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-surface border border-border rounded-lg">
        {SUB_TABS.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-btn-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <OverviewTab domain={domain} emailHealth={emailHealth} sslResult={sslResult} mxResult={mxResult} storedScan={storedScan} scanHistory={scanHistory} onNavigateTab={setActiveTab} />
        )}

        {activeTab === 'records' && (
          <div>
            {credsLoading ? (
              <p className="text-text-muted">Loading credentials...</p>
            ) : !credentials ? (
              <div className="bg-surface border border-border rounded-lg p-4 text-text-secondary">
                No Constellix credentials configured.{' '}
                <a href="#/settings" className="text-accent-blue underline">Go to Settings</a>{' '}
                to add your API keys.
              </div>
            ) : (
              <RecordManager domain={domain} credentials={credentials} />
            )}
          </div>
        )}

        {activeTab === 'security' && (
          <SecurityScanner presetDomain={domain} />
        )}

        {activeTab === 'email' && (
          <div className="flex flex-col gap-6">
            <EmailHealthPanel domain={domain} onResult={setEmailHealth} />
            <BlacklistPanel domain={domain} onResult={setMxResult} />
          </div>
        )}

        {activeTab === 'ssl' && (
          <SSLPanel domain={domain} onResult={setSSLResult} />
        )}
      </div>
    </div>
  );
}

function severityColor(severity: Severity): string {
  switch (severity) {
    case 'pass': return 'text-accent-green';
    case 'warn': return 'text-accent-yellow';
    case 'fail': return 'text-accent-red';
    case 'info': return 'text-text-muted';
  }
}

function sslSeverity(result: SSLCheckResult | null): Severity {
  if (!result) return 'info';
  switch (result.status) {
    case 'valid': return 'pass';
    case 'expiring': return 'warn';
    case 'critical': case 'expired': case 'error': return 'fail';
    default: return 'info';
  }
}

function mxSeverity(result: MxValidationResult | null): { status: Severity; label: string } {
  if (!result) return { status: 'info', label: 'Not scanned' };
  return { status: result.overallStatus as Severity, label: result.hosts.length > 0 ? `${result.hosts.length} MX` : 'No MX' };
}

function OverviewTab({ domain, emailHealth, sslResult, mxResult, storedScan, scanHistory, onNavigateTab }: {
  domain: string;
  emailHealth: EmailHealthResult | null;
  sslResult: SSLCheckResult | null;
  mxResult: MxValidationResult | null;
  storedScan: StoredScanResult | null;
  scanHistory: StoredScanResult[];
  onNavigateTab: (tab: SubTab) => void;
}) {
  const emailSummary = getEmailHealthSummary(emailHealth);
  const blSummary = mxSeverity(mxResult);
  const hasLiveData = emailHealth || sslResult || mxResult;
  const breakdown = hasLiveData ? calculateHealthScore(emailHealth, sslResult, mxResult) : null;

  // Use stored scan data for status cards when live data hasn't loaded yet
  const statusCards: { label: string; status: string; severity: Severity; tab?: SubTab }[] = hasLiveData ? [
    { label: 'SPF', status: emailSummary.spf.label, severity: emailSummary.spf.status, tab: 'email' },
    { label: 'DKIM', status: emailSummary.dkim.label, severity: emailSummary.dkim.status, tab: 'email' },
    { label: 'DMARC', status: emailSummary.dmarc.label, severity: emailSummary.dmarc.status, tab: 'email' },
    {
      label: 'SSL',
      status: sslResult ? sslResult.statusLabel : 'Not scanned',
      severity: sslSeverity(sslResult),
      tab: 'ssl',
    },
    { label: 'Blacklist', status: blSummary.label, severity: blSummary.status, tab: 'email' },
  ] : storedScan ? [
    { label: 'SPF', status: storedScan.spfFound ? storedScan.spfQualifier : 'Not found', severity: storedScan.spfStatus as Severity, tab: 'email' as SubTab },
    { label: 'DKIM', status: 'Run live scan', severity: 'info' as Severity, tab: 'email' as SubTab },
    { label: 'DMARC', status: storedScan.dmarcFound ? (storedScan.dmarcPolicy || 'Found') : 'Not found', severity: storedScan.dmarcStatus as Severity, tab: 'email' as SubTab },
    { label: 'SSL', status: storedScan.sslStatus, severity: storedScan.sslStatus === 'valid' ? 'pass' as Severity : storedScan.sslStatus === 'expiring' ? 'warn' as Severity : 'fail' as Severity, tab: 'ssl' as SubTab },
    { label: 'MX', status: storedScan.mxCount > 0 ? `${storedScan.mxCount} records` : 'None', severity: storedScan.mxCount > 0 ? 'pass' as Severity : 'warn' as Severity, tab: 'email' as SubTab },
  ] : [
    { label: 'SPF', status: 'Not scanned', severity: 'info' as Severity, tab: 'email' as SubTab },
    { label: 'DKIM', status: 'Not scanned', severity: 'info' as Severity, tab: 'email' as SubTab },
    { label: 'DMARC', status: 'Not scanned', severity: 'info' as Severity, tab: 'email' as SubTab },
    { label: 'SSL', status: 'Not scanned', severity: 'info' as Severity, tab: 'ssl' as SubTab },
    { label: 'Blacklist', status: 'Not scanned', severity: 'info' as Severity, tab: 'email' as SubTab },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Health Score — live or stored */}
      {breakdown ? (
        <HealthScoreDetail breakdown={breakdown} />
      ) : storedScan ? (
        <div className="bg-surface border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <div className={`text-3xl font-bold ${storedScan.healthScore >= 70 ? 'text-accent-green' : storedScan.healthScore >= 50 ? 'text-accent-yellow' : 'text-accent-red'}`}>
                {storedScan.healthScore}
              </div>
              <div className="text-text-muted text-xs">Health Score</div>
            </div>
            <div className="text-text-secondary text-sm">
              <div>From automated scan {formatScanAge(storedScan.scannedAt)}</div>
              <div className="text-text-muted text-xs mt-1">Navigate to tabs for live results</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg p-4 shadow-sm text-text-muted text-sm">
          No scan data available. Visit the Email Health or SSL tabs to run a live scan.
        </div>
      )}

      {/* Status cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statusCards.map(card => {
          const accentBorder = card.severity === 'pass' ? 'border-l-accent-green'
            : card.severity === 'warn' ? 'border-l-accent-yellow'
            : card.severity === 'fail' ? 'border-l-accent-red'
            : 'border-l-accent-blue';
          return (
            <div
              key={card.label}
              className={`bg-surface border border-border border-l-4 ${accentBorder} rounded-lg p-3 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.3)] transition-all duration-200 ${card.tab ? 'cursor-pointer hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.4)] hover:-translate-y-px' : ''}`}
              onClick={() => card.tab && onNavigateTab(card.tab)}
            >
              <div className="text-text-muted text-[10px] font-semibold uppercase tracking-wider mb-1.5">
                {card.label}
              </div>
              <div className={`text-sm font-medium ${severityColor(card.severity)}`}>
                {card.status ?? card.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Score history trend */}
      {scanHistory.length > 1 && (
        <div className="bg-surface border border-border rounded-lg p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">Score History</h3>
          <div className="flex items-end gap-1 h-16">
            {scanHistory.slice(0, 14).reverse().map((scan, i) => {
              const height = Math.max(4, (scan.healthScore / 100) * 100);
              const color = scan.healthScore >= 70 ? 'bg-accent-green' : scan.healthScore >= 50 ? 'bg-accent-yellow' : 'bg-accent-red';
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t ${color} opacity-80 hover:opacity-100 transition-opacity`}
                  style={{ height: `${height}%` }}
                  title={`${scan.healthScore} — ${new Date(scan.scannedAt).toLocaleDateString()}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-text-muted text-[10px] mt-1">
            <span>{scanHistory.length > 1 ? formatScanAge(scanHistory[scanHistory.length - 1].scannedAt) : ''}</span>
            <span>{formatScanAge(scanHistory[0].scannedAt)}</span>
          </div>
        </div>
      )}

      {/* Domain info */}
      <div className="bg-surface border border-border rounded-lg p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-2">Domain Info</h3>
        <div className="text-text-secondary text-sm">
          <span className="font-mono">{domain}</span>
          {storedScan && (
            <span className="text-text-muted text-xs ml-3">Last automated scan: {new Date(storedScan.scannedAt).toLocaleString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}


