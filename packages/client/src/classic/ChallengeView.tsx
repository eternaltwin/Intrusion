import { useEffect, useState } from 'react';
import type { ChipsetDef, PlayerDto } from '@intrusion/shared';
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
  chipsets,
  onPlayerUpdate,
  onOpenDecks,
  onStartChallenge,
  onNotify,
}: {
  player: PlayerDto;
  chipsets: ChipsetDef[];
  onPlayerUpdate: (p: PlayerDto) => void;
  onOpenDecks: () => void;
  onStartChallenge: (level: number) => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const { showVirus, hideVirus } = useVirusTooltip();
  const [data, setData] = useState<ChallengeTodayResponse | null>(null);
  const [selectedTier, setSelectedTier] = useState<ChallengeTierDto | null>(null);

  useEffect(() => {
    api
      .challengeToday()
      .then(setData)
      .catch((err) => onNotify(err.message || 'Impossible de charger les challenges.', true));
  }, []);

  const handleChipsetChange = async (chipsetId: string) => {
    try {
      const res = await api.setChipset(chipsetId === 'none' ? null : chipsetId);
      onPlayerUpdate(res.player);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  const handleDeckSelect = async (deckId: string) => {
    const target = player.decks.find((d) => d.id === deckId);
    if (!target || target.isFavorite) return;
    try {
      const res = await api.saveDeck(target.id, {
        name: target.name,
        content: target.content,
        isFavorite: true,
      });
      onPlayerUpdate(res.player);
    } catch (err: any) {
      onNotify(err.message, true);
    }
  };

  if (selectedTier) {
    const ownedChipsets = chipsets.filter((c) => player.chipsets.includes(c.id));
    const activeChipDef = chipsets.find((c) => c.id === player.activeChipset);
    const primaryDeck =
      player.decks.find((d) => d.isFavorite) ??
      player.decks[0] ?? { id: '', name: 'Deck', content: [] };

    return (
      <div className="missionDetails">
        <div className="side">
          <img
            src={`/img/design/mission_${selectedTier.difficulty}.png`}
            alt={selectedTier.difficulty}
          />
          <a
            className="button"
            onClick={() => {
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
              challenge.prg -- {DIFFICULTY_LABELS[selectedTier.difficulty]} (Niv.{' '}
              {selectedTier.level})
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
              <p>{selectedTier.level}</p>
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
            <a
              className="button"
              onClick={() => {
                hideVirus();
                onStartChallenge(selectedTier.level);
              }}
            >
              {selectedTier.hasPlayedRanked
                ? 'Rejouer ce challenge (Entraînement)'
                : 'Lancer la tentative classée'}
            </a>
          </div>

          <div className="virusList">
            <div className="wtitle">
              <img className="wbutton" src="/img/design/pixel.gif" alt="" />
              <span>Deck unique utilisé ({primaryDeck.name})</span>
            </div>

            <div className="container">
              {player.decks.length > 1 && (
                <div className="deckSelectRow">
                  <span>
                    <img src="/img/icons/deck.png" alt="" /> Deck :{' '}
                    <strong>{primaryDeck.name}</strong>
                  </span>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor="challenge_deck">Choisir :</label>
                    <select
                      id="challenge_deck"
                      value={primaryDeck.id}
                      onChange={(e) => handleDeckSelect(e.target.value)}
                    >
                      {player.decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </form>
                </div>
              )}

              <div className="chipset">
                <span>
                  <img src="/img/icons/chip.png" alt="" /> Chipset{' '}
                  <strong>{activeChipDef ? activeChipDef.name : 'Aucun'}</strong>
                </span>
                {ownedChipsets.length > 0 && (
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor="challenge_chipset">Choisir :</label>
                    <select
                      id="challenge_chipset"
                      name="chipset"
                      value={player.activeChipset ?? 'none'}
                      onChange={(e) => handleChipsetChange(e.target.value)}
                    >
                      <option value="none">Aucun</option>
                      {ownedChipsets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </form>
                )}
              </div>

              <ul className="virusList">
                {primaryDeck.content.map((vid, idx) => (
                  <li
                    key={`${vid}_${idx}`}
                    onMouseEnter={() => showVirus(vid)}
                    onMouseLeave={() => hideVirus(vid)}
                  >
                    <img src={`/img/dockicons/${vid}.png`} alt={vid} />
                  </li>
                ))}
              </ul>
              <div className="clear" />
              <a
                className="button"
                onClick={() => {
                  hideVirus();
                  onOpenDecks();
                }}
              >
                Modification de Deck/Chipset
              </a>
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
            Chaque jour, <strong>3 challenges</strong> (Niveaux 5, 7 et 9) identiques pour tous les
            joueurs sont proposés sans condition d&apos;accès. Un seul deck est autorisé en
            challenge. Pour chaque palier, votre <strong>première tentative</strong> compte pour le
            classement officiel ; les suivantes permettent de vous entraîner librement !
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
