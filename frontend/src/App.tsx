import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProposalPage from './pages/ProposalPage';
import DealsPage from './pages/DealsPage';
import InboxPage from './pages/InboxPage';
import SettingsPage from './pages/SettingsPage';
import AppShell from './components/layout/AppShell';
import GoogleAuthCallbackPage from './pages/GoogleAuthCallbackPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/auth/google/callback" element={<GoogleAuthCallbackPage />} />
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/proposals" element={<ProposalPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
