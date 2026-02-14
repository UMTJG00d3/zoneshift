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
    <header className="flex items-center h-14 px-4 border-b border-border bg-surface-dark shrink-0">
      <a href="#/domains" className="flex items-center gap-2 no-underline">
        <span className="inline-flex items-center justify-center w-8 h-8 bg-accent-blue text-white font-extrabold text-sm rounded-md">
          Z
        </span>
        <span className="text-text-primary font-bold text-lg">ZoneShift</span>
      </a>

      <div className="ml-auto flex items-center gap-4">
        {user && (
          <span className="inline-flex items-center gap-2 text-text-primary text-sm font-medium">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary">
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
