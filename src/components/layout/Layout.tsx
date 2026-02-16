import { ReactNode, useState, useEffect } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { Route } from '../../utils/router';

interface LayoutProps {
  route: Route;
  children: ReactNode;
}

export default function Layout({ route, children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Sync with sidebar collapsed state from localStorage
  useEffect(() => {
    function checkCollapsed() {
      try {
        setCollapsed(localStorage.getItem('sidebar-collapsed') === 'true');
      } catch { /* ignore */ }
    }
    checkCollapsed();
    window.addEventListener('storage', checkCollapsed);
    // Also poll briefly for same-tab changes
    const interval = setInterval(checkCollapsed, 500);
    return () => {
      window.removeEventListener('storage', checkCollapsed);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Sidebar route={route} />

      <div
        className="pt-16 transition-all duration-300 ease-in-out"
        style={{ paddingLeft: collapsed ? '70px' : '280px' }}
      >
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
