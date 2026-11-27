import { useState } from 'react';
import { Check, Lock, ShoppingCart, Zap } from 'lucide-react';
import { formatVirusDesc, type PlayerDto } from '@intrusion/shared';
import { api, type CatalogResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';
import { ModalDialog } from '../components/ModalDialog';

interface HackstoreAppProps {
  player: PlayerDto;
  catalog: CatalogResponse;
  onPlayerUpdate: (p: PlayerDto) => void;
}

type PendingOsPurchase = {
  key: string;
  label: string;
  price: number;
  payload: { kind: 'virus'; id: string } | { kind: 'chipset'; id: string } | { kind: 'bios' };
};

export function HackstoreApp({ player, catalog, onPlayerUpdate }: HackstoreAppProps) {
  const [tab, setTab] = useState<'damage' | 'debuff' | 'combo' | 'utils' | 'chipsets' | 'bios'>('damage');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOsPurchase | null>(null);

  function requestBuy(
    key: string,
    label: string,
    price: number,
    payload: { kind: 'virus'; id: string } | { kind: 'chipset'; id: string } | { kind: 'bios' }
  ) {
    setError(null);
    setPending({ key, label, price, payload });
  }

  async function confirmBuy() {
    if (!pending) return;
    setError(null);
    setBusyId(pending.key);
    try {
      const res = await api.buyItem(pending.payload);
      onPlayerUpdate(res.player);
      setPending(null);
    } catch (e: any) {
      setError(e.message);
      setPending(null);
    } finally {
      setBusyId(null);
    }
  }

  const buyableViruses = catalog.viruses
    .filter((v) => v.price > 0 && v.cat === tab)
    .filter(
      (v) =>
        !search.trim() ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        v.id.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.level - b.level || a.price - b.price);

  const buyableChipsets = catalog.chipsets
    .filter((c) => c.price > 0)
    .filter(
      (c) =>
        !search.trim() ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.id.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.level - b.level || a.price - b.price);

  return (
    <div className="cyber-card flex h-full flex-col overflow-hidden rounded-lg">
      {/* Header Tabs & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#343f24] bg-[#1a2213] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['damage', 'Dégâts'],
              ['debuff', 'Sabotage / Debuff'],
              ['combo', 'Combos'],
              ['utils', 'Utilitaires'],
              ['chipsets', 'Chipsets'],
              ['bios', 'Overclock BIOS'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setError(null);
              }}
              className={`rounded px-3 py-1.5 font-mono text-xs transition cursor-pointer ${
                tab === id
                  ? 'bg-[#fed82a] font-bold text-[#14190e]'
                  : 'bg-[#252f1b] text-[#a7b483] hover:text-[#fed82a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrer un programme..."
          className="rounded border border-[#424f2d] bg-[#0e130b] px-3 py-1 font-mono text-xs text-[#e8efd0] focus:border-[#fed82a] focus:outline-none"
        />
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'bios' ? (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded border border-[#414f2d] bg-[#141b0f] p-5">
              <div className="flex items-center gap-2 font-mono text-sm font-bold text-[#fed82a]">
                <Zap className="h-5 w-5" />
                FIRMWARE CYBERDECK // NIVEAU BIOS ACTUEL : v{player.biosLevel}.0
              </div>
              <p className="mt-2 text-sm text-[#c7d1aa]">
                L&apos;overclocking du BIOS accélère toutes vos vitesses d&apos;exécution de virus et de connexion réseau sans occuper votre slot de Chipset.
              </p>

              <div className="mt-4 space-y-2.5">
                {[1, 2, 3, 4].map((lvl) => {
                  const owned = player.biosLevel >= lvl;
                  const isNext = player.biosLevel + 1 === lvl;
                  const cost = catalog.biosCosts[lvl] ?? 0;
                  return (
                    <div
                      key={lvl}
                      className={`flex items-center justify-between rounded border px-4 py-3 font-mono text-xs ${
                        owned
                          ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                          : isNext
                            ? 'border-[#fed82a]/60 bg-[#232c19] text-[#e8efd0]'
                            : 'border-[#2f3920] bg-[#10140c] text-[#788559]'
                      }`}
                    >
                      <div>
                        <div className="font-bold">
                          BIOS v{lvl}.0 — Cadence d&apos;exécution{' '}
                          {lvl === 1 ? '1.00x (standard)' : lvl === 2 ? '1.32x (+32%)' : lvl === 3 ? '1.69x (+69%)' : '2.25x (+125%)'}
                        </div>
                      </div>
                      {owned ? (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <Check className="h-4 w-4" /> Installé
                        </span>
                      ) : isNext ? (
                        <button
                          type="button"
                          disabled={busyId === 'bios' || player.money < cost}
                          onClick={() => requestBuy('bios', `BIOS v${lvl}.0`, cost, { kind: 'bios' })}
                          className="cyber-btn-amber rounded px-3 py-1.5 cursor-pointer disabled:opacity-40"
                        >
                          Flasher ({cost.toLocaleString()} CR)
                        </button>
                      ) : (
                        <span>Verrouillé</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : tab === 'chipsets' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {buyableChipsets.map((c) => {
              const owned = player.chipsets.includes(c.id);
              const locked = player.level < c.level;
              const isNew = c.level === player.level && !owned;
              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded border border-[#3a4628] bg-[#141a0f] p-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono text-sm font-bold text-[#fed82a]">
                        {c.name}
                        {isNew && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            NEW
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-xs text-[#94a271]">Niv.{Math.max(1, c.level)}</span>
                    </div>
                    <SafeHtml html={c.desc} className="mt-2 text-xs leading-relaxed text-[#cfd8b3]" />
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#28311c] pt-3 font-mono text-xs">
                    <span className="font-bold text-[#fed82a]">{c.price.toLocaleString()} CR</span>
                    {owned ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Check className="h-4 w-4" /> Possédé
                      </span>
                    ) : locked ? (
                      <span className="flex items-center gap-1 text-[#7b885b]">
                        <Lock className="h-3.5 w-3.5" /> Niveau {c.level} requis
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === c.id || player.money < c.price}
                        onClick={() => requestBuy(c.id, `Chipset ${c.name}`, c.price, { kind: 'chipset', id: c.id })}
                        className="cyber-btn-amber flex items-center gap-1.5 rounded px-3 py-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        Acheter
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {buyableViruses.map((v) => {
              const ownedCount = player.viruses.filter((id) => id === v.id).length;
              const locked = player.level < v.level;
              const isNew = v.level === player.level && ownedCount === 0;
              return (
                <div
                  key={v.id}
                  className="flex flex-col justify-between rounded border border-[#3a4628] bg-[#141a0f] p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={`/assets/img/dockicons/xl/${v.id}.png`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = `/assets/img/dockicons/${v.id}.png`;
                      }}
                      alt={v.name}
                      className="h-11 w-11 shrink-0 rounded border border-[#44522f] bg-[#0d110a] p-1 object-contain"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-mono text-sm font-bold text-[#e8efd0]">
                          {v.name}
                        </span>
                        <div className="flex items-center gap-1">
                          {ownedCount > 0 && (
                            <span className="rounded bg-[#253119] px-1.5 py-0.5 font-mono text-[10px] text-[#a7d875]">
                              x{ownedCount}
                            </span>
                          )}
                          {isNew && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                              NEW
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="font-mono text-[11px] text-[#97a574]">
                        {v.id.toUpperCase()} · {v.cc} CC · Niv.{v.level}
                        {v.uses !== null ? ` · ${v.uses} chg` : ''}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-[#cbd4b0]">
                        {formatVirusDesc(v)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[#28311c] pt-2.5 font-mono text-xs">
                    <span className="font-bold text-[#fed82a]">{v.price.toLocaleString()} CR</span>
                    {locked ? (
                      <span className="flex items-center gap-1 text-[#7b885b]">
                        <Lock className="h-3.5 w-3.5" /> Niv.{v.level}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === v.id || player.money < v.price}
                        onClick={() => requestBuy(v.id, v.name, v.price, { kind: 'virus', id: v.id })}
                        className="cyber-btn-amber flex items-center gap-1 rounded px-3 py-1 cursor-pointer disabled:opacity-40"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        Acquérir
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ModalDialog
        open={pending !== null}
        title="Confirmer l'achat"
        maxWidthClass="max-w-md"
        onClose={() => {
          if (!busyId) setPending(null);
        }}
      >
        {pending && (
          <div className="space-y-4 font-mono text-xs">
            <p className="text-[#e8efd0]">
              Confirmer l&apos;achat de <strong className="text-[#fed82a]">{pending.label}</strong> pour{' '}
              <strong className="text-[#fed82a]">{pending.price.toLocaleString()} CR</strong> ?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                disabled={busyId !== null}
                onClick={() => setPending(null)}
                className="cyber-btn rounded px-3 py-1.5 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busyId !== null || player.money < pending.price}
                onClick={confirmBuy}
                className="cyber-btn-amber rounded px-3 py-1.5 cursor-pointer disabled:opacity-40"
              >
                {busyId !== null ? 'Transaction...' : `Acheter (${pending.price.toLocaleString()} CR)`}
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
