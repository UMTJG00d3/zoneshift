interface ConstellixCredentialsProps {
  apiKey: string;
  secretKey: string;
  onApiKeyChange: (value: string) => void;
  onSecretKeyChange: (value: string) => void;
}

export default function ConstellixCredentials({
  apiKey,
  secretKey,
  onApiKeyChange,
  onSecretKeyChange,
}: ConstellixCredentialsProps) {
  return (
    <div className="creds-fields">
      <div className="creds-field">
        <label htmlFor="cnx-api-key">Constellix API Key</label>
        <input
          id="cnx-api-key"
          type="text"
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="creds-field">
        <label htmlFor="cnx-secret-key">Constellix Secret Key</label>
        <input
          id="cnx-secret-key"
          type="password"
          placeholder="Secret Key"
          value={secretKey}
          onChange={(e) => onSecretKeyChange(e.target.value)}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
