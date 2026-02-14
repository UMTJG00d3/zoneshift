import { useState } from 'react';
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
          <OverviewTab domain={domain} emailHealth={emailHealth} sslResult={sslResult} mxResult={mxResult} onNavigateTab={setActiveTab} />
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

function OverviewTab({ domain, emailHealth, sslResult, mxResult, onNavigateTab }: {
  domain: string;
  emailHealth: EmailHealthResult | null;
  sslResult: SSLCheckResult | null;
  mxResult: MxValidationResult | null;
  onNavigateTab: (tab: SubTab) => void;
}) {
  const emailSummary = getEmailHealthSummary(emailHealth);
  const blSummary = mxSeverity(mxResult);
  const hasAnyData = emailHealth || sslResult || mxResult;
  const breakdown = hasAnyData ? calculateHealthScore(emailHealth, sslResult, mxResult) : null;

  const statusCards: { label: string; status: string; severity: Severity; tab?: SubTab }[] = [
    { label: 'SPF', ...emailSummary.spf, tab: 'email' },
    { label: 'DKIM', ...emailSummary.dkim, tab: 'email' },
    { label: 'DMARC', ...emailSummary.dmarc, tab: 'email' },
    {
      label: 'SSL',
      status: sslResult ? sslResult.statusLabel : 'Not scanned',
      severity: sslSeverity(sslResult),
      tab: 'ssl',
    },
    { label: 'Blacklist', status: blSummary.label, severity: blSummary.status, tab: 'email' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Health Score */}
      <HealthScoreDetail breakdown={breakdown} />

      {/* Status cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statusCards.map(card => (
          <div
            key={card.label}
            className={`bg-surface border border-border rounded-lg p-4 ${card.tab ? 'cursor-pointer hover:border-accent-blue/50 transition-colors' : ''}`}
            onClick={() => card.tab && onNavigateTab(card.tab)}
          >
            <div className="text-text-secondary text-xs font-semibold uppercase tracking-wide mb-2">
              {card.label}
            </div>
            <div className={`text-sm font-medium ${severityColor(card.severity)}`}>
              {card.status ?? card.label}
            </div>
          </div>
        ))}
      </div>

      {/* Quick info */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-2">Domain Info</h3>
        <div className="text-text-secondary text-sm">
          <span className="font-mono">{domain}</span>
        </div>
      </div>
    </div>
  );
}


