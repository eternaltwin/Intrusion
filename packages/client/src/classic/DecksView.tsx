import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ChipsetDef, PlayerDto, VirusDef } from '@intrusion/shared';
import { api } from '../api/client';
import { useVirusTooltip } from './TooltipContext';
import { ModalDialog } from '../components/ModalDialog';

type PendingDeckPurchase = 'expand_slot' | 'new_deck';

export function DecksView({
  player,
  viruses = [],
  chipsets,
  addDeckCost,
  addSlotCost,
  onPlayerUpdate,
  onNotify,
}: {
  player: PlayerDto;
  viruses?: VirusDef[];
  chipsets: ChipsetDef[];
  addDeckCost: number[];
  addSlotCost: number[];
  onPlayerUpdate: (p: PlayerDto) => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const { showVirus, hideVirus } = useVirusTooltip();
  const [selectedDeckId, setSelectedDeckId] = useState<string>(
    () => (player.decks.find((d) => d.isFavorite) ?? player.decks[0])?.id ?? ''
  );
  const activeDeck =
    player.decks.find((d) => d.id === selectedDeckId) ?? player.decks[0];

  const [deckViruses, setDeckViruses] = useState<string[]>(activeDeck?.content ?? []);
  const [deckName, setDeckName] = useState<string>(activeDeck?.name ?? '');
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSlotIdx, setDraggingSlotIdx] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<'deck' | 'pool' | null>(null);
  const [dragTargetZone, setDragTargetZone] = useState<'deck' | 'pool' | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<PendingDeckPurchase | null>(null);
  const [buying, setBuying] = useState(false);
  const saveReqIdRef = useRef(0);
  const pendingSavesRef = useRef(0);

  const virusMap = useMemo(() => {
    const m = new Map<string, VirusDef>();
    for (const v of viruses) m.set(v.id, v);
    return m;
  }, [viruses]);

  useEffect(() => {
    if (!activeDeck) return;
    setDeckName(activeDeck.name);
    setDeckViruses(activeDeck.content);
  }, [activeDeck?.id]);

  useEffect(() => {
    if (!activeDeck) return;
    if (pendingSavesRef.current === 0) {
      setDeckViruses(activeDeck.content);
    }
  }, [activeDeck?.content]);

  if (!activeDeck) return null;

  // Shared virus pool across ALL decks: subtract copies equipped in other decks + current deck
  const usedCounts = new Map<string, number>();
  for (const d of player.decks) {
    if (d.id === activeDeck.id) continue;
    for (const vid of d.content) {
      usedCounts.set(vid, (usedCounts.get(vid) ?? 0) + 1);
    }
  }
  for (const vid of deckViruses) {
    usedCounts.set(vid, (usedCounts.get(vid) ?? 0) + 1);
  }
  const seenCounts = new Map<string, number>();
  const poolViruses: Array<{ vid: string; copyKey: string }> = [];
  for (const vid of player.viruses) {
    const vDef = virusMap.get(vid);
    if (vDef && (vDef.cat === 'hidden' || vDef.cat === 'specials')) continue;
    if (viruses.length > 0 && !vDef) continue;
    const seen = (seenCounts.get(vid) ?? 0) + 1;
    seenCounts.set(vid, seen);
    const used = usedCounts.get(vid) ?? 0;
    if (seen > used) {
      poolViruses.push({ vid, copyKey: `${vid}_${seen}` });
    }
  }

  const ownedChipsets = chipsets.filter((c) => player.chipsets.includes(c.id));

  const persistDeck = async (
    nextContent: string[],
    nextName = deckName,
    nextFav?: boolean,
    silent = true
  ) => {
    const reqId = ++saveReqIdRef.current;
    pendingSavesRef.current++;
    const targetDeckId = activeDeck.id;
    const fallbackName = activeDeck.name;
    try {
      const res = await api.saveDeck(targetDeckId, {
        name: nextName.trim() || fallbackName,
        content: nextContent,
        isFavorite: nextFav,
      });
      if (reqId === saveReqIdRef.current) {
        onPlayerUpdate(res.player);
        if (!silent) onNotify('Deck sauvegardé.');
      }
    } catch (err: any) {
      if (reqId === saveReqIdRef.current) {
        setDeckViruses(activeDeck.content);
        onNotify(err.message || 'Erreur de sauvegarde du deck.', true);
      }
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
    }
  };

  const handleSelectChipset = async (chipId: string | null) => {
    try {
      const res = await api.setChipset(chipId);
      onPlayerUpdate(res.player);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const addFromPool = (vid: string, insertIndex?: number) => {
    const hasFreeCopy = poolViruses.some((p) => p.vid === vid);
    if (!hasFreeCopy) {
      onNotify('Aucun exemplaire disponible dans votre réserve.', true);
      return;
    }
    if (deckViruses.length >= activeDeck.capacity) {
      onNotify(`Ce deck est plein (${activeDeck.capacity} emplacements maximum).`, true);
      return;
    }
    const next = [...deckViruses];
    if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= next.length) {
      next.splice(insertIndex, 0, vid);
    } else {
      next.push(vid);
    }
    setDeckViruses(next);
    persistDeck(next);
  };

  const removeFromDeck = (slotIdx: number) => {
    if (slotIdx < 0 || slotIdx >= deckViruses.length) return;
    const next = [...deckViruses];
    next.splice(slotIdx, 1);
    setDeckViruses(next);
    persistDeck(next);
  };

  const reorderInDeck = (fromIdx: number, targetIndex: number) => {
    if (fromIdx < 0 || fromIdx >= deckViruses.length) return;
    const clampedIdx = Math.min(targetIndex, Math.max(0, deckViruses.length - 1));
    if (fromIdx === clampedIdx) return;
    const next = [...deckViruses];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(clampedIdx, 0, moved);
    setDeckViruses(next);
    persistDeck(next);
  };

  const onDragStartItem = (
    e: DragEvent,
    vid: string,
    src: 'deck' | 'pool',
    key: string,
    slotIdx?: number
  ) => {
    hideVirus();
    setDraggingKey(key);
    setDraggingId(vid);
    setDraggingSlotIdx(slotIdx ?? null);
    setDragSource(src);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${src}:${vid}:${slotIdx ?? -1}`);
  };

  const onDragEndItem = () => {
    setDraggingKey(null);
    setDraggingId(null);
    setDraggingSlotIdx(null);
    setDragSource(null);
    setDragTargetZone(null);
    setDragOverSlot(null);
  };

  const onDropDeckZone = (e: DragEvent, targetIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragTargetZone(null);
    setDragOverSlot(null);
    const raw = e.dataTransfer.getData('text/plain');
    const parts = raw.split(':');
    const src = (parts[0] as 'deck' | 'pool') || dragSource;
    const vid = parts[1] || draggingId;
    const parsedSlot = parts[2] !== undefined ? parseInt(parts[2], 10) : NaN;
    const fromSlot = !Number.isNaN(parsedSlot) && parsedSlot >= 0 ? parsedSlot : draggingSlotIdx;
    if (!vid) return;
    if (src === 'pool') {
      addFromPool(vid, targetIndex);
    } else if (src === 'deck' && fromSlot !== null && targetIndex !== undefined) {
      reorderInDeck(fromSlot, targetIndex);
    }
    onDragEndItem();
  };

  const onDropPoolZone = (e: DragEvent) => {
    e.preventDefault();
    setDragTargetZone(null);
    const raw = e.dataTransfer.getData('text/plain');
    const parts = raw.split(':');
    const src = (parts[0] as 'deck' | 'pool') || dragSource;
    const parsedSlot = parts[2] !== undefined ? parseInt(parts[2], 10) : NaN;
    const fromSlot = !Number.isNaN(parsedSlot) && parsedSlot >= 0 ? parsedSlot : draggingSlotIdx;
    if (src === 'deck' && fromSlot !== null) {
      removeFromDeck(fromSlot);
    }
    onDragEndItem();
  };

  const confirmDeckPurchase = async () => {
    if (!pendingPurchase) return;
    setBuying(true);
    try {
      if (pendingPurchase === 'expand_slot') {
        const prevCap = activeDeck.capacity;
        const res = await api.buyItem({ kind: 'deck_slot', deckId: activeDeck.id });
        onPlayerUpdate(res.player);
        setPendingPurchase(null);
        onNotify(`Capacité du deck augmentée à ${prevCap + 1} emplacements !`);
      } else {
        const res = await api.buyItem({ kind: 'new_deck' });
        onPlayerUpdate(res.player);
        const newest = res.player.decks[res.player.decks.length - 1];
        if (newest) setSelectedDeckId(newest.id);
        setPendingPurchase(null);
        onNotify('Nouveau deck débloqué !');
      }
    } catch (err: any) {
      onNotify(err.message, true);
    } finally {
      setBuying(false);
    }
  };

  const handleRenameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await persistDeck(deckViruses, deckName, undefined, false);
  };

  const expandCost = activeDeck.capacity < 9 ? addSlotCost[activeDeck.capacity] ?? null : null;
  const nextDeckCost = player.decks.length < 4 ? addDeckCost[player.decks.length] ?? null : null;

  return (
    <div className="decks">
      <div className="window chipsets">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Choix du Chipset Actif</span>
        </div>

        <div className="container">
          <ul>
            <li className={`chipset${!player.activeChipset ? ' active' : ''}`}>
              <a onClick={() => handleSelectChipset(null)}>
                <img src="/img/icons/delete.png" alt="" /> Aucun
              </a>
            </li>
            {ownedChipsets.map((c) => (
              <li
                key={c.id}
                className={`chipset${player.activeChipset === c.id ? ' active' : ''}`}
                title={c.desc}
              >
                <a onClick={() => handleSelectChipset(c.id)}>
                  <img src="/img/icons/chip.png" alt="" /> {c.name}
                </a>
              </li>
            ))}
          </ul>
          <div className="clear" />
        </div>
      </div>

      <ul className="tabs">
        {player.decks.map((d) => (
          <li key={d.id} className={d.id === activeDeck.id ? 'active' : ''}>
            <a onClick={() => setSelectedDeckId(d.id)}>
              {d.isFavorite ? '★ ' : ''}
              {d.name}
            </a>
          </li>
        ))}
        {nextDeckCost !== null && (
          <li>
            <a
              href="#buy-new-deck"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                hideVirus();
                setPendingPurchase('new_deck');
              }}
              title={
                player.money >= nextDeckCost
                  ? 'Acheter un deck supplémentaire'
                  : 'Crédits insuffisants'
              }
            >
              + Ajouter un Deck ({nextDeckCost} <img src="/img/icons/money.png" alt="" />)
            </a>
          </li>
        )}
      </ul>

      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>
            Contenu du Deck ({deckViruses.length}/{activeDeck.capacity})
          </span>
        </div>

        <div className="container">
          <div className="help">
            Grâce à votre souris, faites glisser (ou cliquez sur) les icônes depuis votre réserve
            vers un emplacement de votre deck. Les changements sont automatiquement sauvegardés.
          </div>

          <ul
            id="deckContainer"
            className={`bg${dragTargetZone === 'deck' ? ' dragOver' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragTargetZone('deck');
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragTargetZone(null);
                setDragOverSlot(null);
              }
            }}
            onDrop={(e) => onDropDeckZone(e)}
          >
            {Array.from({ length: activeDeck.capacity }, (_, idx) => {
              const vid = deckViruses[idx];
              const isOver = dragOverSlot === idx;
              const slotKey = `slot_${idx}_${vid ?? 'empty'}`;
              return vid ? (
                <li
                  key={slotKey}
                  draggable
                  className={`filledSlot${draggingKey === slotKey ? ' dragging' : ''}${isOver ? ' slotDragOver' : ''}`}
                  onDragStart={(e) => onDragStartItem(e, vid, 'deck', slotKey, idx)}
                  onDragEnd={onDragEndItem}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragTargetZone('deck');
                    setDragOverSlot(idx);
                  }}
                  onDrop={(e) => onDropDeckZone(e, idx)}
                  onClick={() => {
                    hideVirus(vid);
                    removeFromDeck(idx);
                  }}
                  onMouseEnter={() => showVirus(vid)}
                  onMouseLeave={() => hideVirus(vid)}
                >
                  <img src={`/img/dockicons/${vid}.png`} alt={vid} />
                  <div className="id">{idx + 1}</div>
                </li>
              ) : (
                <li
                  key={`slot_${idx}_empty`}
                  className={`emptySlot${isOver ? ' slotDragOver' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragTargetZone('deck');
                    setDragOverSlot(idx);
                  }}
                  onDrop={(e) => onDropDeckZone(e, idx)}
                >
                  <div className="id">{idx + 1}</div>
                </li>
              );
            })}
          </ul>

          <div className="infos">
            <div className="actions">
              <a
                className="button"
                onClick={() => persistDeck(deckViruses, deckName, undefined, false)}
              >
                Sauvegarder
              </a>

              {deckViruses.length > 0 ? (
                <a
                  className="button"
                  onClick={() => {
                    setDeckViruses([]);
                    persistDeck([]);
                  }}
                >
                  Ré-initialiser
                </a>
              ) : (
                <div className="offButton">Ré-initialiser</div>
              )}

              {expandCost !== null ? (
                player.money >= expandCost ? (
                  <a
                    href="#expand-deck"
                    className="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      hideVirus();
                      setPendingPurchase('expand_slot');
                    }}
                  >
                    Agrandir ce deck ({expandCost} <img src="/img/icons/money.png" alt="" />)
                  </a>
                ) : (
                  <div className="offButton">
                    Agrandir ce deck ({expandCost} <img src="/img/icons/money.png" alt="" />)
                  </div>
                )
              ) : (
                <div className="offButton">Taille maximale (9)</div>
              )}

              {!activeDeck.isFavorite ? (
                <a
                  className="button"
                  onClick={() => persistDeck(deckViruses, deckName, true, false)}
                >
                  Définir comme favori
                </a>
              ) : (
                <div className="offButton">Deck favori actif</div>
              )}
            </div>

            <form onSubmit={handleRenameSubmit}>
              <input
                className="field"
                type="text"
                id="deckName"
                name="name"
                maxLength={32}
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />{' '}
              <input className="button" type="submit" value="Renommer" />
            </form>
          </div>
          <div className="clear" />
        </div>
      </div>

      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Réserve ({poolViruses.length})</span>
        </div>
        <div className="container">
          <ul
            id="poolContainer"
            className={`bg${dragTargetZone === 'pool' ? ' dragOver' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragTargetZone('pool');
            }}
            onDragLeave={() => setDragTargetZone(null)}
            onDrop={onDropPoolZone}
          >
            {poolViruses.map(({ vid, copyKey }) => (
              <li
                key={copyKey}
                draggable
                className={draggingKey === copyKey ? 'dragging' : ''}
                onDragStart={(e) => onDragStartItem(e, vid, 'pool', copyKey)}
                onDragEnd={onDragEndItem}
                onClick={() => {
                  hideVirus(vid);
                  addFromPool(vid);
                }}
                onMouseEnter={() => showVirus(vid)}
                onMouseLeave={() => hideVirus(vid)}
              >
                <img src={`/img/dockicons/${vid}.png`} alt={vid} />
              </li>
            ))}
          </ul>
          <div className="clear" />
        </div>
      </div>

      <ModalDialog
        open={pendingPurchase !== null}
        variant="classic"
        maxWidthClass="max-w-md"
        title={
          pendingPurchase === 'expand_slot'
            ? 'Deck_manager.prg -- Agrandir le deck'
            : 'Deck_manager.prg -- Nouveau deck'
        }
        onClose={() => {
          if (!buying) setPendingPurchase(null);
        }}
      >
        {pendingPurchase && (() => {
          const cost =
            pendingPurchase === 'expand_slot' ? expandCost ?? 0 : nextDeckCost ?? 0;
          const canAfford = cost > 0 && player.money >= cost;

          return (
            <div>
              {pendingPurchase === 'expand_slot' ? (
                <p className="classicPopupLead">
                  Ajouter un emplacement supplémentaire au deck{' '}
                  <strong>{activeDeck.name}</strong> ({activeDeck.capacity} →{' '}
                  <strong>{activeDeck.capacity + 1} emplacements</strong>) pour{' '}
                  <strong>
                    {cost}{' '}
                    <img
                      src="/img/icons/money.png"
                      alt=""
                      style={{ display: 'inline', height: '14px', width: '14px', verticalAlign: '-2px' }}
                    />
                  </strong>{' '}
                  ?
                </p>
              ) : (
                <p className="classicPopupLead">
                  Débloquer un <strong>deck supplémentaire</strong> (Deck #{player.decks.length + 1}
                  , 3 emplacements initiaux) pour{' '}
                  <strong>
                    {cost}{' '}
                    <img
                      src="/img/icons/money.png"
                      alt=""
                      style={{ display: 'inline', height: '14px', width: '14px', verticalAlign: '-2px' }}
                    />
                  </strong>{' '}
                  ?
                </p>
              )}

              {canAfford ? (
                <div className="classicPopupWarn">
                  Solde après achat :{' '}
                  <strong>
                    {player.money - cost}{' '}
                    <img
                      src="/img/icons/money.png"
                      alt=""
                      style={{ display: 'inline', height: '13px', width: '13px', verticalAlign: '-2px' }}
                    />
                  </strong>
                </div>
              ) : (
                <div className="classicPopupError">
                  Crédits insuffisants ({player.money} / {cost}{' '}
                  <img
                    src="/img/icons/money.png"
                    alt=""
                    style={{ display: 'inline', height: '13px', width: '13px', verticalAlign: '-2px' }}
                  />
                  ).
                </div>
              )}

              <div className="classicPopupActions">
                <button
                  type="button"
                  autoFocus
                  disabled={buying}
                  onClick={() => setPendingPurchase(null)}
                  className="classicPopupBtn secondary"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={buying || !canAfford}
                  onClick={confirmDeckPurchase}
                  className="classicPopupBtn"
                >
                  {buying ? (
                    'Transaction...'
                  ) : (
                    <>
                      Confirmer ({cost}{' '}
                      <img
                        src="/img/icons/money.png"
                        alt=""
                        style={{ display: 'inline', height: '13px', width: '13px', verticalAlign: '-2px' }}
                      />
                      )
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })()}
      </ModalDialog>
    </div>
  );
}
