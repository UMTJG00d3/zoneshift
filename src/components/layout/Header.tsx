import { useState, useEffect } from 'react';

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

  return (
    <header className="flex items-center h-16 px-5 border-b border-border bg-surface shrink-0 shadow-sm">
      <a href="#/domains" className="flex items-center gap-2.5 no-underline">
        <span className="inline-flex items-center justify-center w-9 h-9 bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white font-extrabold text-sm rounded-lg shadow-sm">
          Z
        </span>
        <span className="text-text-primary font-bold text-lg tracking-tight">ZoneShift</span>
      </a>

      <div className="ml-auto flex items-center gap-4">
        {user && (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-text-primary text-sm font-medium bg-surface-card/50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary">
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
