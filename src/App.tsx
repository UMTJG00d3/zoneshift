import { useRoute } from './utils/router';
import { CredentialsProvider } from './context/CredentialsContext';
import Layout from './components/layout/Layout';
import DomainsPage from './components/pages/DomainsPage';
import DomainDetailPage from './components/pages/DomainDetailPage';
import MigratePage from './components/pages/MigratePage';
import SettingsPage from './components/pages/SettingsPage';

export default function App() {
  const route = useRoute();

  return (
    <CredentialsProvider>
      <Layout route={route}>
        {route.page === 'domains' && <DomainsPage />}
        {route.page === 'domain-detail' && (
          <DomainDetailPage domain={route.params.name} />
        )}
        {route.page === 'migrate' && <MigratePage />}
        {route.page === 'settings' && <SettingsPage />}
      </Layout>
    </CredentialsProvider>
  );
}
