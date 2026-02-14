import type { EmailHealthResult } from './emailAuthValidation';
import type { SSLCheckResult } from './sslCheck';
import type { MxValidationResult } from './mxValidation';

export interface HealthScoreBreakdown {
  total: number;
  spf: number;       // max 20
  dkim: number;      // max 15
  dmarc: number;     // max 20
  ssl: number;       // max 20
  blacklist: number;  // max 15
  security: number;   // max 10
  maxPossible: number;
  components: { label: string; score: number; max: number }[];
}

export function calculateHealthScore(
  email: EmailHealthResult | null,
  ssl: SSLCheckResult | null,
  mx: MxValidationResult | null,
  securityIssueCount?: number,
): HealthScoreBreakdown {
  let spf = 0, dkim = 0, dmarc = 0, sslScore = 0, blacklist = 0, security = 10;

  // SPF: 20 points
  if (email?.spf) {
    if (email.spf.found) {
      spf += 8; // Record exists
      // Qualifier scoring
      if (email.spf.qualifier === '-all') spf += 8;
      else if (email.spf.qualifier === '~all') spf += 6;
      else if (email.spf.qualifier === '?all') spf += 2;
      // Lookup count ok
      if (email.spf.lookupCount <= 10) spf += 4;
      else if (email.spf.lookupCount <= 7) spf += 4;
    }
  }

  // DKIM: 15 points
  if (email?.dkim) {
    if (email.dkim.foundCount > 0) {
      dkim += 10; // At least one selector found
      if (email.dkim.foundCount >= 2) dkim += 3; // Multiple selectors
      const hasStrongKey = email.dkim.selectors.some(s => s.found && s.keyLength === 'strong');
      if (hasStrongKey) dkim += 2;
    }
  }

  // DMARC: 20 points
  if (email?.dmarc) {
    if (email.dmarc.found) {
      dmarc += 5; // Record exists
      // Policy scoring
      if (email.dmarc.policy === 'reject') dmarc += 10;
      else if (email.dmarc.policy === 'quarantine') dmarc += 7;
      else if (email.dmarc.policy === 'none') dmarc += 2;
      // Reporting
      if (email.dmarc.rua.length > 0) dmarc += 5;
    }
  }

  // SSL: 20 points
  if (ssl) {
    if (ssl.status === 'valid') sslScore = 20;
    else if (ssl.status === 'expiring') sslScore = 12;
    else if (ssl.status === 'critical') sslScore = 5;
    else if (ssl.status === 'expired') sslScore = 0;
    // unchecked/error: 0 but we lower maxPossible
  }

  // Blacklist: 15 points
  if (mx) {
    const listedHosts = mx.hosts.filter(h =>
      h.blacklistStatus && h.blacklistStatus.listed.length > 0
    );
    if (listedHosts.length === 0) {
      blacklist = 15;
    } else {
      // Lose points per listed host
      blacklist = Math.max(0, 15 - listedHosts.length * 5);
    }
  }

  // Security: 10 points (start with 10, deduct for issues)
  if (securityIssueCount !== undefined && securityIssueCount > 0) {
    security = Math.max(0, 10 - securityIssueCount * 2);
  }

  const total = spf + dkim + dmarc + sslScore + blacklist + security;
  const maxPossible = 100;

  return {
    total,
    spf, dkim, dmarc, ssl: sslScore, blacklist, security,
    maxPossible,
    components: [
      { label: 'SPF', score: spf, max: 20 },
      { label: 'DKIM', score: dkim, max: 15 },
      { label: 'DMARC', score: dmarc, max: 20 },
      { label: 'SSL', score: sslScore, max: 20 },
      { label: 'Blacklist', score: blacklist, max: 15 },
      { label: 'Security', score: security, max: 10 },
    ],
  };
}

export function scoreColor(score: number): string {
  if (score >= 90) return 'text-accent-green';
  if (score >= 70) return 'text-accent-yellow';
  return 'text-accent-red';
}

export function scoreBgColor(score: number): string {
  if (score >= 90) return 'bg-accent-green';
  if (score >= 70) return 'bg-accent-yellow';
  return 'bg-accent-red';
}
