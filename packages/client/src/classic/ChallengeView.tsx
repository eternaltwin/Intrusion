import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  getChallengeMaxSlots,
  isChipsetAllowedInChallenge,
  isVirusAllowedInChallenge,
  type ChipsetDef,
  type PlayerDto,
  type VirusDef,
} from '@intrusion/shared';
import { api, type ChallengeTierDto, type ChallengeTodayResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';
import { useVirusTooltip } from './TooltipContext';

const DIFFICULTY_LABELS: Record<ChallengeTierDto['difficulty'], string> = {
  easy: 'Challenge Facile',
  medium: 'Challenge Moyen',
  hard: 'Challenge Difficile',
};

export function ChallengeView({
  player,
  viruses,
  chipsets,
  onPlayerUpdate,
  onStartChallenge,
  onNotify,
}: {
  player: PlayerDto;
  viruses: VirusDef[];
  chipsets: ChipsetDef[];
  onPlayerUpdate: (p: PlayerDto) => void;
  onStartChallenge: (level: number) => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const { showVirus, hideVirus } = useVirusTooltip();
  const [data, setData] = useState<ChallengeTodayResponse | null>(null);
  const [selectedTier, setSelectedTier] = useState<ChallengeTierDto | null>(null);

  const tierKey = selectedTier ? (String(selectedTier.level) as '5' | '7' | '9') : null;
  const savedLoadout = tierKey ? player.challengeLoadouts[tierKey] : null;

  const [deckViruses, setDeckViruses] = useState<string[]>(savedLoadout?.content ?? []);
  const [chipsetId, setChipsetId] = useState<string | null>(savedLoadout?.chipsetId ?? null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSlotIdx, setDraggingSlotIdx] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<'deck' | 'pool' | null>(null);
  const [dragTargetZone, setDragTargetZone] = useState<'deck' | 'pool' | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [liveMsg, setLiveMsg] = useState('');

  const saveReqIdRef = useRef(0);
  const pendingSavesRef = useRef(0);
  const slotBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    api
      .challengeToday()
      .then(setData)
      .catch((err) => onNotify(err.message || 'Impossible de charger les challenges.', true));
  }, []);

  useEffect(() => {
    return () => hideVirus();
  }, [hideVirus]);

  useEffect(() => {
    if (!savedLoadout) return;
    setDeckViruses(savedLoadout.content);
    setChipsetId(savedLoadout.chipsetId);
  }, [selectedTier?.level]);

  useEffect(() => {
    if (!savedLoadout) return;
    if (pendingSavesRef.current === 0) {
      setDeckViruses(savedLoadout.content);
      setChipsetId(savedLoadout.chipsetId);
    }
  }, [savedLoadout]);

  const virusMap = useMemo(() => {
    const m = new Map<string, VirusDef>();
    for (const v of viruses) m.set(v.id, v);
    return m;
  }, [viruses]);

  const maxSlots = getChallengeMaxSlots(player.decks);

  const persistLoadout = async (
    level: 5 | 7 | 9,
    nextChipset: string | null,
    nextContent: string[]
  ) => {
    const reqId = ++saveReqIdRef.current;
    pendingSavesRef.current++;
    try {
      const res = await api.saveChallengeLoadout(level, {
        chipsetId: nextChipset,
        content: nextContent,
      });
      if (reqId === saveReqIdRef.current) {
        onPlayerUpdate(res.player);
      }
    } catch (err: any) {
      if (reqId === saveReqIdRef.current) {
        const fallback = player.challengeLoadouts[String(level) as '5' | '7' | '9'];
        if (fallback) {
          setDeckViruses(fallback.content);
          setChipsetId(fallback.chipsetId);
        }
        onNotify(err.message || 'Erreur lors de la sauvegarde du deck Challenge.', true);
      }
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
    }
  };

  if (selectedTier) {
    const lvl = selectedTier.level;
    const allowedChipsets = chipsets.filter(
      (c) => player.chipsets.includes(c.id) && isChipsetAllowedInChallenge(c, lvl)
    );
    const activeChipDef = allowedChipsets.find((c) => c.id === chipsetId) ?? null;

    // Build filtered reserve: owned viruses allowed at this challenge tier, minus copies in deckViruses
    const usedCounts = new Map<string, number>();
    for (const vid of deckViruses) {
      usedCounts.set(vid, (usedCounts.get(vid) ?? 0) + 1);
    }
    const seenCounts = new Map<string, number>();
    const poolViruses: Array<{ vid: string; copyKey: string }> = [];
    for (const vid of player.viruses) {
      const vDef = virusMap.get(vid);
      if (!isVirusAllowedInChallenge(vDef, lvl)) continue;
      const seen = (seenCounts.get(vid) ?? 0) + 1;
      seenCounts.set(vid, seen);
      const used = usedCounts.get(vid) ?? 0;
      if (seen > used) {
        poolViruses.push({ vid, copyKey: `${vid}_${seen}` });
      }
    }

    const handleChipsetChange = (rawVal: string) => {
      const nextChip = rawVal === 'none' ? null : rawVal;
      setChipsetId(nextChip);
      persistLoadout(lvl, nextChip, deckViruses);
    };

    const addFromPool = (vid: string, insertIndex?: number) => {
      if (!poolViruses.some((p) => p.vid === vid)) return;
      if (deckViruses.length >= maxSlots) {
        onNotify(`Deck Challenge complet (${maxSlots} emplacements maximum).`, true);
        return;
      }
      const next = [...deckViruses];
      if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= next.length) {
        next.splice(insertIndex, 0, vid);
      } else {
        next.push(vid);
      }
      setDeckViruses(next);
      persistLoadout(lvl, chipsetId, next);
    };

    const removeFromDeck = (slotIdx: number) => {
      if (slotIdx < 0 || slotIdx >= deckViruses.length) return;
      const next = [...deckViruses];
      next.splice(slotIdx, 1);
      setDeckViruses(next);
      persistLoadout(lvl, chipsetId, next);
    };

    const reorderInDeck = (fromIdx: number, targetIndex: number, restoreFocus = false) => {
      if (fromIdx < 0 || fromIdx >= deckViruses.length) return;
      const clampedIdx = Math.min(targetIndex, Math.max(0, deckViruses.length - 1));
      if (fromIdx === clampedIdx) return;
      const next = [...deckViruses];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(clampedIdx, 0, moved);
      setDeckViruses(next);
      persistLoadout(lvl, chipsetId, next);
      const movedName = virusMap.get(moved)?.name ?? moved;
      setLiveMsg(`${movedName} déplacé à l'emplacement ${clampedIdx + 1}.`);
      if (restoreFocus) {
        requestAnimationFrame(() => {
          slotBtnRefs.current[clampedIdx]?.focus({ preventScroll: true });
        });
      }
    };

    const onSlotKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        reorderInDeck(idx, idx - 1, true);
      } else if (e.key === 'ArrowRight' && idx < deckViruses.length - 1) {
        e.preventDefault();
        reorderInDeck(idx, idx + 1, true);
      }
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

    return (
      <div className="missionDetails challengeDetails">
        <div className="side">
          <img
            src={`/img/design/mission_${selectedTier.difficulty}.png`}
            alt={selectedTier.difficulty}
          />
          <a
            href="#retour-challenges"
            className="button"
            onClick={(e) => {
              e.preventDefault();
              hideVirus();
              setSelectedTier(null);
            }}
          >
            Retour
          </a>
        </div>

        <div className="window details">
          <div className="wtitle">
            <img
              className="wbutton"
              src="/img/design/pixel.gif"
              alt=""
              onClick={() => {
                hideVirus();
                setSelectedTier(null);
              }}
            />
            <span>
              challenge.prg -- {DIFFICULTY_LABELS[selectedTier.difficulty]} (Niv. {lvl})
            </span>
          </div>

          <div className="container">
            <dl>
              <dt>Objectif</dt>
              <dd>{selectedTier.short}</dd>
              <dt>Cible</dt>
              <p>
                <strong>{selectedTier.corp}</strong>
              </p>
              <dt>Niveau</dt>
              <p>{lvl}</p>
              <dt>Détail de l&apos;offre</dt>
              <SafeHtml html={selectedTier.details} />
              <dt>Récompense (1ère tentative classée réussie)</dt>
              <p>
                +{selectedTier.rewardMoney} <img src="/img/icons/money.png" alt="" /> et +
                {selectedTier.rewardXp} XP
              </p>
              {selectedTier.hasPlayedRanked && selectedTier.playerRankedRun && (
                <>
                  <dt>Votre score officiel du jour</dt>
                  <p>
                    <strong>
                      {selectedTier.playerRankedRun.success ? 'SUCCÈS' : 'ÉCHEC'} —{' '}
                      {selectedTier.playerRankedRun.score} pts
                    </strong>
                  </p>
                </>
              )}
            </dl>
            {deckViruses.length === 0 ? (
              <div className="offButton">Ajoutez au moins un virus au deck ci-dessous</div>
            ) : (
              <a
                href={`#start-challenge-${lvl}`}
                className="button"
                onClick={(e) => {
                  e.preventDefault();
                  hideVirus();
                  onStartChallenge(lvl);
                }}
              >
                {selectedTier.hasPlayedRanked
                  ? 'Rejouer ce challenge (Entraînement)'
                  : 'Lancer la tentative classée'}
              </a>
            )}
          </div>

          <div className="virusList challengeDeckBuilder">
            <div className="wtitle">
              <img className="wbutton" src="/img/design/pixel.gif" alt="" />
              <span>
                Deck Challenge Niv. {lvl} ({deckViruses.length}/{maxSlots})
              </span>
            </div>

            <div className="container">
              <div className="chipset">
                <span>
                  <img src="/img/icons/chip.png" alt="" /> Chipset{' '}
                  <strong>{activeChipDef ? activeChipDef.name : 'Aucun'}</strong>
                </span>
                <form onSubmit={(e) => e.preventDefault()}>
                  <label htmlFor="challenge_chipset">Choisir :</label>
                  <select
                    id="challenge_chipset"
                    name="chipset"
                    value={activeChipDef ? activeChipDef.id : 'none'}
                    onChange={(e) => handleChipsetChange(e.target.value)}
                  >
                    <option value="none">Aucun</option>
                    {allowedChipsets.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </form>
              </div>

              <div className="challengeBuilderHead">
                <span>Emplacements ({deckViruses.length}/{maxSlots})</span>
                {deckViruses.length > 0 && (
                  <a
                    href="#vider-deck-challenge"
                    className="challengeClearLink"
                    onClick={(e) => {
                      e.preventDefault();
                      hideVirus();
                      setDeckViruses([]);
                      persistLoadout(lvl, chipsetId, []);
                    }}
                  >
                    Vider
                  </a>
                )}
              </div>

              <ul
                className={`challengeSlots${dragTargetZone === 'deck' ? ' dragOver' : ''}`}
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
                {Array.from({ length: maxSlots }, (_, idx) => {
                  const vid = deckViruses[idx];
                  const isOver = dragOverSlot === idx;
                  const slotKey = `cslot_${idx}_${vid ?? 'empty'}`;
                  const vName = vid ? virusMap.get(vid)?.name ?? vid : '';
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
                      onMouseEnter={() => showVirus(vid)}
                      onMouseLeave={() => hideVirus(vid)}
                    >
                      <button
                        ref={(el) => {
                          slotBtnRefs.current[idx] = el;
                        }}
                        type="button"
                        className="slotBtn"
                        aria-label={`Retirer ${vName} (emplacement ${idx + 1}, Alt+Flèches pour réordonner)`}
                        onKeyDown={(e) => onSlotKeyDown(e, idx)}
                        onClick={() => {
                          hideVirus(vid);
                          removeFromDeck(idx);
                        }}
                      >
                        <img src={`/img/dockicons/${vid}.png`} alt="" />
                      </button>
                      <div className="id">{idx + 1}</div>
                    </li>
                  ) : (
                    <li
                      key={`cslot_${idx}_empty`}
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

              <div className="challengeBuilderHead" style={{ marginTop: 10 }}>
                <span>
                  Réserve autorisée — Niv. &le; {lvl} ({poolViruses.length})
                </span>
              </div>

              <ul
                className={`challengePool${dragTargetZone === 'pool' ? ' dragOver' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragTargetZone('pool');
                }}
                onDragLeave={() => setDragTargetZone(null)}
                onDrop={onDropPoolZone}
              >
                {poolViruses.length === 0 ? (
                  <li className="challengePoolEmpty">
                    Aucun autre programme possédé éligible pour le Niveau {lvl}.
                  </li>
                ) : (
                  poolViruses.map(({ vid, copyKey }) => {
                    const vName = virusMap.get(vid)?.name ?? vid;
                    return (
                      <li
                        key={copyKey}
                        draggable
                        className={draggingKey === copyKey ? 'dragging' : ''}
                        onDragStart={(e) => onDragStartItem(e, vid, 'pool', copyKey)}
                        onDragEnd={onDragEndItem}
                        onMouseEnter={() => showVirus(vid)}
                        onMouseLeave={() => hideVirus(vid)}
                      >
                        <button
                          type="button"
                          className="slotBtn"
                          aria-label={`Ajouter ${vName} au deck Challenge`}
                          onClick={() => {
                            hideVirus(vid);
                            addFromPool(vid);
                          }}
                        >
                          <img src={`/img/dockicons/${vid}.png`} alt="" />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              <div className="challengeLiveRegion" aria-live="polite">
                {liveMsg}
              </div>
            </div>
          </div>
        </div>
        <div className="clear" />
      </div>
    );
  }

  return (
    <div className="challenge">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Challenges Quotidiens // {data?.date ?? '...'}</span>
        </div>

        <div className="container">
          <div className="help">
            Chaque jour, <strong>3 challenges</strong> (Niveaux 5, 7 et 9) sont proposés avec un{' '}
            <strong>deck dédié sauvegardé par palier</strong> : seuls vos programmes et chipsets de
            niveau inférieur ou égal au challenge sont autorisés (hors changement de deck). Votre{' '}
            <strong>première tentative</strong> compte pour le classement officiel !
          </div>

          {!data ? (
            <p>Chargement des challenges du jour...</p>
          ) : (
            <>
              <div className="mlist">
                {data.challenges.map((ch) => (
                  <a
                    key={ch.level}
                    className={`file${ch.hasPlayedRanked && ch.playerRankedRun?.success ? ' succeed' : ''}`}
                    onClick={() => setSelectedTier(ch)}
                  >
                    <img
                      className="diff"
                      src={`/img/design/mission_${ch.difficulty}.png`}
                      alt={ch.difficulty}
                    />
                    <div className="level">{ch.level}</div>
                    <div className="label">
                      <strong>{ch.corp}</strong> — {ch.short}
                    </div>
                  </a>
                ))}
                <div className="clear" />
              </div>

              <h1>Classements du Jour</h1>

              {data.challenges.map((ch) => (
                <table key={ch.level} className="table ranking">
                  <tbody>
                    <tr>
                      <th colSpan={3} className="header">
                        <img
                          src={`/img/design/mission_${ch.difficulty}.png`}
                          alt=""
                          style={{ width: 16, height: 16, verticalAlign: 'middle', marginRight: 5 }}
                        />
                        {DIFFICULTY_LABELS[ch.difficulty]} (Niv. {ch.level})
                      </th>
                    </tr>
                    {ch.leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={3}>
                          <em>Aucun score enregistré aujourd&apos;hui.</em>
                        </td>
                      </tr>
                    ) : (
                      ch.leaderboard.map((row, i) => (
                        <tr key={row.username}>
                          <td className="pos">#{i + 1}</td>
                          <td className="name">
                            <strong>{row.username}</strong>
                          </td>
                          <td className="score">{row.bestScore}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ))}

              <div className="clear" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
