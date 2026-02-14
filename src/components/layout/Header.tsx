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

      <span className="ml-3 text-text-muted text-[10px] font-mono opacity-50 hidden sm:inline">
        {buildTime}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {user && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-full text-text-secondary text-xs font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {user.displayName}
          </span>
        )}
      </div>
    </header>
  );
}
