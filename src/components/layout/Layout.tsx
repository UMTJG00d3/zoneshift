import { ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { Route } from '../../utils/router';
import { exportForOversite } from '../../utils/oversiteExport';

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
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
      <footer className="flex items-center justify-between px-4 py-2 border-t border-border text-text-muted text-xs shrink-0">
        <span>ZoneShift &mdash; Umetech MSP</span>
        <button
          className="btn btn-ghost btn-sm export-btn"
          onClick={exportForOversite}
        >
          Export for Over-Site
        </button>
      </footer>
    </div>
  );
}
