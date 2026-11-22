import { useEffect, useState } from 'react';
import { Flame, Play, Trophy } from 'lucide-react';
import type { MissionInitParams } from '@intrusion/shared';
import { api, type ChallengeTodayResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';

export function ChallengeApp({
  onLaunchMission,
}: {
  onLaunchMission: (init: MissionInitParams) => void;
}) {
  const [data, setData] = useState<ChallengeTodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.challengeToday();
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Impossible de charger le Challenge quotidien.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.startChallenge();
      onLaunchMission(res.init);
    } catch (err: any) {
      setError(err.message || 'Impossible de démarrer le Challenge.');
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="cyber-card flex h-full items-center justify-center rounded-lg font-mono text-sm text-[#8e9b6b]">
        {error ? (
          <span className="text-rose-300">{error}</span>
        ) : (
          'Synchronisation du Challenge quotidien...'
        )}
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="cyber-card flex flex-col justify-between rounded-lg p-5 lg:col-span-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-[#fed82a]">
            <Flame className="h-4 w-4" />
            CHALLENGE QUOTIDIEN // {data.date}
          </div>
          <h2 className="mt-2 text-xl font-bold text-[#e8efd0]">{data.short}</h2>
          <p className="mt-1 font-mono text-xs text-[#919f6e]">
            Cible : {data.corp} · Niveau {data.level} · Seed #{data.seed}
          </p>

          <div className="mt-4 rounded border border-[#323d22] bg-[#0f140b] p-3.5 text-sm leading-relaxed">
            <SafeHtml html={data.details} />
          </div>

          <div className="mt-4 rounded border border-amber-500/30 bg-amber-950/30 p-3 font-mono text-xs text-amber-200">
            <strong>Règles officielles Challenge :</strong>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px]">
              <li>Même réseau déterministe pour tous les hackers aujourd&apos;hui.</li>
              <li>Effacer un fichier <code>.log</code> ne donne PAS de bonus +30s.</li>
              <li>
                Seule votre <strong>première tentative du jour</strong> compte pour le classement officiel (+1 500 CR &amp; +2 XP en cas de victoire).
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-5 border-t border-[#313b22] pt-4">
          {error && (
            <div className="mb-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
              {error}
            </div>
          )}
          {data.hasPlayedRanked && (
            <div className="mb-3 rounded bg-[#1d2616] px-3 py-2 text-center font-mono text-xs text-[#a5b884]">
              Tentative classée déjà enregistrée aujourd&apos;hui — vous pouvez rejouer en entraînement libre.
            </div>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={handleStart}
            className="cyber-btn-amber flex w-full items-center justify-center gap-2 rounded py-3 font-mono text-sm uppercase cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            {data.hasPlayedRanked ? 'Lancer un run entraînement' : 'Lancer ma tentative classée'}
          </button>
        </div>
      </div>

      <div className="cyber-card flex flex-col overflow-hidden rounded-lg lg:col-span-7">
        <div className="flex items-center gap-2 border-b border-[#343f24] bg-[#1a2213] px-4 py-3 font-mono text-xs font-bold uppercase text-[#fed82a]">
          <Trophy className="h-4 w-4" />
          Classement des Opérateurs ({data.date})
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {data.leaderboard.length === 0 ? (
            <div className="py-12 text-center font-mono text-sm text-[#7f8c5e]">
              Aucune infiltration classée réussie aujourd&apos;hui. Soyez le premier sur le podium !
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-[#333e23] text-[#8d9a6a]">
                  <th className="pb-2">#</th>
                  <th className="pb-2">Opérateur</th>
                  <th className="pb-2 text-right">Score</th>
                  <th className="pb-2 text-right">Temps Restant</th>
                  <th className="pb-2 text-right">Systèmes Neutralisés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#242c19]">
                {data.leaderboard.map((row, idx) => (
                  <tr key={row.username} className="hover:bg-[#1b2314]">
                    <td className="py-2.5 font-bold text-[#fed82a]">#{idx + 1}</td>
                    <td className="py-2.5 font-semibold text-[#e8efd0]">{row.username}</td>
                    <td className="py-2.5 text-right font-bold text-[#7be082]">
                      {row.bestScore.toLocaleString()} pts
                    </td>
                    <td className="py-2.5 text-right text-[#b5c291]">{row.remainingSec}s</td>
                    <td className="py-2.5 text-right text-[#b5c291]">{row.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
