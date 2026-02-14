import { AzureFunction, Context, HttpRequest } from '@azure/functions';
import * as dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

const DNSBL_LISTS = [
  { name: 'Spamhaus ZEN', zone: 'zen.spamhaus.org' },
  { name: 'Barracuda', zone: 'b.barracudacentral.org' },
  { name: 'SpamCop', zone: 'bl.spamcop.net' },
  { name: 'CBL', zone: 'cbl.abuseat.org' },
  { name: 'SORBS', zone: 'dnsbl.sorbs.net' },
];

const DOMAIN_BL_LISTS = [
  { name: 'Spamhaus DBL', zone: 'dbl.spamhaus.org' },
  { name: 'SURBL', zone: 'multi.surbl.org' },
  { name: 'URIBL', zone: 'multi.uribl.com' },
];

function reverseIP(ip: string): string {
  return ip.split('.').reverse().join('.');
}

interface BlacklistResult {
  ip: string;
  listed: { name: string; zone: string }[];
  clean: string[];
  error?: string;
}

interface DomainBlacklistResult {
  domain: string;
  listed: { name: string; zone: string }[];
  clean: string[];
}

async function checkIP(ip: string): Promise<BlacklistResult> {
  const reversed = reverseIP(ip);
  const listed: { name: string; zone: string }[] = [];
  const clean: string[] = [];

  await Promise.all(
    DNSBL_LISTS.map(async (bl) => {
      try {
        await resolve4(`${reversed}.${bl.zone}`);
        listed.push({ name: bl.name, zone: bl.zone });
      } catch {
        // NXDOMAIN = not listed
        clean.push(bl.name);
      }
    })
  );

  return { ip, listed, clean };
}

async function checkDomain(domain: string): Promise<DomainBlacklistResult> {
  const listed: { name: string; zone: string }[] = [];
  const clean: string[] = [];

  await Promise.all(
    DOMAIN_BL_LISTS.map(async (bl) => {
      try {
        await resolve4(`${domain}.${bl.zone}`);
        listed.push({ name: bl.name, zone: bl.zone });
      } catch {
        clean.push(bl.name);
      }
    })
  );

  return { domain, listed, clean };
}

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  const { ips, domain } = req.body || {};

  if (!ips && !domain) {
    context.res = { status: 400, body: { error: 'Provide "ips" array and/or "domain" string' } };
    return;
  }

  const results: { ipResults: BlacklistResult[]; domainResult: DomainBlacklistResult | null } = {
    ipResults: [],
    domainResult: null,
  };

  if (Array.isArray(ips) && ips.length > 0) {
    // Limit to 10 IPs to prevent abuse
    const toCheck = ips.slice(0, 10).filter((ip: unknown) => typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip as string));
    results.ipResults = await Promise.all(toCheck.map((ip: string) => checkIP(ip)));
  }

  if (domain && typeof domain === 'string') {
    results.domainResult = await checkDomain(domain);
  }

  context.res = { status: 200, body: results };
};

export default httpTrigger;
