import { useState, useEffect, useCallback } from 'react';

export interface Route {
  page: 'domains' | 'domain-detail' | 'migrate' | 'settings';
  params: Record<string, string>;
}

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '') || 'domains';

  if (path === 'migrate') {
    return { page: 'migrate', params: {} };
  }

  if (path === 'settings') {
    return { page: 'settings', params: {} };
  }

  // #/domains/:name
  const domainMatch = path.match(/^domains\/(.+)$/);
  if (domainMatch) {
    return { page: 'domain-detail', params: { name: decodeURIComponent(domainMatch[1]) } };
  }

  // Default: #/domains
  return { page: 'domains', params: {} };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function useNavigate() {
  return useCallback((path: string) => {
    window.location.hash = path;
  }, []);
}
