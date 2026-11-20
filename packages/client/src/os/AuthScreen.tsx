import { useState, type FormEvent } from 'react';
import { Shield, Terminal } from 'lucide-react';
import type { PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (p: PlayerDto) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password);
      onAuthenticated(res.player);
    } catch (err: any) {
      setError(err.message ?? 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0a0e08] p-4">
      <div className="cyber-card w-full max-w-md rounded-lg p-6">
        <div className="mb-6 flex items-center gap-3 border-b border-[#354024] pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded border border-[#fed82a]/50 bg-[#232b19] text-[#fed82a]">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-widest text-[#fed82a]">
              INTRUSION // OS 2.0
            </h1>
            <p className="font-mono text-xs text-[#8f9b6c]">
              EUROPEAN UNDERGROUND UPLINK — ENCRYPTED NODE
            </p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded bg-[#10150c] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`rounded py-1.5 font-mono text-xs font-semibold uppercase transition ${
              mode === 'login'
                ? 'bg-[#354125] text-[#fed82a] shadow'
                : 'text-[#8b9467] hover:text-[#d8dfb8]'
            }`}
          >
            Connexion Opérateur
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`rounded py-1.5 font-mono text-xs font-semibold uppercase transition ${
              mode === 'register'
                ? 'bg-[#354125] text-[#fed82a] shadow'
                : 'text-[#8b9467] hover:text-[#d8dfb8]'
            }`}
          >
            Nouveau Cyberdeck
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="auth-user" className="mb-1 block font-mono text-xs text-[#a5b282]">
              IDENTIFIANT (HANDLE)
            </label>
            <input
              id="auth-user"
              type="text"
              required
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex: ZeroCool"
              className="w-full rounded border border-[#44522f] bg-[#0d120a] px-3 py-2 font-mono text-sm text-[#e8efd0] focus:border-[#fed82a] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="auth-pass" className="mb-1 block font-mono text-xs text-[#a5b282]">
              CLÉ D&apos;ACCÈS SECRÈTE
            </label>
            <input
              id="auth-pass"
              type="password"
              required
              minLength={4}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded border border-[#44522f] bg-[#0d120a] px-3 py-2 font-mono text-sm text-[#e8efd0] focus:border-[#fed82a] focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded border border-[#ff5555]/50 bg-[#2d1212] px-3 py-2 font-mono text-xs text-[#ff8888]">
              [ERREUR] {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="cyber-btn-amber flex w-full items-center justify-center gap-2 rounded py-2.5 font-mono text-sm uppercase cursor-pointer disabled:opacity-50"
          >
            <Shield className="h-4 w-4" />
            {loading
              ? 'Négociation SSL...'
              : mode === 'login'
                ? 'Établir la liaison'
                : 'Initialiser le Cyberdeck (10 000 CR)'}
          </button>
        </form>
      </div>
    </div>
  );
}
