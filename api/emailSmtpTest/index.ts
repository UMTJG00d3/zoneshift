import { AzureFunction, Context, HttpRequest } from '@azure/functions';
import * as net from 'net';

interface SmtpResult {
  host: string;
  port: number;
  reachable: boolean;
  banner: string | null;
  supportsStartTLS: boolean;
  error: string | null;
  responseTime: number;
}

function testSmtp(host: string, port: number): Promise<SmtpResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let banner = '';
    let ehloResponse = '';
    let phase: 'banner' | 'ehlo' | 'done' = 'banner';

    const socket = new net.Socket();
    socket.setTimeout(15000);

    socket.on('connect', () => {
      // Wait for banner
    });

    socket.on('data', (data) => {
      const text = data.toString();

      if (phase === 'banner') {
        banner += text;
        if (banner.includes('\r\n') || banner.includes('\n')) {
          phase = 'ehlo';
          socket.write('EHLO zoneshift.umetech.net\r\n');
        }
      } else if (phase === 'ehlo') {
        ehloResponse += text;
        // EHLO response ends with a line starting with "250 " (space not dash)
        if (/^250 /m.test(ehloResponse)) {
          phase = 'done';
          socket.write('QUIT\r\n');
          setTimeout(() => socket.destroy(), 1000);

          const supportsStartTLS = /250[- ]STARTTLS/i.test(ehloResponse);
          resolve({
            host, port, reachable: true,
            banner: banner.trim().split('\n')[0].trim(),
            supportsStartTLS,
            error: null,
            responseTime: Date.now() - start,
          });
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        host, port, reachable: false,
        banner: banner.trim() || null,
        supportsStartTLS: false,
        error: 'Connection timed out',
        responseTime: Date.now() - start,
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        host, port, reachable: false,
        banner: null, supportsStartTLS: false,
        error: err.message,
        responseTime: Date.now() - start,
      });
    });

    socket.connect(port, host);
  });
}

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
  const { host, port } = req.body || {};

  if (!host || typeof host !== 'string') {
    context.res = { status: 400, body: { error: 'Missing "host" in request body' } };
    return;
  }

  // Try port 25 first, fall back to 587 if blocked
  const primaryPort = port || 25;
  let result = await testSmtp(host, primaryPort);

  // If port 25 failed and we didn't explicitly request a port, try 587
  if (!result.reachable && !port && primaryPort === 25) {
    const fallback = await testSmtp(host, 587);
    if (fallback.reachable) {
      result = fallback;
    }
  }

  context.res = { status: 200, body: result };
};

export default httpTrigger;
