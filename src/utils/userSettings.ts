export interface ConstellixCredentials {
  apiKey: string;
  secretKey: string;
}

interface SettingsResponse {
  constellixApiKey?: string;
  constellixSecretKey?: string;
  error?: string;
}

export async function getConstellixCredentials(): Promise<ConstellixCredentials | null> {
  try {
    const res = await fetch('/api/settings', { credentials: 'include' });
    if (!res.ok) return null;

    const data: SettingsResponse = await res.json();
    if (!data.constellixApiKey || !data.constellixSecretKey) return null;

    return {
      apiKey: data.constellixApiKey,
      secretKey: data.constellixSecretKey,
    };
  } catch {
    return null;
  }
}

export async function saveConstellixCredentials(
  apiKey: string,
  secretKey: string
): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        constellixApiKey: apiKey,
        constellixSecretKey: secretKey,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
