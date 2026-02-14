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
    <div className="min-h-screen bg-surface-dark text-text-primary">
      <Header />
      <Sidebar route={route} />

      <div className="lg:pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
