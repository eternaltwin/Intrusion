import { useEffect, useState } from 'react';
import { Cpu, Play, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import type { MissionInitParams, PlayerDto } from '@intrusion/shared';
import { api, type CatalogResponse, type MissionOfferDto, type MissionsListResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';
import { ModalDialog } from '../components/ModalDialog';

const MISSION_REFRESH_COST = 2000;

interface ContractsAppProps {
  player: PlayerDto;
  catalog: CatalogResponse;
  onPlayerUpdate: (p: PlayerDto) => void;
  onLaunchMission: (init: MissionInitParams) => void;
}

export function ContractsApp({
  player,
  catalog,
  onPlayerUpdate,
  onLaunchMission,
}: ContractsAppProps) {
  const [data, setData] = useState<MissionsListResponse | null>(null);
  const [tab, setTab] = useState<'available' | 'active' | 'tutorials' | 'completed'>('available');
  const [selected, setSelected] = useState<MissionOfferDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.missions();
      setData(res);
      setSelected((prev) => {
        if (!prev) return res.available[0] ?? res.tutorials[0] ?? null;
        const pool = [...res.available, ...res.active, ...res.tutorials, ...res.completed];
        return pool.find((m) => m.missionKey === prev.missionKey) ?? res.available[0] ?? null;
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [player.settings.lang]);

  async function handleRefresh() {
    setLoading(true);
    try {
      const res = await api.refreshMissions();
      setData((prev) =>
        prev ? { ...prev, available: res.available, active: [], completed: [] } : null
      );
      setSelected(res.available[0] ?? null);
      if (res.player) onPlayerUpdate(res.player);
      setConfirmRefreshOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart(offer: MissionOfferDto) {
    setLoading(true);
    try {
      const res = await api.startMission(offer.missionKey);
      onLaunchMission(res.init);
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickChipset(chipId: string) {
    const res = await api.setChipset(chipId === 'none' ? null : chipId);
    onPlayerUpdate(res.player);
  }

  async function handleQuickFavoriteDeck(deckId: string) {
    const deck = player.decks.find((d) => d.id === deckId);
    if (!deck) return;
    const res = await api.saveDeck(deck.id, {
      name: deck.name,
      content: deck.content,
      isFavorite: true,
    });
    onPlayerUpdate(res.player);
  }

  const list: MissionOfferDto[] =
    !data
      ? []
      : tab === 'available'
        ? data.available
        : tab === 'active'
          ? data.active
          : tab === 'tutorials'
            ? data.tutorials
            : data.completed;

  const diffBadge = (d: MissionOfferDto['difficulty']) =>
    d === 'easy'
      ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
      : d === 'medium'
        ? 'border-amber-500/40 bg-amber-950/60 text-amber-300'
        : 'border-rose-500/40 bg-rose-950/60 text-rose-300';

  const favDeck = player.decks.find((d) => d.isFavorite) ?? player.decks[0];

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left column: Contract list */}
      <div className="cyber-card flex flex-col overflow-hidden rounded-lg lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#343f24] bg-[#1a2213] px-4 py-2.5">
          <div className="flex gap-1.5">
            {(
              [
                ['available', `Disponibles (${data?.available.length ?? 0})`],
                ['active', `En cours (${data?.active.length ?? 0})`],
                ['tutorials', `Formation Circé (${data?.tutorials.length ?? 0})`],
                ['completed', `Archives (${data?.completed.length ?? 0})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  const nextPool =
                    id === 'available'
                      ? data?.available
                      : id === 'active'
                        ? data?.active
                        : id === 'tutorials'
                          ? data?.tutorials
                          : data?.completed;
                  if (nextPool && nextPool[0]) setSelected(nextPool[0]);
                }}
                className={`rounded px-2.5 py-1 font-mono text-xs transition cursor-pointer ${
                  tab === id
                    ? 'bg-[#fed82a] font-bold text-[#14190e]'
                    : 'bg-[#252e1b] text-[#a7b483] hover:text-[#fed82a]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'available' && (
            <button
              type="button"
              onClick={() => setConfirmRefreshOpen(true)}
              disabled={loading}
              title={`Scanner de nouveaux contrats sur le réseau (${MISSION_REFRESH_COST})`}
              className="cyber-btn flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Nouveaux Contrats ({MISSION_REFRESH_COST}{' '}
              <img src="/img/icons/money.png" alt="" className="inline h-3.5 w-3.5" />)
            </button>
          )}
        </div>

        <div className="flex-1 divide-y divide-[#28311c] overflow-y-auto">
          {list.length === 0 ? (
            <div className="p-8 text-center font-mono text-sm text-[#7f8c5e]">
              Aucun contrat dans cette catégorie.
            </div>
          ) : (
            list.map((m) => {
              const isSel = selected?.missionKey === m.missionKey;
              return (
                <button
                  key={m.missionKey}
                  type="button"
                  onClick={() => setSelected(m)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition cursor-pointer ${
                    isSel ? 'bg-[#27321b]' : 'hover:bg-[#1c2414]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                        style={{ backgroundColor: m.colorHex }}
                      />
                      <span className="truncate font-mono text-xs uppercase text-[#95a370]">
                        {m.corp} · NIV.{m.level}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${diffBadge(
                          m.difficulty
                        )}`}
                      >
                        {m.difficulty}
                      </span>
                      {m.tries > 0 && (
                        <span className="rounded bg-amber-950/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                          Essais: {m.tries}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate font-medium text-sm text-[#e8efd0]">
                      {m.short}
                    </div>
                  </div>

                  <div className="shrink-0 text-right font-mono">
                    <div className="text-sm font-bold text-[#fed82a]">
                      {m.effectivePrime.toLocaleString()} CR
                    </div>
                    {m.bonus > 0 && (
                      <div className="text-[11px] text-[#7be082]">+{m.bonus} pack</div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right column: Briefing & Loadout Inspector */}
      <div className="cyber-card flex flex-col justify-between overflow-y-auto rounded-lg p-5 lg:col-span-5">
        {selected ? (
          <>
            <div>
              <div className="flex items-start justify-between gap-3 border-b border-[#333e23] pb-3">
                <div>
                  <div className="font-mono text-xs uppercase tracking-wider text-[#95a370]">
                    CIBLE // {selected.corp} (SEED #{selected.seed})
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-[#fed82a]">{selected.short}</h2>
                </div>
                <div className="rounded border border-[#4e5d36] bg-[#11160d] px-3 py-1.5 text-right font-mono">
                  <div className="text-[10px] text-[#8d9a6a]">PRIME</div>
                  <div className="text-base font-bold text-[#fed82a]">
                    {selected.effectivePrime} CR
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded border border-[#2f3a20] bg-[#10150c] p-3.5 text-sm leading-relaxed text-[#d4dcba]">
                <SafeHtml html={selected.details} />
              </div>

              {/* Pre-mission Loadout Selector */}
              <div className="mt-4 space-y-3 rounded border border-[#343f24] bg-[#151b10] p-3.5">
                <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-[#b6c391]">
                  <Cpu className="h-4 w-4 text-[#fed82a]" />
                  Configuration Cyberdeck Avant Infiltration
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-mono text-[11px] text-[#8e9b6b]">
                      DECK PRINCIPAL
                    </label>
                    <select
                      value={favDeck?.id ?? ''}
                      onChange={(e) => handleQuickFavoriteDeck(e.target.value)}
                      className="w-full rounded border border-[#45532f] bg-[#0d110a] px-2.5 py-1.5 font-mono text-xs text-[#e8efd0]"
                    >
                      {player.decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.content.length}/{d.capacity})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block font-mono text-[11px] text-[#8e9b6b]">
                      CHIPSET MATÉRIEL
                    </label>
                    <select
                      value={player.activeChipset ?? 'none'}
                      onChange={(e) => handleQuickChipset(e.target.value)}
                      className="w-full rounded border border-[#45532f] bg-[#0d110a] px-2.5 py-1.5 font-mono text-xs text-[#e8efd0]"
                    >
                      <option value="none">Aucun Chipset</option>
                      {player.chipsets.map((cid) => {
                        const c = catalog.chipsets.find((x) => x.id === cid);
                        return (
                          <option key={cid} value={cid}>
                            {c?.name ?? cid}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {favDeck && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {favDeck.content.map((vid) => (
                      <div
                        key={vid}
                        title={vid.toUpperCase()}
                        className="flex items-center gap-1 rounded border border-[#3e4b2b] bg-[#1d2515] px-2 py-1 font-mono text-[11px] text-[#d8dfb8]"
                      >
                        <img
                          src={`/assets/img/dockicons/${vid}.png`}
                          alt={vid}
                          className="h-4 w-4 object-contain"
                        />
                        {vid.toUpperCase()}
                      </div>
                    ))}
                  </div>
                )}

                {player.activeChipset === 'scout' && (
                  <div className="flex items-center gap-2 rounded border border-sky-500/40 bg-sky-950/50 px-2.5 py-1.5 font-mono text-xs text-sky-200">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    Mode SCOUT actif : exploration sans consommer d&apos;essai (destruction désactivée).
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-[#313b22]">
              {selected.status === 'completed' ? (
                <div className="rounded bg-[#1e2717] py-2.5 text-center font-mono text-xs text-[#88d88a]">
                  Contrat déjà accompli et archivé.
                </div>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleStart(selected)}
                  className="cyber-btn-amber flex w-full items-center justify-center gap-2 rounded py-3 font-mono text-sm uppercase tracking-wider cursor-pointer"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Lancer l&apos;intrusion ({selected.corp})
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center font-mono text-sm text-[#7f8c5e]">
            <ShieldAlert className="mb-2 h-8 w-8 opacity-50" />
            Sélectionnez un contrat pour afficher son briefing tactique.
          </div>
        )}
      </div>

      <ModalDialog
        open={confirmRefreshOpen}
        title="Renouvellement des offres"
        onClose={() => {
          if (!loading) setConfirmRefreshOpen(false);
        }}
      >
        <div className="space-y-3 text-sm text-[#d6dfb8]">
          <p>
            Renouveler les offres disponibles coûte{' '}
            <strong className="text-[#fed82a]">
              {MISSION_REFRESH_COST}{' '}
              <img src="/img/icons/money.png" alt="" className="inline h-3.5 w-3.5 align-text-bottom" />
            </strong>
            .
          </p>
          <p className="text-xs text-[#9aa678]">
            Attention : vos missions en cours et terminées seront également réinitialisées.
          </p>
          {player.money < MISSION_REFRESH_COST && (
            <p className="text-xs font-semibold text-rose-400">
              Crédits insuffisants ({player.money} / {MISSION_REFRESH_COST}{' '}
              <img src="/img/icons/money.png" alt="" className="inline h-3.5 w-3.5 align-text-bottom" />).
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => setConfirmRefreshOpen(false)}
              className="rounded border border-[#44522f] bg-[#1e2616] px-3 py-1.5 font-mono text-xs text-[#c7d2a4] hover:bg-[#2a3520] cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={loading || player.money < MISSION_REFRESH_COST}
              onClick={handleRefresh}
              className="rounded border border-[#fed82a]/60 bg-[#3a4923] px-3 py-1.5 font-mono text-xs font-bold text-[#fed82a] hover:bg-[#4b5f2d] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                'Renouvellement...'
              ) : (
                <>
                  Confirmer ({MISSION_REFRESH_COST}{' '}
                  <img src="/img/icons/money.png" alt="" className="inline h-3.5 w-3.5 align-text-bottom" />)
                </>
              )}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
