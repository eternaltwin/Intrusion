import { useState, type FormEvent } from 'react';
import { Shield, Terminal } from 'lucide-react';
import type { AuthConfigDto, PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function AuthScreen({
  authConfig,
  onAuthenticated,
}: {
  authConfig?: AuthConfigDto;
  onAuthenticated: (p: PlayerDto) => void;
}) {
  const [devUsername, setDevUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const etwinEnabled = authConfig?.etwinEnabled ?? true;
  const authorizePath = authConfig?.etwinAuthorizePath ?? '/api/auth/eternaltwin/login';
  const devAuthEnabled = authConfig?.devAuthEnabled ?? false;

  async function handleDevSubmit(e: FormEvent) {
    e.preventDefault();
    if (!devUsername.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.devLogin(devUsername.trim());
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
        <div className="mb-5 flex items-center gap-3 border-b border-[#354024] pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded border border-[#fed82a]/50 bg-[#232b19] text-[#fed82a]">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-widest text-[#fed82a]">
              INTRUSION // ETERNALTWIN
            </h1>
            <p className="font-mono text-xs text-[#8f9b6c]">
              AUTHENTIFICATION OAUTH 2.0 CENTRALISÉE
            </p>
          </div>
        </div>

        <p className="mb-4 font-mono text-xs leading-relaxed text-[#c6d2a4]">
          La gestion des comptes est assurée exclusivement par{' '}
          <strong className="text-[#fed82a]">Eternaltwin</strong>. Seuls votre identifiant et votre
          pseudonyme public Eternaltwin sont utilisés.
        </p>

        {etwinEnabled && (
          <a
            href={authorizePath}
            className="cyber-btn-amber mb-4 flex w-full items-center justify-center gap-2 rounded py-2.5 font-mono text-sm uppercase no-underline"
          >
            <Shield className="h-4 w-4" />
            Se connecter avec Eternaltwin
          </a>
        )}

        {error && (
          <div className="mb-4 rounded border border-[#ff5555]/50 bg-[#2d1212] px-3 py-2 font-mono text-xs text-[#ff8888]">
            [ERREUR] {error}
          </div>
        )}

        {devAuthEnabled && (
          <form
            onSubmit={handleDevSubmit}
            className="mt-4 space-y-3 border-t border-dashed border-[#354024] pt-4"
          >
            <p className="font-mono text-[11px] text-[#8f9b6c]">
              SIMULATEUR OAUTH — DÉVELOPPEMENT LOCAL UNIQUEMENT (SANS MOT DE PASSE)
            </p>
            <div>
              <label htmlFor="auth-user" className="mb-1 block font-mono text-xs text-[#a5b282]">
                PSEUDONYME SIMULÉ
              </label>
              <input
                id="auth-user"
                type="text"
                required
                minLength={2}
                maxLength={32}
                value={devUsername}
                onChange={(e) => setDevUsername(e.target.value)}
                placeholder="ex: ZeroCool"
                className="w-full rounded border border-[#44522f] bg-[#0d120a] px-3 py-2 font-mono text-sm text-[#e8efd0] focus:border-[#fed82a] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="cyber-btn flex w-full items-center justify-center gap-2 rounded py-2 font-mono text-xs uppercase cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Connexion...' : 'Accès Dev Local'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
