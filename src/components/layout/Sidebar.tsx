import { type ReactNode } from 'react';
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
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ArrowsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { label: 'Domains', icon: <GlobeIcon />, path: '#/domains', page: 'domains' },
  { label: 'Migrate', icon: <ArrowsIcon />, path: '#/migrate', page: 'migrate' },
  { label: 'Settings', icon: <GearIcon />, path: '#/settings', page: 'settings' },
];

export default function Sidebar({ route }: SidebarProps) {
  function isActive(item: NavItem): boolean {
    if (item.page === 'domains') {
      return route.page === 'domains' || route.page === 'domain-detail';
    }
    return route.page === item.page;
  }

  return (
    <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col" style={{ top: '4rem' }}>
      <nav className="flex min-h-0 flex-1 flex-col bg-surface border-r border-border overflow-y-auto">
        <div className="flex-1 flex flex-col py-4">
          <div className="flex-1 space-y-1 px-2">
            {NAV_ITEMS.map(item => {
              const active = isActive(item);
              return (
                <a
                  key={item.page}
                  href={item.path}
                  className={`
                    group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors no-underline
                    ${active
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-white'
                    }
                  `}
                >
                  <span className="mr-3">{item.icon}</span>
                  {item.label}
                </a>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
