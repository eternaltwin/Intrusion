import { useEffect, useState } from 'react';
import { Flame, Play, Trophy } from 'lucide-react';
import type { MissionInitParams } from '@intrusion/shared';
import { api, type ChallengeTierDto, type ChallengeTodayResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';

const TIER_LABELS: Record<ChallengeTierDto['difficulty'], string> = {
  easy: 'Facile (Niv. 5)',
  medium: 'Moyen (Niv. 7)',
  hard: 'Difficile (Niv. 9)',
};

export function ChallengeApp({
  onLaunchMission,
}: {
  onLaunchMission: (init: MissionInitParams) => void;
}) {
  const [data, setData] = useState<ChallengeTodayResponse | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<5 | 7 | 9>(5);
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
        if (!cancelled) setError(err.message || 'Impossible de charger les Challenges quotidiens.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTier: ChallengeTierDto | undefined =
    data?.challenges.find((c) => c.level === selectedLevel) ?? data?.challenges[0];

  async function handleStart(level: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.startChallenge(level);
      onLaunchMission(res.init);
    } catch (err: any) {
      setError(err.message || 'Impossible de démarrer le Challenge.');
    } finally {
      setLoading(false);
    }
  }

  if (!data || !activeTier) {
    return (
      <div className="cyber-card flex h-full items-center justify-center rounded-lg font-mono text-sm text-[#8e9b6b]">
        {error ? (
          <span className="text-rose-300">{error}</span>
        ) : (
          'Synchronisation des 3 Challenges quotidiens...'
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.challenges.map((ch) => {
          const isSelected = ch.level === activeTier.level;
          return (
            <button
              key={ch.level}
              type="button"
              onClick={() => setSelectedLevel(ch.level)}
              className={`flex items-center gap-3 rounded-lg border p-3 text-left font-mono transition cursor-pointer ${
                isSelected
                  ? 'border-[#fed82a] bg-[#212b18] text-[#e8efd0]'
                  : 'border-[#323d22] bg-[#141a0f] text-[#9aa875] hover:border-[#55663b]'
              }`}
            >
              <img
                src={`/img/design/mission_${ch.difficulty}.png`}
                alt={ch.difficulty}
                className="h-9 w-9 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase text-[#fed82a]">
                  {TIER_LABELS[ch.difficulty]}
                </div>
                <div className="truncate text-xs">{ch.corp}</div>
                <div className="truncate text-[11px] text-[#8d9a6a]">{ch.short}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="cyber-card flex flex-col justify-between rounded-lg p-5 lg:col-span-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-[#fed82a]">
              <Flame className="h-4 w-4" />
              CHALLENGE NIVEAU {activeTier.level} // {data.date}
            </div>
            <h2 className="mt-2 text-xl font-bold text-[#e8efd0]">{activeTier.short}</h2>
            <p className="mt-1 font-mono text-xs text-[#919f6e]">
              Cible : {activeTier.corp} · Niveau {activeTier.level} · Seed #{activeTier.seed}
            </p>

            <div className="mt-4 rounded border border-[#323d22] bg-[#0f140b] p-3.5 text-sm leading-relaxed">
              <SafeHtml html={activeTier.details} />
            </div>

            <div className="mt-4 rounded border border-amber-500/30 bg-amber-950/30 p-3 font-mono text-xs text-amber-200">
              <strong>Règles officielles Challenge :</strong>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px]">
                <li>3 paliers quotidiens (Niv. 5, 7, 9) ouverts à tous sans condition d&apos;accès.</li>
                <li>Un seul deck autorisé ; effacer un <code>.log</code> ne donne PAS +30s.</li>
                <li>
                  1ère tentative du palier classée (+{activeTier.rewardMoney} CR &amp; +
                  {activeTier.rewardXp} XP en cas de victoire).
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
            {activeTier.hasPlayedRanked && activeTier.playerRankedRun && (
              <div className="mb-3 rounded bg-[#1d2616] px-3 py-2 text-center font-mono text-xs text-[#a5b884]">
                Tentative classée enregistrée ({activeTier.playerRankedRun.score} pts) — entraînement libre actif.
              </div>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => handleStart(activeTier.level)}
              className="cyber-btn-amber flex w-full items-center justify-center gap-2 rounded py-3 font-mono text-sm uppercase cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              {activeTier.hasPlayedRanked ? 'Lancer un run entraînement' : 'Lancer ma tentative classée'}
            </button>
          </div>
        </div>

        <div className="cyber-card flex flex-col overflow-hidden rounded-lg lg:col-span-7">
          <div className="flex items-center gap-2 border-b border-[#343f24] bg-[#1a2213] px-4 py-3 font-mono text-xs font-bold uppercase text-[#fed82a]">
            <Trophy className="h-4 w-4" />
            Classement {TIER_LABELS[activeTier.difficulty]} ({data.date})
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTier.leaderboard.length === 0 ? (
              <div className="py-12 text-center font-mono text-sm text-[#7f8c5e]">
                Aucune infiltration classée réussie sur ce palier aujourd&apos;hui.
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
                  {activeTier.leaderboard.map((row, idx) => (
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
    </div>
  );
}
