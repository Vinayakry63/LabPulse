import { useCallback, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { clearToken, loadSession, type Session } from './lib/auth';

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const logout = useCallback(() => { clearToken(); setSession(null); }, []);
  return session ? <Dashboard key={session.token} session={session} onLogout={logout} /> : <Login onLogin={setSession} />;
}
