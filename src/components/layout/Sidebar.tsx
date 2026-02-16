import { useState, useEffect } from 'react';
import { Globe, ArrowLeftRight, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Route } from '../../utils/router';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';

interface SidebarProps {
  route: Route;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  page: Route['page'];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Domains', icon: Globe, path: '#/domains', page: 'domains' },
  { label: 'Migrate', icon: ArrowLeftRight, path: '#/migrate', page: 'migrate' },
  { label: 'Settings', icon: Settings, path: '#/settings', page: 'settings' },
];

export default function Sidebar({ route }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch { return false; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

  function isActive(item: NavItem): boolean {
    if (item.page === 'domains') {
      return route.page === 'domains' || route.page === 'domain-detail';
    }
    return route.page === item.page;
  }

  return (
    <aside
      className={cn(
        "hidden lg:fixed lg:inset-y-0 lg:z-20 lg:flex lg:flex-col border-r border-border/50 bg-card/50 backdrop-blur-xl transition-all duration-300 ease-in-out",
        collapsed ? "lg:w-[70px]" : "lg:w-[280px]"
      )}
      style={{ top: '4rem' }}
    >
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Navigation section */}
        <div className="flex-1 flex flex-col py-4">
          {!collapsed && (
            <div className="px-4 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Navigation
              </span>
            </div>
          )}
          <div className="flex-1 space-y-1 px-2">
            {NAV_ITEMS.map(item => {
              const active = isActive(item);
              const Icon = item.icon;
              const link = (
                <a
                  key={item.page}
                  href={item.path}
                  className={cn(
                    "group relative flex items-center rounded-md transition-colors no-underline",
                    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5 text-sm font-medium",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {/* Active indicator bar */}
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary-600 rounded-r" />
                  )}
                  <Icon className={cn("h-5 w-5 shrink-0", collapsed ? "" : "mr-3")} />
                  {!collapsed && item.label}
                </a>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.page}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }

              return link;
            })}
          </div>
        </div>

        {/* Footer area */}
        <div className="px-2 pb-4">
          <Separator className="mb-3" />
          <button
            onClick={() => setCollapsed(c => !c)}
            className={cn(
              "flex items-center w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </nav>
    </aside>
  );
}
