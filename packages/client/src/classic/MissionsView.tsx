import { useEffect, useState } from 'react';
import type { ChipsetDef, PlayerDto } from '@intrusion/shared';
import { api, type MissionOfferDto, type MissionsListResponse } from '../api/client';
import { useVirusTooltip } from './TooltipContext';
import { SafeHtml } from '../components/SafeHtml';

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
  const { showVirus, hideVirus } = useVirusTooltip();

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
    try {
      const res = await api.refreshMissions();
      setData((prev) => (prev ? { ...prev, available: res.available } : prev));
      onNotify('Nouvelles offres de contrats récupérées sur le réseau.');
    } catch (err: any) {
      onNotify(err.message || 'Erreur lors du renouvellement.', true);
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

  if (selectedOffer) {
    const ownedChipsets = chipsets.filter((c) => player.chipsets.includes(c.id));
    const activeChipDef = chipsets.find((c) => c.id === player.activeChipset);
    const primaryDeck =
      player.decks.find((d) => d.isFavorite) ?? player.decks[0] ?? { name: 'Deck', content: [] };

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
              <div className="chipset">
                <img src="/img/icons/chip.png" alt="" /> Chipset{' '}
                <strong>{activeChipDef ? activeChipDef.name : 'Aucun'}</strong>
                {ownedChipsets.length > 0 && (
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor="chipset">Choisir : </label>
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
                {primaryDeck.content.map((vid) => (
                  <li
                    key={vid}
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
                <a className="optionLink" onClick={handleRefreshOffers}>
                  [Renouveler les offres disponibles]
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
    </div>
  );
}
