import { useState, useEffect, type ReactNode } from 'react';
import { Route } from '../../utils/router';

interface SidebarProps {
  route: Route;
}

interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  page: Route['page'];
}

const GlobeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ArrowsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { label: 'Domains', icon: <GlobeIcon />, path: '#/domains', page: 'domains' },
  { label: 'Migrate', icon: <ArrowsIcon />, path: '#/migrate', page: 'migrate' },
  { label: 'Settings', icon: <GearIcon />, path: '#/settings', page: 'settings' },
];

const APP_VERSION = '1.6.0';

export default function Sidebar({ route }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('zoneshift-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('zoneshift-sidebar-collapsed', String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

  function isActive(item: NavItem): boolean {
    if (item.page === 'domains') {
      return route.page === 'domains' || route.page === 'domain-detail';
    }
    return route.page === item.page;
  }

  return (
    <nav
      className="flex flex-col bg-surface border-r border-border shrink-0 transition-all duration-200"
      style={{ width: collapsed ? 64 : 220 }}
    >
      <div className="flex-1 flex flex-col pt-5 gap-1 px-3">
        {NAV_ITEMS.map(item => {
          const active = isActive(item);
          return (
            <a
              key={item.page}
              href={item.path}
              className={`
                flex items-center gap-3 px-3 py-3 rounded-lg no-underline transition-colors text-[15px]
                ${active
                  ? 'bg-accent-blue text-white font-semibold'
                  : 'text-text-secondary hover:text-white hover:bg-surface-hover font-normal'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className="w-[22px] flex items-center justify-center shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </div>

      <div className="px-3 pb-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-accent-blue/15 text-accent-blue text-[11px] font-medium border border-accent-blue/25">
              v{APP_VERSION}
            </span>
            <button
              onClick={() => setCollapsed(c => !c)}
              className="text-text-muted hover:text-text-secondary transition-colors border-0 bg-transparent cursor-pointer text-[11px] ml-auto"
              title="Collapse sidebar"
            >
              &#9664;
            </button>
          </div>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex justify-center py-2 text-text-muted hover:text-text-secondary transition-colors border-0 bg-transparent cursor-pointer text-xs"
            title="Expand sidebar"
          >
            &#9654;
          </button>
        )}
      </div>
    </nav>
  );
}
