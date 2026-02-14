import { AzureFunction, Context, HttpRequest } from '@azure/functions';
import * as tls from 'tls';
import * as net from 'net';

interface CertResult {
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  sans: string[];
  fingerprint: string;
  protocol: string;
}

function getCertInfo(domain: string, port: number): Promise<CertResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: domain, port, servername: domain, rejectUnauthorized: false, timeout: 10000 },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_from) {
          socket.destroy();
          reject(new Error('No certificate returned'));
          return;
        }

        const validFrom = new Date(cert.valid_from);
        const validTo = new Date(cert.valid_to);
        const now = new Date();
        const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // Extract SANs
        const sans: string[] = [];
        if (cert.subjectaltname) {
          cert.subjectaltname.split(',').forEach((entry: string) => {
            const trimmed = entry.trim();
            if (trimmed.startsWith('DNS:')) {
              sans.push(trimmed.slice(4));
            }
          });
        }

        // Issuer
        const issuerParts: string[] = [];
        if (cert.issuer) {
          if (cert.issuer.O) issuerParts.push(cert.issuer.O);
          if (cert.issuer.CN) issuerParts.push(cert.issuer.CN);
        }

        const protocol = socket.getProtocol() || '';

        socket.destroy();
        resolve({
          domain,
          issuer: issuerParts.join(' - ') || 'Unknown',
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysRemaining,
          sans,
          fingerprint: cert.fingerprint256 || cert.fingerprint || '',
          protocol,
        });
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });
  });
}

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  const { domain, port } = req.body || {};

  if (!domain || typeof domain !== 'string') {
    context.res = { status: 400, body: { error: 'Missing "domain" in request body' } };
    return;
  }

  // Basic domain validation
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    context.res = { status: 400, body: { error: 'Invalid domain format' } };
    return;
  }

  try {
    const result = await getCertInfo(domain, port || 443);
    context.res = { status: 200, body: result };
  } catch (err) {
    context.res = { status: 200, body: { domain, error: (err as Error).message } };
  }
};

export default httpTrigger;
