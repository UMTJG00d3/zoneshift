import { useState, useEffect } from 'react';
import { Route } from '../../utils/router';

interface SidebarProps {
  route: Route;
}

interface NavItem {
  label: string;
  icon: string;
  path: string;
  page: Route['page'];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Domains', icon: '\u{1F310}', path: '#/domains', page: 'domains' },
  { label: 'Migrate', icon: '\u{1F500}', path: '#/migrate', page: 'migrate' },
  { label: 'Settings', icon: '\u{2699}\u{FE0F}', path: '#/settings', page: 'settings' },
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

  return (
    <nav
      className="flex flex-col bg-surface-dark border-r border-border shrink-0 transition-all duration-200"
      style={{ width: collapsed ? 60 : 220 }}
    >
      <div className="flex-1 flex flex-col py-3 gap-1">
        {NAV_ITEMS.map(item => {
          const active = isActive(item);
          return (
            <a
              key={item.page}
              href={item.path}
              className={`
                flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg no-underline transition-colors text-sm font-medium
                ${active
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </div>

      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-center py-3 mx-2 mb-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors border-0 bg-transparent cursor-pointer text-xs"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '\u{25B6}' : '\u{25C0} Collapse'}
      </button>
    </nav>
  );
}
