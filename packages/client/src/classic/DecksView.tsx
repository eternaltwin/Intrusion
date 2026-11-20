import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import type { ChipsetDef, PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';
import { useVirusTooltip } from './TooltipContext';

export function DecksView({
  player,
  chipsets,
  addDeckCost,
  addSlotCost,
  onPlayerUpdate,
  onNotify,
}: {
  player: PlayerDto;
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<'deck' | 'pool' | null>(null);
  const [dragTargetZone, setDragTargetZone] = useState<'deck' | 'pool' | null>(null);

  useEffect(() => {
    if (!activeDeck) return;
    setDeckViruses(activeDeck.content);
    setDeckName(activeDeck.name);
  }, [activeDeck?.id, activeDeck?.capacity, player.decks]);

  if (!activeDeck) return null;

  const poolViruses = player.viruses.filter((vid) => !deckViruses.includes(vid));
  const ownedChipsets = chipsets.filter((c) => player.chipsets.includes(c.id));

  const persistDeck = async (
    nextContent: string[],
    nextName = deckName,
    nextFav?: boolean,
    silent = true
  ) => {
    try {
      const res = await api.saveDeck(activeDeck.id, {
        name: nextName.trim() || activeDeck.name,
        content: nextContent,
        isFavorite: nextFav,
      });
      onPlayerUpdate(res.player);
      if (!silent) onNotify('Deck sauvegardé.');
    } catch (err: any) {
      onNotify(err.message || 'Erreur de sauvegarde du deck.', true);
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
    if (deckViruses.includes(vid)) return;
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

  const removeFromDeck = (vid: string) => {
    const next = deckViruses.filter((x) => x !== vid);
    setDeckViruses(next);
    persistDeck(next);
  };

  const reorderInDeck = (vid: string, targetIndex: number) => {
    const curIdx = deckViruses.indexOf(vid);
    if (curIdx === -1 || curIdx === targetIndex) return;
    const next = [...deckViruses];
    next.splice(curIdx, 1);
    next.splice(targetIndex, 0, vid);
    setDeckViruses(next);
    persistDeck(next);
  };

  const onDragStartItem = (e: DragEvent, vid: string, src: 'deck' | 'pool') => {
    hideVirus();
    setDraggingId(vid);
    setDragSource(src);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${src}:${vid}`);
  };

  const onDragEndItem = () => {
    setDraggingId(null);
    setDragSource(null);
    setDragTargetZone(null);
  };

  const onDropDeckZone = (e: DragEvent, targetIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragTargetZone(null);
    const raw = e.dataTransfer.getData('text/plain');
    const [src, vid] = raw.includes(':') ? raw.split(':') : [dragSource, draggingId];
    if (!vid) return;
    if (src === 'pool') {
      addFromPool(vid, targetIndex);
    } else if (src === 'deck' && targetIndex !== undefined) {
      reorderInDeck(vid, targetIndex);
    }
    onDragEndItem();
  };

  const onDropPoolZone = (e: DragEvent) => {
    e.preventDefault();
    setDragTargetZone(null);
    const raw = e.dataTransfer.getData('text/plain');
    const [src, vid] = raw.includes(':') ? raw.split(':') : [dragSource, draggingId];
    if (vid && src === 'deck') {
      removeFromDeck(vid);
    }
    onDragEndItem();
  };

  const handleExpandDeck = async () => {
    try {
      const res = await api.buyItem({ kind: 'deck_slot', deckId: activeDeck.id });
      onPlayerUpdate(res.player);
      onNotify(`Capacité du deck augmentée à ${activeDeck.capacity + 1} emplacements !`);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleBuyNewDeck = async () => {
    try {
      const res = await api.buyItem({ kind: 'new_deck' });
      onPlayerUpdate(res.player);
      const newest = res.player.decks[res.player.decks.length - 1];
      if (newest) setSelectedDeckId(newest.id);
      onNotify('Nouveau deck débloqué !');
    } catch (err: any) {
      onNotify(err.message, true);
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
                <img src="/img/icons/none.png" alt="" /> Aucun
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
              onClick={handleBuyNewDeck}
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

          <div className="slots">
            {Array.from({ length: activeDeck.capacity }, (_, i) => (
              <div key={i + 1} className="slot">
                {i + 1}
              </div>
            ))}
          </div>

          <ul
            id="deckContainer"
            className={`bg${dragTargetZone === 'deck' ? ' dragOver' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragTargetZone('deck');
            }}
            onDragLeave={() => setDragTargetZone(null)}
            onDrop={(e) => onDropDeckZone(e)}
          >
            {deckViruses.map((vid, idx) => (
              <li
                key={vid}
                draggable
                className={draggingId === vid ? 'dragging' : ''}
                onDragStart={(e) => onDragStartItem(e, vid, 'deck')}
                onDragEnd={onDragEndItem}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropDeckZone(e, idx)}
                onClick={() => {
                  hideVirus(vid);
                  removeFromDeck(vid);
                }}
                onMouseEnter={() => showVirus(vid)}
                onMouseLeave={() => hideVirus(vid)}
              >
                <img src={`/img/dockicons/${vid}.png`} alt={vid} />
              </li>
            ))}
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
                  <a className="button" onClick={handleExpandDeck}>
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
            {poolViruses.map((vid) => (
              <li
                key={vid}
                draggable
                className={draggingId === vid ? 'dragging' : ''}
                onDragStart={(e) => onDragStartItem(e, vid, 'pool')}
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
    </div>
  );
}
