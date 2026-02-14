import { useState, useEffect } from 'react';

const APP_VERSION = '1.6.0';

interface UserInfo {
  name: string;
  username: string;
}

export default function Header() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark') ||
      (!document.documentElement.classList.contains('light') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    // Initialize dark mode
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    // Listen for theme changes from HUD iframe parent
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'theme-change') {
        const isDark = e.data.theme === 'dark';
        setDarkMode(isDark);
      }
    }
    window.addEventListener('message', handleMessage);

    // Check for stored preference
    try {
      const stored = localStorage.getItem('zoneshift-theme');
      if (stored === 'light') setDarkMode(false);
      else if (stored === 'dark') setDarkMode(true);
    } catch { /* ignore */ }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('zoneshift-theme', darkMode ? 'dark' : 'light');
    } catch { /* ignore */ }
  }, [darkMode]);

  useEffect(() => {
    fetch('/.auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data?.clientPrincipal) {
          const principal = data.clientPrincipal;
          // Extract name from claims like Pax8 does
          const claims: { typ: string; val: string }[] = principal.claims || [];
          const nameClaim = claims.find(c => c.typ === 'name');
          const emailClaim = claims.find(c =>
            c.typ === 'preferred_username' ||
            c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
          );
          setUser({
            name: nameClaim?.val || principal.userDetails || 'User',
            username: emailClaim?.val || principal.userDetails || '',
          });
        }
      })
      .catch(() => { /* not authenticated or unavailable */ });
  }, []);

  function toggleDarkMode() {
    setDarkMode(prev => !prev);
  }

  return (
    <header className="flex items-center h-16 px-4 sm:px-6 lg:px-8 border-b border-border bg-surface shadow-sm shrink-0">
      {/* Left: Logo + Title */}
      <a href="#/domains" className="flex items-center gap-2.5 no-underline shrink-0">
        <span className="inline-flex items-center justify-center w-8 h-8 bg-gradient-to-br from-accent-blue to-accent-blue-hover text-white font-bold text-sm rounded-lg">
          Z
        </span>
        <div>
          <span className="text-text-primary font-bold text-lg leading-tight block">ZoneShift</span>
          <span className="text-text-muted text-xs leading-tight hidden sm:block">Umetech MSP Portal</span>
        </div>
      </a>

      {/* Right: Version + Theme + User */}
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        {/* Version badge */}
        <a
          href="#/settings"
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-blue/15 text-accent-blue border border-accent-blue/25 no-underline hover:bg-accent-blue/25 transition-colors"
        >
          v{APP_VERSION}
        </a>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 text-text-muted hover:text-text-secondary transition-colors bg-transparent border-0 cursor-pointer rounded-md"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* User */}
        {user && (
          <span className="hidden md:inline-flex items-center gap-2 text-text-primary text-sm font-medium">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {user.name}
          </span>
        )}
      </div>
    </header>
  );
}
