import { useState, useEffect } from 'react';

declare const __BUILD_TIME__: string;

interface UserInfo {
  displayName: string;
  userRoles: string[];
}

export default function Header() {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    fetch('/.auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data?.clientPrincipal) {
          setUser({
            displayName: data.clientPrincipal.userDetails || 'User',
            userRoles: data.clientPrincipal.userRoles || [],
          });
        }
      })
      .catch(() => { /* not authenticated or unavailable */ });
  }, []);

  const buildTime = (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev')
    .replace(/T/, ' ')
    .replace(/\.\d+Z$/, ' UTC');

  return (
    <header className="flex items-center h-14 px-4 border-b border-border bg-surface-dark shrink-0">
      <a href="#/domains" className="flex items-center gap-2 no-underline">
        <span className="inline-flex items-center justify-center w-8 h-8 bg-accent-blue text-white font-extrabold text-sm rounded-md">
          Z
        </span>
        <span className="text-text-primary font-bold text-lg">ZoneShift</span>
      </a>

      <span className="ml-3 text-text-muted text-xs font-mono hidden sm:inline">
        {buildTime}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {user && (
          <span className="text-text-secondary text-xs">
            {user.displayName}
          </span>
        )}
      </div>
    </header>
  );
}
