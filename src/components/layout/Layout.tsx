import { ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { Route } from '../../utils/router';

interface LayoutProps {
  route: Route;
  children: ReactNode;
}

export default function Layout({ route, children }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-surface-dark text-text-primary overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar route={route} />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
      <footer className="flex items-center justify-center px-4 py-1.5 border-t border-border bg-surface-dark text-text-muted text-[11px] shrink-0">
        <span>ZoneShift &mdash; Umetech MSP</span>
      </footer>
    </div>
  );
}
