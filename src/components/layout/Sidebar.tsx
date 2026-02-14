import { useState, useEffect, type ReactNode } from 'react';
import { Route } from '../../utils/router';

declare const __BUILD_TIME__: string;

interface SidebarProps {
  route: Route;
}

interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  page: Route['page'];
}

/* Inline SVG icons — matching HUD's clean icon style */
const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ArrowsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { label: 'Domains', icon: <GlobeIcon />, path: '#/domains', page: 'domains' },
  { label: 'Migrate', icon: <ArrowsIcon />, path: '#/migrate', page: 'migrate' },
  { label: 'Settings', icon: <GearIcon />, path: '#/settings', page: 'settings' },
];

const STORAGE_KEY = 'zoneshift-sidebar-collapsed';

export default function Sidebar({ route }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

  function isActive(item: NavItem): boolean {
    if (item.page === 'domains') {
      return route.page === 'domains' || route.page === 'domain-detail';
    }
    return route.page === item.page;
  }

  const buildTime = (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev')
    .replace(/T/, ' ')
    .replace(/\.\d+Z$/, '');

  return (
    <nav
      className="flex flex-col bg-surface-dark border-r border-border shrink-0 transition-all duration-200"
      style={{ width: collapsed ? 60 : 220 }}
    >
      <div className="flex-1 flex flex-col py-4 gap-0.5">
        {NAV_ITEMS.map(item => {
          const active = isActive(item);
          return (
            <a
              key={item.page}
              href={item.path}
              className={`
                flex items-center gap-3 px-3 py-2 mx-2 rounded-md no-underline transition-colors text-sm font-medium
                ${active
                  ? 'bg-accent-blue/15 text-accent-blue border-l-2 border-accent-blue'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className="w-5 flex items-center justify-center shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </div>

      {/* Version badge + collapse toggle */}
      <div className="flex flex-col items-center gap-2 px-2 pb-3">
        {!collapsed && (
          <span className="text-text-muted text-[10px] font-mono opacity-60 text-center leading-tight">
            {buildTime}
          </span>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-text-muted hover:text-text-secondary transition-colors border-0 bg-transparent cursor-pointer text-xs"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u{25B6}' : '\u{25C0} Collapse'}
        </button>
      </div>
    </nav>
  );
}
