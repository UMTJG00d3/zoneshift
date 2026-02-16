import { useState, useEffect, useMemo } from 'react';
import { ConstellixDomain, listDomains } from '../../utils/constellixApi';
import { dohLookup } from '../../utils/dnsLookup';
import { useCredentials } from '../../context/CredentialsContext';
import { navigate } from '../../utils/router';
import { validateSpf, validateDmarc, type Severity } from '../../utils/emailAuthValidation';
import { fetchAllScanResults, formatScanAge, type StoredScanResult } from '../../utils/scanResults';
import { HealthScoreBadge } from '../common/HealthScore';
import { Search, RefreshCw, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';

interface DomainNSInfo {
  nameservers: string[];
  isConstellix: boolean;
  loading: boolean;
  error?: string;
}

interface DomainEmailQuick {
  spf: Severity;
  dmarc: Severity;
  overall: Severity;
  loading: boolean;
}

export default function DomainsPage() {
  const { credentials, loading: credsLoading } = useCredentials();
  const [domains, setDomains] = useState<ConstellixDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [nsInfo, setNsInfo] = useState<Record<string, DomainNSInfo>>({});
  const [loadingNS, setLoadingNS] = useState(false);
  const [emailHealth, setEmailHealth] = useState<Record<string, DomainEmailQuick>>({});
  const [storedScans, setStoredScans] = useState<Record<string, StoredScanResult>>({});
  const [scansLoaded, setScansLoaded] = useState(false);

  useEffect(() => {
    fetchAllScanResults().then(results => {
      const map: Record<string, StoredScanResult> = {};
      for (const r of results) map[r.domain] = r;
      setStoredScans(map);
      setScansLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (credentials) {
      loadDomains();
    }
  }, [credentials]);

  async function loadDomains() {
    if (!credentials) return;
    setLoading(true);
    setError(null);

    const result = await listDomains(credentials);
    if (result.error) {
      setError(result.error);
    } else {
      const sorted = result.domains.sort((a, b) => a.name.localeCompare(b.name));
      setDomains(sorted);
      loadAllNSRecords(sorted);
    }
    setLoading(false);
  }

  async function loadAllNSRecords(domainList: ConstellixDomain[]) {
    setLoadingNS(true);
    const initial: Record<string, DomainNSInfo> = {};
    domainList.forEach(d => {
      initial[d.name] = { nameservers: [], isConstellix: false, loading: true };
    });
    setNsInfo(initial);

    const batchSize = 5;
    for (let i = 0; i < domainList.length; i += batchSize) {
      const batch = domainList.slice(i, i + batchSize);
      await Promise.all(batch.map(async (domain) => {
        try {
          const answers = await dohLookup(domain.name, 'NS');
          const nameservers = answers.map(a => a.data.toLowerCase().replace(/\.$/, ''));
          const isConstellix = nameservers.some(ns =>
            ns.includes('constellix.com') || ns.includes('constellix.net')
          );
          setNsInfo(prev => ({
            ...prev,
            [domain.name]: { nameservers, isConstellix, loading: false }
          }));
        } catch (err) {
          setNsInfo(prev => ({
            ...prev,
            [domain.name]: {
              nameservers: [], isConstellix: false, loading: false,
              error: (err as Error).message
            }
          }));
        }
      }));
      if (i + batchSize < domainList.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    setLoadingNS(false);
    loadEmailHealth(domainList);
  }

  async function loadEmailHealth(domainList: ConstellixDomain[]) {
    const initial: Record<string, DomainEmailQuick> = {};
    domainList.forEach(d => {
      initial[d.name] = { spf: 'info', dmarc: 'info', overall: 'info', loading: true };
    });
    setEmailHealth(initial);

    const batchSize = 3;
    for (let i = 0; i < domainList.length; i += batchSize) {
      const batch = domainList.slice(i, i + batchSize);
      await Promise.all(batch.map(async (domain) => {
        try {
          const [spf, dmarc] = await Promise.all([
            validateSpf(domain.name),
            validateDmarc(domain.name),
          ]);
          const overall: Severity = [spf.status, dmarc.status].includes('fail') ? 'fail'
            : [spf.status, dmarc.status].includes('warn') ? 'warn' : 'pass';
          setEmailHealth(prev => ({
            ...prev,
            [domain.name]: { spf: spf.status, dmarc: dmarc.status, overall, loading: false }
          }));
        } catch {
          setEmailHealth(prev => ({
            ...prev,
            [domain.name]: { spf: 'info', dmarc: 'info', overall: 'info', loading: false }
          }));
        }
      }));
      if (i + batchSize < domainList.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  const filteredDomains = useMemo(() =>
    domains.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [domains, searchTerm]
  );

  if (credsLoading) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">Domains</h2>
        <p className="text-muted-foreground">Loading credentials...</p>
      </div>
    );
  }

  if (!credentials) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-4 text-foreground">Domains</h2>
        <Card className="p-4">
          <p className="text-muted-foreground">
            No Constellix credentials configured.{' '}
            <a href="#/settings" className="text-primary underline">Go to Settings</a>{' '}
            to add your API keys.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage DNS records and monitor domain health</p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center gap-2">
          <Button variant="outline" onClick={loadDomains} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button asChild>
            <a href="#/migrate" className="no-underline">
              <Plus className="h-4 w-4 mr-2" />
              Add Domain
            </a>
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search domains..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </Card>

      {loadingNS && <p className="text-muted-foreground text-xs">Checking NS records...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {loading && domains.length === 0 && (
        <p className="text-muted-foreground">Loading domains...</p>
      )}

      {!loading && domains.length === 0 && !error && (
        <p className="text-muted-foreground">No domains found in your Constellix account.</p>
      )}

      {filteredDomains.length > 0 && (
        <div>
          {searchTerm && (
            <div className="mb-2 text-sm text-muted-foreground">
              {filteredDomains.length} of {domains.length} domains shown
            </div>
          )}
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Nameservers</TableHead>
                  <TableHead>DNS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDomains.map(domain => {
                  const ns = nsInfo[domain.name];
                  const scan = storedScans[domain.name];
                  return (
                    <TableRow
                      key={domain.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/domains/${encodeURIComponent(domain.name)}`)}
                    >
                      <TableCell>
                        <span className="font-medium text-foreground">{domain.name}</span>
                        {scan && (
                          <span className="text-muted-foreground text-[10px] ml-2" title={`Last scan: ${scan.scannedAt}`}>
                            {formatScanAge(scan.scannedAt)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {scan ? (
                          <HealthScoreBadge score={scan.healthScore} size="sm" />
                        ) : scansLoaded ? (
                          <span className="text-muted-foreground text-xs">&mdash;</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">...</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={domain.status.toLowerCase() === 'active' ? 'success' : 'secondary'}>
                          {domain.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <EmailQuickBadge info={emailHealth[domain.name]} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {ns?.loading ? (
                          <span className="text-muted-foreground">checking...</span>
                        ) : ns?.error ? (
                          <span className="text-destructive" title={ns.error}>error</span>
                        ) : ns?.nameservers.length ? (
                          <span title={ns.nameservers.join('\n')}>
                            {ns.nameservers[0]}
                            {ns.nameservers.length > 1 && (
                              <span className="ml-1 text-muted-foreground">+{ns.nameservers.length - 1}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ns?.loading ? (
                          <Badge variant="secondary">...</Badge>
                        ) : ns?.isConstellix ? (
                          <Badge variant="success">LIVE</Badge>
                        ) : ns?.nameservers.length ? (
                          <Badge variant="warning">NOT POINTED</Badge>
                        ) : (
                          <Badge variant="secondary">?</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

function EmailQuickBadge({ info }: { info?: DomainEmailQuick }) {
  if (!info || info.loading) {
    return <span className="text-muted-foreground text-xs">...</span>;
  }

  const variantMap: Record<Severity, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    pass: 'success',
    warn: 'warning',
    fail: 'destructive',
    info: 'secondary',
  };

  const iconMap: Record<Severity, string> = {
    pass: '✓', warn: '⚠', fail: '✗', info: '—',
  };

  return (
    <Badge
      variant={variantMap[info.overall]}
      title={`SPF: ${info.spf}, DMARC: ${info.dmarc}`}
    >
      {iconMap[info.overall]}
    </Badge>
  );
}
