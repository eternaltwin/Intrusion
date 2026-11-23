import { useEffect, useState } from 'react';
import { formatVirusDesc, type ChipsetDef, type PlayerDto, type VirusDef, type VirusTarget } from '@intrusion/shared';
import { api } from '../api/client';
import { useVirusTooltip } from './TooltipContext';

type StoreTab = 'home' | 'dmg' | 'debuff' | 'combo' | 'utils' | 'chipset' | 'bios';

const TARGET_LABELS: Record<VirusTarget, string> = {
  _file: 'Fichier / Anti-virus',
  _folder: 'Dossier',
  _none: 'Aucune (système / global)',
  _net: 'Nœud réseau',
};

const BIOS_DESCRIPTIONS: Record<number, string> = {
  2: 'Overclocking BUS v2.0 : accélère sensiblement la vitesse d’exécution de tous vos virus et des animations terminal.',
  3: 'Noyau Temps-Réel v3.0 : vitesse de cast haute fréquence pour neutraliser les antivirus de niveau 6+ avant leur cycle.',
  4: 'Hyperviseur Quantique v4.0 : réactivité maximale du terminal pour les réseaux haute sécurité.',
};

export function StoreView({
  player,
  viruses,
  chipsets,
  biosCosts,
  onPlayerUpdate,
  onNotify,
}: {
  player: PlayerDto;
  viruses: VirusDef[];
  chipsets: ChipsetDef[];
  biosCosts: number[];
  onPlayerUpdate: (p: PlayerDto) => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const [tab, setTab] = useState<StoreTab>('home');
  const [selectedVirusId, setSelectedVirusId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showVirus, hideVirus } = useVirusTooltip();

  useEffect(() => {
    return () => hideVirus();
  }, [hideVirus]);

  const switchTab = (next: StoreTab) => {
    hideVirus();
    setSelectedVirusId(null);
    setTab(next);
  };

  const openVirusDetails = (virusId: string) => {
    hideVirus();
    setSelectedVirusId(virusId);
  };

  const buyVirus = async (v: VirusDef) => {
    setBusyId(v.id);
    try {
      const res = await api.buyItem({ kind: 'virus', id: v.id });
      onPlayerUpdate(res.player);
      onNotify(`Programme ${v.name} ajouté à votre réserve !`);
    } catch (err: any) {
      onNotify(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const buyChipset = async (c: ChipsetDef) => {
    setBusyId(c.id);
    try {
      const res = await api.buyItem({ kind: 'chipset', id: c.id });
      onPlayerUpdate(res.player);
      onNotify(`Chipset ${c.name} acquis ! Vous pouvez l’activer depuis la page Decks.`);
    } catch (err: any) {
      onNotify(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const buyBios = async () => {
    setBusyId('bios');
    try {
      const res = await api.buyItem({ kind: 'bios' });
      onPlayerUpdate(res.player);
      onNotify(`Votre système a été mis à jour vers le BIOS v${res.player.biosLevel} !`);
    } catch (err: any) {
      onNotify(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const renderVirusCategory = (cat: VirusDef['cat'], helpText: string) => {
    const items = viruses
      .filter((v) => v.cat === cat && v.price > 0 && v.level <= player.level)
      .sort((a, b) => a.level - b.level || a.price - b.price);

    return (
      <div className="container">
        <div className="help">{helpText}</div>
        {items.length === 0 ? (
          <p style={{ marginTop: 10 }}>
            Aucun virus disponible dans cette catégorie à votre niveau actuel (Niveau {player.level}).
            Accomplissez des missions pour débloquer de nouveaux programmes !
          </p>
        ) : (
          <table className="table">
            <tbody>
              <tr>
                <th colSpan={2}>Nom</th>
                <th>Coût en Ressources</th>
                <th>Prix</th>
                <th />
              </tr>
              {items.map((v) => {
                const ownedCount = player.viruses.filter((id) => id === v.id).length;
                const out = v.price > player.money;
                return (
                  <tr
                    key={v.id}
                    className="select virus"
                    onMouseEnter={() => showVirus(v.id)}
                    onMouseLeave={() => hideVirus(v.id)}
                    onClick={() => openVirusDetails(v.id)}
                  >
                    <td className="icon">
                      <img src={`/img/dockicons/xl/${v.id}.png`} alt="" />
                      <div />
                    </td>
                    <td className="desc">
                      <div>
                        {v.level === player.level && ownedCount === 0 && (
                          <img className="new" src="/img/design/new.png" alt="Nouveau" />
                        )}{' '}
                        <a
                          href={`#virus-${v.id}`}
                          className="virusDetailLink"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openVirusDetails(v.id);
                          }}
                        >
                          <strong>{v.name}</strong>
                        </a>{' '}
                        {ownedCount > 0 && (
                          <span style={{ color: '#d0d194', fontSize: '8pt' }}>
                            (x{ownedCount})
                          </span>
                        )}{' '}
                        {v.recom && <span className="recom">Recommandé</span>}
                      </div>
                    </td>
                    <td className="cc">
                      <div>{v.cc}</div>
                    </td>
                    <td className="price">
                      <div className={out ? 'out' : ''}>
                        <div className="gameMoney">
                          {v.price} <img src="/img/icons/money.png" alt="" />
                        </div>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {out || busyId === v.id ? (
                        <div className="offButton">Acheter</div>
                      ) : (
                        <a className="button" onClick={() => buyVirus(v)}>
                          Acheter
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const visibleChipsets = chipsets
    .filter((c) => c.price > 0 && c.level <= player.level)
    .sort((a, b) => a.level - b.level || a.price - b.price);

  const selectedVirus = selectedVirusId
    ? viruses.find((v) => v.id === selectedVirusId && v.price > 0 && v.level <= player.level) ?? null
    : null;

  return (
    <div className="shop">
      <ul className="tabs">
        <li id="tab_home" className={tab === 'home' ? 'active' : ''}>
          <a onClick={() => switchTab('home')}>[Accueil]</a>
        </li>
        <li id="tab_dmg" className={tab === 'dmg' ? 'active' : ''}>
          <a onClick={() => switchTab('dmg')}>Virus Dégâts</a>
        </li>
        <li id="tab_debuff" className={tab === 'debuff' ? 'active' : ''}>
          <a onClick={() => switchTab('debuff')}>Virus Afflictions</a>
        </li>
        <li id="tab_combo" className={tab === 'combo' ? 'active' : ''}>
          <a onClick={() => switchTab('combo')}>Virus Combo</a>
        </li>
        <li id="tab_utils" className={tab === 'utils' ? 'active' : ''}>
          <a onClick={() => switchTab('utils')}>Virus Utilitaires</a>
        </li>
        <li id="tab_chipset" className={tab === 'chipset' ? 'active' : ''}>
          <a onClick={() => switchTab('chipset')}>
            <img src="/img/icons/chip.png" alt="" /> Chipsets
          </a>
        </li>
        <li id="tab_bios" className={tab === 'bios' ? 'active' : ''}>
          <a onClick={() => switchTab('bios')}>
            <img src="/img/icons/uc.png" alt="" /> BIOS
          </a>
        </li>
      </ul>

      <div className="window">
        <div className="wtitle">
          <img
            className="wbutton"
            src="/img/design/pixel.gif"
            alt=""
            onClick={selectedVirus ? () => setSelectedVirusId(null) : undefined}
          />
          <span>
            {selectedVirus ? `Catalogue.prg -- ${selectedVirus.id}.prg` : 'Catalogue.prg'}
          </span>
        </div>

        {selectedVirus ? (
          (() => {
            const ownedCount = player.viruses.filter((id) => id === selectedVirus.id).length;
            const out = selectedVirus.price > player.money;
            return (
              <div className="container shopDetails">
                <div className="boxPanel">
                  <div
                    className="vbox"
                    style={{
                      backgroundImage: `url("/img/design/box_${selectedVirus.cat}.png")`,
                    }}
                  >
                    <div className="name">
                      {selectedVirus.id}
                      <em>.prg</em>
                    </div>
                    <img src={`/img/dockicons/xl/${selectedVirus.id}.png`} alt="" />
                  </div>
                  <a
                    href="#catalogue"
                    className="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedVirusId(null);
                    }}
                  >
                    Retour
                  </a>
                </div>

                <div className="detailsPanel">
                  <h1>
                    {selectedVirus.name}{' '}
                    {selectedVirus.recom && <span className="recom">Recommandé</span>}
                  </h1>

                  <dl>
                    <dt>Catégorie</dt>
                    <dd>{selectedVirus.catName}</dd>
                    <dt>Commande terminal</dt>
                    <dd>
                      <code>{selectedVirus.id}.prg</code>
                    </dd>
                    <dt>Cible</dt>
                    <dd>{TARGET_LABELS[selectedVirus.target]}</dd>
                    <dt>Coût en Ressources</dt>
                    <dd>{selectedVirus.cc}</dd>
                    <dt>Utilisations par mission</dt>
                    <dd>
                      {selectedVirus.uses !== null
                        ? `${selectedVirus.uses} par exemplaire`
                        : 'Illimitées'}
                    </dd>
                    <dt>Niveau requis</dt>
                    <dd>Niveau {selectedVirus.level}</dd>
                    <dt>Exemplaires en réserve</dt>
                    <dd>{ownedCount}</dd>
                    <dt>Description</dt>
                    <dd className="virusFullDesc">{formatVirusDesc(selectedVirus)}</dd>
                    <dt>Prix</dt>
                    <dd>
                      <span className="gameMoney">
                        {selectedVirus.price} <img src="/img/icons/money.png" alt="Crédits" />
                      </span>
                    </dd>
                  </dl>

                  {out || busyId === selectedVirus.id ? (
                    <div className="offButton">Acheter</div>
                  ) : (
                    <a
                      href={`#buy-${selectedVirus.id}`}
                      className="button"
                      onClick={(e) => {
                        e.preventDefault();
                        buyVirus(selectedVirus);
                      }}
                    >
                      Acheter
                    </a>
                  )}
                </div>

                <div className="clear" />
              </div>
            );
          })()
        ) : (
          <>
            {tab === 'home' && (
          <div id="home" className="container">
            <div className="help">
              Le HackStore est un espace vous permettant :
              <ul>
                <li>d&apos;acquérir de nouveaux virus utilisables en mission</li>
                <li>d&apos;acquérir des chipsets offrant des avantages secondaires à vos decks</li>
                <li>de mettre à niveau votre BIOS matériel (vitesse d&apos;exécution globale)</li>
              </ul>
              Les achats sont réglés en dépensant vos <img src="/img/icons/money.png" alt="" />.
              Choisissez une section de la boutique en cliquant sur un onglet ci-dessus. De nouveaux
              programmes sont débloqués à chaque montée de niveau !
            </div>
          </div>
        )}

        {tab === 'dmg' &&
          renderVirusCategory(
            'damage',
            'Pas de grande subtilité ici : les virus de type Dégâts sont conçus pour détruire rapidement les fichiers qu’ils ciblent. La plupart de ces virus sont totalement illégaux dans le monde entier.'
          )}

        {tab === 'debuff' &&
          renderVirusCategory(
            'debuff',
            'Les virus de type Afflictions réduisent les capacités des anti-virus qu’ils touchent (voire les annulent totalement).'
          )}

        {tab === 'combo' &&
          renderVirusCategory(
            'combo',
            'Ces virus un peu particuliers consomment des « points de combo ». Ces points s’obtiennent en détruisant un anti-virus : plus vous avez de points, plus l’effet du virus-combo lancé sera puissant.'
          )}

        {tab === 'utils' &&
          renderVirusCategory(
            'utils',
            'La panoplie du hacker : tout un arsenal de gadgets aux effets très variés mais néanmoins indispensables.'
          )}

        {tab === 'chipset' && (
          <div id="chipset" className="container">
            <div className="help">
              Les chipsets sont des améliorations passives pour vos decks. Ils permettent par exemple
              d&apos;accélérer le lancement de vos virus ou d&apos;en réduire le coût en ressources.
            </div>
            {visibleChipsets.length === 0 ? (
              <p style={{ marginTop: 10 }}>
                Les premiers chipsets deviennent disponibles à partir du Niveau 4.
              </p>
            ) : (
              <table className="table">
                <tbody>
                  <tr>
                    <th>Nom</th>
                    <th>Description</th>
                    <th>Niveau</th>
                    <th>Prix</th>
                    <th />
                  </tr>
                  {visibleChipsets.map((c) => {
                    const bought = player.chipsets.includes(c.id);
                    const out = !bought && c.price > player.money;
                    return (
                      <tr key={c.id} className="select chipset">
                        <td className="name">
                          <div>
                            <img src="/img/icons/chip.png" alt="" />{' '}
                            {c.level === player.level && !bought && (
                              <img className="new" src="/img/design/new.png" alt="Nouveau" />
                            )}{' '}
                            {c.name}
                          </div>
                        </td>
                        <td className="desc">
                          <div>{c.desc}</div>
                        </td>
                        <td className="cc">
                          <div>{c.level}</div>
                        </td>
                        <td className={`price${bought ? ' bought' : ''}`}>
                          <div className={out ? 'out' : ''}>
                            <div className="gameMoney">
                              {c.price} <img src="/img/icons/money.png" alt="" />
                            </div>
                          </div>
                        </td>
                        <td>
                          {bought ? (
                            <div className="offButton">Acquis</div>
                          ) : out || busyId === c.id ? (
                            <div className="offButton">Acheter</div>
                          ) : (
                            <a className="button" onClick={() => buyChipset(c)}>
                              Acheter
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'bios' && (
          <div id="bios" className="container">
            <div className="help">
              Les mises à jour du BIOS accélèrent de façon permanente votre vitesse d&apos;exécution
              en mission. Version actuelle : <strong>BIOS v{player.biosLevel}.0</strong>.
            </div>
            <table className="table">
              <tbody>
                <tr>
                  <th>Version</th>
                  <th>Description</th>
                  <th>Prix</th>
                  <th />
                </tr>
                {[2, 3, 4].map((lvl) => {
                  const cost = biosCosts[lvl] ?? 999999;
                  const bought = player.biosLevel >= lvl;
                  const isNext = player.biosLevel + 1 === lvl;
                  const canBuy = isNext && player.money >= cost && busyId !== 'bios';
                  return (
                    <tr key={lvl} className="select chipset">
                      <td className="name">
                        <div>
                          <img src="/img/icons/uc.png" alt="" /> BIOS v{lvl}.0
                        </div>
                      </td>
                      <td className="desc">
                        <div>{BIOS_DESCRIPTIONS[lvl]}</div>
                      </td>
                      <td className={`price${bought ? ' bought' : ''}`}>
                        <div className={!bought && cost > player.money ? 'out' : ''}>
                          <div className="gameMoney">
                            {cost} <img src="/img/icons/money.png" alt="" />
                          </div>
                        </div>
                      </td>
                      <td>
                        {bought ? (
                          <div className="offButton">Installé</div>
                        ) : canBuy ? (
                          <a className="button" onClick={buyBios}>
                            Acheter
                          </a>
                        ) : (
                          <div className="offButton">Acheter</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
