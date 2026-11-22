import { useEffect, useState } from 'react';
import { getMissionRefreshCost, type ChipsetDef, type PlayerDto } from '@intrusion/shared';
import { api, type MissionOfferDto, type MissionsListResponse } from '../api/client';
import { useVirusTooltip } from './TooltipContext';
import { SafeHtml } from '../components/SafeHtml';
import { ModalDialog } from '../components/ModalDialog';

type MissionTab = 'ongoing' | 'available' | 'tutorial' | 'completed';

export function MissionsView({
  player,
  chipsets,
  initialTab = 'available',
  onPlayerUpdate,
  onStartMission,
  onOpenDecks,
  onNotify,
}: {
  player: PlayerDto;
  chipsets: ChipsetDef[];
  initialTab?: MissionTab;
  onPlayerUpdate: (p: PlayerDto) => void;
  onStartMission: (missionKey: string) => void;
  onOpenDecks: () => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const [tab, setTab] = useState<MissionTab>(initialTab);
  const [data, setData] = useState<MissionsListResponse | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<MissionOfferDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { showVirus, hideVirus } = useVirusTooltip();
  const refreshCost = getMissionRefreshCost(player.level);

  const loadMissions = async () => {
    setLoading(true);
    try {
      const res = await api.missions();
      setData(res);
      if (initialTab === 'available' && res.active.length > 0 && res.available.length === 0) {
        setTab('ongoing');
      }
    } catch (err: any) {
      onNotify(err.message || 'Impossible de charger les missions.', true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMissions();
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const handleRefreshOffers = async () => {
    setRefreshing(true);
    try {
      const res = await api.refreshMissions();
      setData((prev) =>
        prev ? { ...prev, available: res.available, active: [], completed: [] } : prev
      );
      if (res.player) onPlayerUpdate(res.player);
      setConfirmRefreshOpen(false);
      onNotify('Nouvelles offres de contrats récupérées sur le réseau.');
    } catch (err: any) {
      onNotify(err.message || 'Erreur lors du renouvellement.', true);
    } finally {
      setRefreshing(false);
    }
  };

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

  if (selectedOffer) {
    const ownedChipsets = chipsets.filter((c) => player.chipsets.includes(c.id));
    const activeChipDef = chipsets.find((c) => c.id === player.activeChipset);
    const primaryDeck =
      player.decks.find((d) => d.isFavorite) ??
      player.decks[0] ?? { id: '', name: 'Deck', content: [] };

    return (
      <div className="missionDetails">
        <div className="side">
          <img src={`/img/design/mission_${selectedOffer.difficulty}.png`} alt={selectedOffer.difficulty} />
          <a
            className="button"
            onClick={() => {
              hideVirus();
              setSelectedOffer(null);
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
              onClick={() => setSelectedOffer(null)}
            />
            <span>intrusion.prg -- connect={selectedOffer.seed}</span>
          </div>

          <div className="container">
            <dl>
              <dt>Objectif</dt>
              <dd>{selectedOffer.short}</dd>
              <dt>Cible</dt>
              <p>
                <strong>{selectedOffer.corp}</strong>
              </p>
              <dt>Niveau</dt>
              <p>{selectedOffer.level}</p>
              <dt>Date limite de validité</dt>
              <p>{new Date(selectedOffer.expiresAt).toLocaleString('fr-FR')}</p>
              <dt>Détail de l&apos;offre</dt>
              <SafeHtml html={selectedOffer.details} />
              <dt>Prime</dt>
              <p>
                {selectedOffer.effectivePrime} <img src="/img/icons/money.png" alt="" />
              </p>
            </dl>
            <a
              className="button"
              onClick={() => {
                hideVirus();
                onStartMission(selectedOffer.missionKey);
              }}
            >
              Débloquer cette mission
            </a>
          </div>

          <div className="virusList">
            <div className="wtitle">
              <img className="wbutton" src="/img/design/pixel.gif" alt="" />
              <span>Deck utilisé ({primaryDeck.name})</span>
            </div>

            <div className="container">
              {player.decks.length > 1 && (
                <div className="deckSelectRow">
                  <span>
                    <img src="/img/icons/deck.png" alt="" /> Deck principal :{' '}
                    <strong>{primaryDeck.name}</strong>
                  </span>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor="mission_deck">Choisir :</label>
                    <select
                      id="mission_deck"
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
                    <label htmlFor="chipset">Choisir :</label>
                    <select
                      id="chipset"
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

  const renderCard = (m: MissionOfferDto, mode: 'start' | 'details' | 'done') => (
    <a
      key={m.missionKey}
      className={`file${mode === 'done' ? ' succeed' : ''}${m.status === 'active' ? ' unlocked' : ''}`}
      onClick={() => {
        if (mode === 'details') setSelectedOffer(m);
        else if (mode === 'start') onStartMission(m.missionKey);
      }}
    >
      <img className="diff" src={`/img/design/mission_${m.difficulty}.png`} alt={m.difficulty} />
      <div className="level">{m.level}</div>
      <div className="label">{m.short}</div>
      <div className="value">
        <div className="gameMoney">
          {mode === 'done' ? 0 : m.effectivePrime} <img src="/img/icons/money.png" alt="" />
        </div>
      </div>
    </a>
  );

  return (
    <div className="offers missions">
      <ul className="tabs">
        <li id="tab_ongoing" className={tab === 'ongoing' ? 'active' : ''}>
          <a onClick={() => setTab('ongoing')}>En Cours ({data?.active.length ?? 0})</a>
        </li>
        <li id="tab_available" className={tab === 'available' ? 'active' : ''}>
          <a onClick={() => setTab('available')}>Offres du Jour</a>
        </li>
        <li id="tab_tutorial" className={tab === 'tutorial' ? 'active' : ''}>
          <a onClick={() => setTab('tutorial')}>Apprentissage</a>
        </li>
        <li id="tab_completed" className={tab === 'completed' ? 'active' : ''}>
          <a onClick={() => setTab('completed')}>Terminées</a>
        </li>
      </ul>

      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Missions</span>
        </div>

        {loading || !data ? (
          <div className="container">Chargement des offres du réseau...</div>
        ) : (
          <>
            <div id="ongoing" className={`container${tab !== 'ongoing' ? ' hidden' : ''}`}>
              {data.active.length === 0 ? (
                <div className="help">
                  Aucune mission en cours. Consultez l&apos;onglet <strong>Offres du Jour</strong> ou{' '}
                  <strong>Apprentissage</strong> pour lancer une intrusion.
                </div>
              ) : (
                data.active.map((m) => renderCard(m, 'start'))
              )}
              <div className="clear" />
            </div>

            <div id="available" className={`container${tab !== 'available' ? ' hidden' : ''}`}>
              {data.available.map((m) => renderCard(m, 'details'))}
              <div className="clear" />
              <div style={{ marginTop: 10 }}>
                <a className="optionLink" onClick={() => setConfirmRefreshOpen(true)}>
                  [Renouveler les offres disponibles ({refreshCost}{' '}
                  <img
                    src="/img/icons/money.png"
                    alt=""
                    style={{ display: 'inline', height: '14px', width: '14px', verticalAlign: 'text-bottom' }}
                  />
                  )]
                </a>
              </div>
            </div>

            <div id="tutorial" className={`container${tab !== 'tutorial' ? ' hidden' : ''}`}>
              <div className="help" style={{ marginBottom: 10 }}>
                Les missions d&apos;apprentissage vous initient aux bases de l&apos;intrusion système,
                aux antivirus et au contournement de sécurité.
              </div>
              {data.tutorials.map((m) => renderCard(m, 'start'))}
              <div className="clear" />
            </div>

            <div id="completed" className={`container${tab !== 'completed' ? ' hidden' : ''}`}>
              {data.completed.length === 0 ? (
                <div className="help">Aucune mission archivée pour le moment.</div>
              ) : (
                data.completed.map((m) => renderCard(m, 'done'))
              )}
              <div className="clear" />
            </div>
          </>
        )}
      </div>

      <ModalDialog
        open={confirmRefreshOpen}
        variant="classic"
        maxWidthClass="max-w-md"
        title="Renouvellement des offres"
        onClose={() => {
          if (!refreshing) setConfirmRefreshOpen(false);
        }}
      >
        <div>
          <p className="classicPopupLead">
            Renouveler les offres disponibles coûte{' '}
            <strong>
              {refreshCost}{' '}
              <img
                src="/img/icons/money.png"
                alt=""
                style={{ display: 'inline', height: '14px', width: '14px', verticalAlign: '-2px' }}
              />
            </strong>
            .
          </p>
          <div className="classicPopupWarn">
            Attention : vos missions en cours et terminées seront également réinitialisées.
          </div>
          {player.money < refreshCost && (
            <div className="classicPopupError">
              Crédits insuffisants ({player.money} / {refreshCost}{' '}
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
              disabled={refreshing}
              onClick={() => setConfirmRefreshOpen(false)}
              className="classicPopupBtn secondary"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={refreshing || player.money < refreshCost}
              onClick={handleRefreshOffers}
              className="classicPopupBtn"
            >
              {refreshing ? (
                'Renouvellement...'
              ) : (
                <>
                  Confirmer ({refreshCost}{' '}
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
      </ModalDialog>
    </div>
  );
}
