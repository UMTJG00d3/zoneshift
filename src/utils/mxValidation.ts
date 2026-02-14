import { dohLookup } from './dnsLookup';

export interface MxHost {
  priority: number;
  hostname: string;
  ips: string[];
  blacklistStatus: BlacklistStatus | null;
  smtpStatus: SmtpStatus | null;
}

export interface BlacklistStatus {
  listed: { name: string; zone: string }[];
  clean: string[];
}

export interface SmtpStatus {
  reachable: boolean;
  banner: string | null;
  supportsStartTLS: boolean;
  error: string | null;
  responseTime: number;
}

export interface MxValidationResult {
  domain: string;
  hosts: MxHost[];
  domainBlacklist: { listed: { name: string; zone: string }[]; clean: string[] } | null;
  findings: MxFinding[];
  overallStatus: 'pass' | 'warn' | 'fail' | 'info';
  timestamp: number;
  apiAvailable: boolean;
}

export interface MxFinding {
  severity: 'pass' | 'warn' | 'fail' | 'info';
  message: string;
}

export async function validateMx(domain: string): Promise<MxValidationResult> {
  const findings: MxFinding[] = [];
  let apiAvailable = true;

  // 1. Look up MX records via DoH
  const mxAnswers = await dohLookup(domain, 'MX');
  const mxRecords = mxAnswers
    .filter(a => a.type === 15)
    .map(a => {
      const parts = a.data.split(/\s+/);
      const priority = parseInt(parts[0], 10) || 0;
      const hostname = (parts[1] || '').replace(/\.$/, '').toLowerCase();
      return { priority, hostname };
    })
    .sort((a, b) => a.priority - b.priority);

  if (mxRecords.length === 0) {
    findings.push({ severity: 'fail', message: 'No MX records found for this domain.' });
    return {
      domain, hosts: [], domainBlacklist: null, findings,
      overallStatus: 'fail', timestamp: Date.now(), apiAvailable: true,
    };
  }

  findings.push({ severity: 'pass', message: `Found ${mxRecords.length} MX record${mxRecords.length > 1 ? 's' : ''}.` });

  // 2. Resolve IPs for each MX host
  const hosts: MxHost[] = [];
  for (const mx of mxRecords) {
    const aAnswers = await dohLookup(mx.hostname, 'A').catch(() => []);
    const ips = aAnswers.filter(a => a.type === 1).map(a => a.data);
    hosts.push({
      priority: mx.priority,
      hostname: mx.hostname,
      ips,
      blacklistStatus: null,
      smtpStatus: null,
    });
  }

  // 3. Check blacklists and SMTP (server-side APIs)
  const allIps = [...new Set(hosts.flatMap(h => h.ips))];

  if (allIps.length > 0) {
    try {
      const blRes = await fetch('/api/email/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ips: allIps, domain }),
      });

      if (blRes.ok) {
        const blData = await blRes.json();

        // Map IP results back to hosts
        const ipMap = new Map<string, BlacklistStatus>();
        for (const r of (blData.ipResults || [])) {
          ipMap.set(r.ip, { listed: r.listed, clean: r.clean });
        }
        for (const host of hosts) {
          const combined: BlacklistStatus = { listed: [], clean: [] };
          for (const ip of host.ips) {
            const status = ipMap.get(ip);
            if (status) {
              combined.listed.push(...status.listed);
              combined.clean.push(...status.clean);
            }
          }
          host.blacklistStatus = combined;
        }

        // Domain blacklist
        const domainBl = blData.domainResult;
        if (domainBl?.listed?.length > 0) {
          findings.push({ severity: 'fail', message: `Domain listed on: ${domainBl.listed.map((l: { name: string }) => l.name).join(', ')}` });
        }

        const listedIPs = hosts.filter(h => h.blacklistStatus && h.blacklistStatus.listed.length > 0);
        if (listedIPs.length > 0) {
          findings.push({
            severity: 'fail',
            message: `${listedIPs.length} MX host${listedIPs.length > 1 ? 's' : ''} found on blacklists.`,
          });
        } else {
          findings.push({ severity: 'pass', message: 'No MX hosts found on blacklists.' });
        }
      } else if (blRes.status === 404) {
        apiAvailable = false;
      }
    } catch {
      apiAvailable = false;
    }
  }

  // 4. SMTP test for primary MX
  if (hosts.length > 0 && hosts[0].ips.length > 0) {
    try {
      const smtpRes = await fetch('/api/email/smtp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ host: hosts[0].hostname }),
      });

      if (smtpRes.ok) {
        const smtpData = await smtpRes.json();
        hosts[0].smtpStatus = {
          reachable: smtpData.reachable,
          banner: smtpData.banner,
          supportsStartTLS: smtpData.supportsStartTLS,
          error: smtpData.error,
          responseTime: smtpData.responseTime,
        };

        if (smtpData.reachable) {
          findings.push({ severity: 'pass', message: `Primary MX responds (${smtpData.responseTime}ms).` });
          if (!smtpData.supportsStartTLS) {
            findings.push({ severity: 'warn', message: 'Primary MX does not advertise STARTTLS.' });
          }
        } else {
          findings.push({ severity: 'warn', message: `Primary MX not reachable: ${smtpData.error || 'unknown'}` });
        }
      } else if (smtpRes.status === 404) {
        apiAvailable = false;
      }
    } catch {
      apiAvailable = false;
    }
  }

  if (!apiAvailable) {
    findings.push({ severity: 'info', message: 'Blacklist and SMTP APIs not deployed yet. Deploy Azure Functions for full validation.' });
  }

  const overallStatus = findings.some(f => f.severity === 'fail') ? 'fail' as const
    : findings.some(f => f.severity === 'warn') ? 'warn' as const : 'pass' as const;

  return {
    domain, hosts,
    domainBlacklist: null, // Set from API response above if available
    findings, overallStatus,
    timestamp: Date.now(), apiAvailable,
  };
}
