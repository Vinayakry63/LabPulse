export type Role = 'instructor' | 'learner';
export interface Session { token: string; tenantId: string; tenantName: string; role: Role; userId: string }

const KEY = 'labpulse.token';

export function decodeToken(token: string): Session | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.tenantId || !payload.role) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { token, tenantId: payload.tenantId, tenantName: payload.tenantName ?? payload.tenantId, role: payload.role, userId: payload.sub };
  } catch {
    return null;
  }
}

export const loadSession = (): Session | null => {
  const t = sessionStorage.getItem(KEY);
  return t ? decodeToken(t) : null;
};
export const saveToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearToken = () => sessionStorage.removeItem(KEY);

export async function devLogin(p: { tenantId: string; tenantName: string; role: Role; userId: string }): Promise<string> {
  const res = await fetch('/api/dev/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  return ((await res.json()) as { token: string }).token;
}
