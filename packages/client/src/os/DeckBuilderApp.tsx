import { useState } from 'react';
import { Cpu, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import { formatVirusDesc, type PlayerDto, type VirusDef } from '@intrusion/shared';
import { api, type CatalogResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';

interface DeckBuilderAppProps {
  player: PlayerDto;
  catalog: CatalogResponse;
  onPlayerUpdate: (p: PlayerDto) => void;
}

export function DeckBuilderApp({ player, catalog, onPlayerUpdate }: DeckBuilderAppProps) {
  const [selectedDeckId, setSelectedDeckId] = useState<string>(
    (player.decks.find((d) => d.isFavorite) ?? player.decks[0])?.id ?? ''
  );
  const [hoveredVirus, setHoveredVirus] = useState<VirusDef | null>(null);
  const [catFilter, setCatFilter] = useState<string>('all');
  const [editingName, setEditingName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const activeDeck =
    player.decks.find((d) => d.id === selectedDeckId) ?? player.decks[0];

  const usedAcrossAllDecks = new Map<string, number>();
  for (const d of player.decks) {
    for (const vid of d.content) {
      usedAcrossAllDecks.set(vid, (usedAcrossAllDecks.get(vid) ?? 0) + 1);
    }
  }
  const seenOwned = new Map<string, number>();
  const poolViruses: Array<{ def: VirusDef; copyKey: string }> = [];
  for (const id of player.viruses) {
    const seen = (seenOwned.get(id) ?? 0) + 1;
    seenOwned.set(id, seen);
    if (seen <= (usedAcrossAllDecks.get(id) ?? 0)) continue;
    const def = catalog.viruses.find((v) => v.id === id);
    if (!def) continue;
    if (catFilter !== 'all' && def.cat !== catFilter) continue;
    poolViruses.push({ def, copyKey: `${id}_${seen}` });
  }

  async function updateDeckContent(nextContent: string[], overrides?: { name?: string; isFavorite?: boolean }) {
    if (!activeDeck) return;
    setError(null);
    try {
      const res = await api.saveDeck(activeDeck.id, {
        name: overrides?.name ?? activeDeck.name,
        content: nextContent,
        isFavorite: overrides?.isFavorite,
      });
      onPlayerUpdate(res.player);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addVirusToDeck(vid: string) {
    if (!activeDeck) return;
    if (!poolViruses.some((p) => p.def.id === vid)) {
      setError('Aucun exemplaire disponible dans votre réserve.');
      return;
    }
    if (activeDeck.content.length >= activeDeck.capacity) {
      setError(`Capacité maximale atteinte (${activeDeck.capacity} emplacements).`);
      return;
    }
    await updateDeckContent([...activeDeck.content, vid]);
  }

  async function removeVirusAtSlot(slotIdx: number) {
    if (!activeDeck) return;
    const next = [...activeDeck.content];
    next.splice(slotIdx, 1);
    await updateDeckContent(next);
  }

  async function handleBuyNewDeck() {
    setError(null);
    try {
      const res = await api.buyItem({ kind: 'new_deck' });
      onPlayerUpdate(res.player);
      const newest = res.player.decks[res.player.decks.length - 1];
      if (newest) setSelectedDeckId(newest.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleExpandSlot() {
    if (!activeDeck) return;
    setError(null);
    try {
      const res = await api.buyItem({ kind: 'deck_slot', deckId: activeDeck.id });
      onPlayerUpdate(res.player);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleEquipChipset(cid: string | null) {
    setError(null);
    try {
      const res = await api.setChipset(cid);
      onPlayerUpdate(res.player);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const nextDeckCost =
    player.decks.length < 4 ? catalog.addDeckCost[player.decks.length] : null;
  const nextSlotCost =
    activeDeck && activeDeck.capacity < 9 ? catalog.addSlotCost[activeDeck.capacity] : null;

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left: Deck Selector, Active Deck Slots & Chipsets */}
      <div className="flex flex-col gap-4 overflow-y-auto lg:col-span-7">
        {/* Deck Tabs */}
        <div className="cyber-card rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#333e23] pb-3">
            <div className="flex flex-wrap gap-2">
              {player.decks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setSelectedDeckId(d.id);
                    setEditingName('');
                  }}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs transition cursor-pointer ${
                    d.id === activeDeck?.id
                      ? 'border-[#fed82a] bg-[#2a351d] font-bold text-[#fed82a]'
                      : 'border-[#3d4a2a] bg-[#161c10] text-[#a6b382] hover:border-[#6a7c4b]'
                  }`}
                >
                  {d.isFavorite && <Star className="h-3.5 w-3.5 fill-[#fed82a] text-[#fed82a]" />}
                  {d.name} ({d.content.length}/{d.capacity})
                </button>
              ))}

              {nextDeckCost !== null && (
                <button
                  type="button"
                  onClick={handleBuyNewDeck}
                  className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1.5 font-mono text-xs cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 text-[#fed82a]" />
                  Nouveau Deck ({nextDeckCost} CR)
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded border border-rose-500/40 bg-rose-950/50 px-3 py-1.5 font-mono text-xs text-rose-200">
              {error}
            </div>
          )}

          {activeDeck && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingName || activeDeck.name}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      if (editingName.trim() && editingName !== activeDeck.name) {
                        void updateDeckContent(activeDeck.content, { name: editingName.trim() });
                      }
                    }}
                    className="rounded border border-[#3e4b2b] bg-[#0e130b] px-2.5 py-1 font-mono text-sm font-bold text-[#fed82a] focus:border-[#fed82a] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => updateDeckContent(activeDeck.content, { isFavorite: true })}
                    title="Définir comme deck principal par défaut"
                    className={`cyber-btn flex items-center gap-1 rounded px-2.5 py-1 font-mono text-xs cursor-pointer ${
                      activeDeck.isFavorite ? 'border-[#fed82a] text-[#fed82a]' : ''
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" />
                    Favori
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDeckContent([])}
                    className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1 font-mono text-xs cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Vider
                  </button>
                </div>

                {nextSlotCost !== null && (
                  <button
                    type="button"
                    onClick={handleExpandSlot}
                    className="cyber-btn-amber rounded px-3 py-1 font-mono text-xs cursor-pointer"
                  >
                    +1 Slot ({nextSlotCost.toLocaleString()} CR)
                  </button>
                )}
              </div>

              {/* Deck Slots Grid (Drop zone) */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const vid = e.dataTransfer.getData('text/virus-id');
                  if (vid) void addVirusToDeck(vid);
                }}
                className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-5"
              >
                {Array.from({ length: activeDeck.capacity }).map((_, idx) => {
                  const vid = activeDeck.content[idx];
                  const vDef = vid ? catalog.viruses.find((v) => v.id === vid) ?? null : null;
                  return (
                    <div
                      key={idx}
                      onMouseEnter={() => vDef && setHoveredVirus(vDef)}
                      onClick={() => vid && removeVirusAtSlot(idx)}
                      className={`group relative flex h-24 flex-col items-center justify-center rounded border p-2 transition ${
                        vDef
                          ? 'border-[#5a6b3e] bg-[#1d2616] hover:border-rose-400 cursor-pointer'
                          : 'border-dashed border-[#384426] bg-[#10150c]'
                      }`}
                    >
                      <span className="absolute top-1 left-1.5 font-mono text-[10px] text-[#7c895b]">
                        [{player.settings.keybinds[idx] ?? idx + 1}]
                      </span>
                      {vDef ? (
                        <>
                          <img
                            src={`/assets/img/dockicons/xl/${vDef.id}.png`}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = `/assets/img/dockicons/${vDef.id}.png`;
                            }}
                            alt={vDef.name}
                            className="h-10 w-10 object-contain"
                          />
                          <span className="mt-1 truncate max-w-full font-mono text-[11px] font-bold text-[#e8efd0]">
                            {vDef.id.toUpperCase()}
                          </span>
                          <span className="font-mono text-[10px] text-[#fed82a]">{vDef.cc} CC</span>
                          <Trash2 className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-rose-400 opacity-0 group-hover:opacity-100" />
                        </>
                      ) : (
                        <span className="font-mono text-[10px] text-[#58643f]">VIDE</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[11px] text-[#7f8c5e]">
                Astuce : glissez-déposez ou cliquez sur un virus de la réserve pour l&apos;équiper, cliquez sur un slot actif pour le retirer.
              </p>
            </div>
          )}
        </div>

        {/* Chipsets Equip */}
        <div className="cyber-card rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase text-[#fed82a]">
            <Cpu className="h-4 w-4" />
            Chipset Matériel Actif
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleEquipChipset(null)}
              className={`rounded border p-2.5 text-left font-mono text-xs cursor-pointer ${
                !player.activeChipset
                  ? 'border-[#fed82a] bg-[#29331c] text-[#fed82a]'
                  : 'border-[#354024] bg-[#13180e] text-[#98a675]'
              }`}
            >
              <div className="font-bold">Aucun Chipset</div>
              <div className="text-[11px] opacity-80">Fonctionnement standard sans modificateur.</div>
            </button>

            {player.chipsets.map((cid) => {
              const c = catalog.chipsets.find((x) => x.id === cid);
              if (!c) return null;
              const isEquipped = player.activeChipset === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleEquipChipset(c.id)}
                  className={`rounded border p-2.5 text-left transition cursor-pointer ${
                    isEquipped
                      ? 'border-[#fed82a] bg-[#29331c]'
                      : 'border-[#354024] bg-[#13180e] hover:border-[#627543]'
                  }`}
                >
                  <div className="font-mono text-xs font-bold text-[#fed82a]">{c.name}</div>
                  <SafeHtml html={c.desc} className="mt-1 text-[11px] text-[#c7d1aa]" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Owned Virus Reserve + Detailed Tooltip Inspector */}
      <div className="flex flex-col gap-4 overflow-hidden lg:col-span-5">
        <div className="cyber-card flex flex-1 flex-col overflow-hidden rounded-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#343f24] bg-[#1a2213] px-4 py-2.5">
            <span className="font-mono text-xs font-bold uppercase text-[#fed82a]">
              Réserve de Programmes ({poolViruses.length})
            </span>
            <div className="flex gap-1">
              {(['all', 'damage', 'debuff', 'combo', 'utils'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatFilter(cat)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase cursor-pointer ${
                    catFilter === cat
                      ? 'bg-[#fed82a] font-bold text-[#14190e]'
                      : 'bg-[#252f1b] text-[#98a675]'
                  }`}
                >
                  {cat === 'all' ? 'Tous' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto p-3 sm:grid-cols-4">
            {poolViruses.map(({ def: v, copyKey }) => (
              <button
                key={copyKey}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/virus-id', v.id)}
                onMouseEnter={() => setHoveredVirus(v)}
                onFocus={() => setHoveredVirus(v)}
                onClick={() => addVirusToDeck(v.id)}
                className="flex flex-col items-center justify-center rounded border border-[#3a4628] bg-[#151c10] p-2 hover:border-[#fed82a] hover:bg-[#212b19] cursor-pointer"
              >
                <img
                  src={`/assets/img/dockicons/xl/${v.id}.png`}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = `/assets/img/dockicons/${v.id}.png`;
                  }}
                  alt={v.name}
                  className="h-9 w-9 object-contain"
                />
                <span className="mt-1 font-mono text-[11px] font-bold text-[#e8efd0]">
                  {v.id.toUpperCase()}
                </span>
                <span className="font-mono text-[10px] text-[#9ab073]">{v.cc} CC</span>
              </button>
            ))}
          </div>
        </div>

        {/* Virus Specs Inspector */}
        <div className="cyber-card min-h-[150px] rounded-lg p-4">
          {hoveredVirus ? (
            <div className="flex items-start gap-3">
              <img
                src={`/assets/img/dockicons/xl/${hoveredVirus.id}.png`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = `/assets/img/dockicons/${hoveredVirus.id}.png`;
                }}
                alt={hoveredVirus.name}
                className="h-12 w-12 shrink-0 rounded border border-[#495732] bg-[#10150c] p-1 object-contain"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-mono text-sm font-bold text-[#fed82a]">
                    {hoveredVirus.name}{' '}
                    <span className="text-xs text-[#92a06f]">({hoveredVirus.id.toUpperCase()})</span>
                  </h3>
                  <span className="rounded bg-[#26301b] px-2 py-0.5 font-mono text-[11px] text-[#fed82a]">
                    {hoveredVirus.cc} CC · Niv.{hoveredVirus.level}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#d6dec0]">
                  {formatVirusDesc(hoveredVirus)}
                </p>
                {hoveredVirus.uses !== null && (
                  <p className="mt-1 font-mono text-[11px] text-amber-300">
                    Charges par mission : {hoveredVirus.uses}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-[#7f8c5e]">
              Survolez un virus pour inspecter ses caractéristiques tactiques.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
