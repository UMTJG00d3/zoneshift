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
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { cn } from '../../lib/utils';

interface DomainDetailPageProps {
  domain: string;
}

export default function DomainDetailPage({ domain }: DomainDetailPageProps) {
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/domains')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{domain}</h1>
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="email">Email Health</TabsTrigger>
          <TabsTrigger value="ssl">SSL</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab domain={domain} emailHealth={emailHealth} sslResult={sslResult} mxResult={mxResult} storedScan={storedScan} scanHistory={scanHistory} />
        </TabsContent>

        <TabsContent value="records">
          {credsLoading ? (
            <p className="text-muted-foreground">Loading credentials...</p>
          ) : !credentials ? (
            <Card className="p-4">
              <p className="text-muted-foreground">
                No Constellix credentials configured.{' '}
                <a href="#/settings" className="text-primary underline">Go to Settings</a>{' '}
                to add your API keys.
              </p>
            </Card>
          ) : (
            <RecordManager domain={domain} credentials={credentials} />
          )}
        </TabsContent>

        <TabsContent value="security">
          <SecurityScanner presetDomain={domain} />
        </TabsContent>

        <TabsContent value="email">
          <div className="flex flex-col gap-6">
            <EmailHealthPanel domain={domain} onResult={setEmailHealth} />
            <BlacklistPanel domain={domain} onResult={setMxResult} />
          </div>
        </TabsContent>

        <TabsContent value="ssl">
          <SSLPanel domain={domain} onResult={setSSLResult} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function severityColor(severity: Severity): string {
  switch (severity) {
    case 'pass': return 'text-emerald-600 dark:text-emerald-400';
    case 'warn': return 'text-amber-600 dark:text-amber-400';
    case 'fail': return 'text-red-600 dark:text-red-400';
    case 'info': return 'text-muted-foreground';
  }
}

function severityVariant(severity: Severity): 'success' | 'warning' | 'destructive' | 'info' {
  switch (severity) {
    case 'pass': return 'success';
    case 'warn': return 'warning';
    case 'fail': return 'destructive';
    case 'info': return 'info';
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

function OverviewTab({ domain, emailHealth, sslResult, mxResult, storedScan, scanHistory }: {
  domain: string;
  emailHealth: EmailHealthResult | null;
  sslResult: SSLCheckResult | null;
  mxResult: MxValidationResult | null;
  storedScan: StoredScanResult | null;
  scanHistory: StoredScanResult[];
}) {
  const emailSummary = getEmailHealthSummary(emailHealth);
  const blSummary = mxSeverity(mxResult);
  const hasLiveData = emailHealth || sslResult || mxResult;
  const breakdown = hasLiveData ? calculateHealthScore(emailHealth, sslResult, mxResult) : null;

  const statusCards: { label: string; status: string; severity: Severity }[] = hasLiveData ? [
    { label: 'SPF', status: emailSummary.spf.label, severity: emailSummary.spf.status },
    { label: 'DKIM', status: emailSummary.dkim.label, severity: emailSummary.dkim.status },
    { label: 'DMARC', status: emailSummary.dmarc.label, severity: emailSummary.dmarc.status },
    { label: 'SSL', status: sslResult ? sslResult.statusLabel : 'Not scanned', severity: sslSeverity(sslResult) },
    { label: 'Blacklist', status: blSummary.label, severity: blSummary.status },
  ] : storedScan ? [
    { label: 'SPF', status: storedScan.spfFound ? storedScan.spfQualifier : 'Not found', severity: storedScan.spfStatus as Severity },
    { label: 'DKIM', status: 'Run live scan', severity: 'info' as Severity },
    { label: 'DMARC', status: storedScan.dmarcFound ? (storedScan.dmarcPolicy || 'Found') : 'Not found', severity: storedScan.dmarcStatus as Severity },
    { label: 'SSL', status: storedScan.sslStatus, severity: storedScan.sslStatus === 'valid' ? 'pass' as Severity : storedScan.sslStatus === 'expiring' ? 'warn' as Severity : 'fail' as Severity },
    { label: 'MX', status: storedScan.mxCount > 0 ? `${storedScan.mxCount} records` : 'None', severity: storedScan.mxCount > 0 ? 'pass' as Severity : 'warn' as Severity },
  ] : [
    { label: 'SPF', status: 'Not scanned', severity: 'info' as Severity },
    { label: 'DKIM', status: 'Not scanned', severity: 'info' as Severity },
    { label: 'DMARC', status: 'Not scanned', severity: 'info' as Severity },
    { label: 'SSL', status: 'Not scanned', severity: 'info' as Severity },
    { label: 'Blacklist', status: 'Not scanned', severity: 'info' as Severity },
  ];

  return (
    <div className="flex flex-col gap-6 mt-4">
      {/* Health Score */}
      {breakdown ? (
        <HealthScoreDetail breakdown={breakdown} />
      ) : storedScan ? (
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <div className={cn(
                "text-3xl font-bold",
                storedScan.healthScore >= 70 ? 'text-emerald-500' : storedScan.healthScore >= 50 ? 'text-amber-500' : 'text-red-500'
              )}>
                {storedScan.healthScore}
              </div>
              <div className="text-muted-foreground text-xs">Health Score</div>
            </div>
            <div className="text-muted-foreground text-sm">
              <div>From automated scan {formatScanAge(storedScan.scannedAt)}</div>
              <div className="text-xs mt-1">Navigate to tabs for live results</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">
            No scan data available. Visit the Email Health or SSL tabs to run a live scan.
          </p>
        </Card>
      )}

      {/* Status cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statusCards.map(card => (
          <Card
            key={card.label}
            className={cn(
              "p-3 border-l-4 hover-lift cursor-default",
              card.severity === 'pass' ? 'border-l-emerald-500' :
              card.severity === 'warn' ? 'border-l-amber-500' :
              card.severity === 'fail' ? 'border-l-red-500' :
              'border-l-primary'
            )}
          >
            <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1.5">
              {card.label}
            </div>
            <div className={cn("text-sm font-medium", severityColor(card.severity))}>
              {card.status ?? card.label}
            </div>
          </Card>
        ))}
      </div>

      {/* Score history trend */}
      {scanHistory.length > 1 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 text-foreground">Score History</h3>
          <div className="flex items-end gap-1 h-16">
            {scanHistory.slice(0, 14).reverse().map((scan, i) => {
              const height = Math.max(4, (scan.healthScore / 100) * 100);
              const color = scan.healthScore >= 70 ? 'bg-emerald-500' : scan.healthScore >= 50 ? 'bg-amber-500' : 'bg-red-500';
              return (
                <div
                  key={i}
                  className={cn("flex-1 rounded-t opacity-80 hover:opacity-100 transition-opacity", color)}
                  style={{ height: `${height}%` }}
                  title={`${scan.healthScore} — ${new Date(scan.scannedAt).toLocaleDateString()}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-muted-foreground text-[10px] mt-1">
            <span>{scanHistory.length > 1 ? formatScanAge(scanHistory[scanHistory.length - 1].scannedAt) : ''}</span>
            <span>{formatScanAge(scanHistory[0].scannedAt)}</span>
          </div>
        </Card>
      )}

      {/* Domain info */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2 text-foreground">Domain Info</h3>
        <div className="text-muted-foreground text-sm">
          <span className="font-mono">{domain}</span>
          {storedScan && (
            <span className="text-xs ml-3">Last automated scan: {new Date(storedScan.scannedAt).toLocaleString()}</span>
          )}
        </div>
      </Card>
    </div>
  );
}
