import type { ChipsetDef, PlayerDto } from '@intrusion/shared';
import { useVirusTooltip } from './TooltipContext';

const STAT_ROWS: Array<{ keys: string[]; label: string }> = [
  { keys: ['missions_fulfilled', 'success'], label: 'Missions remplies' },
  { keys: ['firsttry'], label: 'Missions sans échec' },
  { keys: ['av'], label: "Suppression d'antivirus" },
  { keys: ['crash'], label: 'Systèmes détruits' },
  { keys: ['corrup'], label: 'Systèmes corrompus' },
  { keys: ['log'], label: 'Traces effacées' },
  { keys: ['passwd'], label: 'Mots de passe crackés' },
  { keys: ['eextra'], label: 'Extraction de ressources' },
  { keys: ['mextra'], label: 'Extraction de fichiers de valeur' },
];

export function ProfileView({
  player,
  chipsets,
}: {
  player: PlayerDto;
  chipsets: ChipsetDef[];
}) {
  const { showVirus, hideVirus } = useVirusTooltip();
  const faceId = (player.id % 100) + 1;
  const activeChip = chipsets.find((c) => c.id === player.activeChipset);

  return (
    <div className="userInfos">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Dossier Hacker // {player.username}</span>
        </div>

        <div className="container">
          <div className="avatar">
            <img src={`/img_faces/${faceId}.gif`} alt={player.username} />
          </div>

          <ul className="infos" style={{ clear: 'none', borderTop: 0 }}>
            <li className="name">{player.username}</li>
            <li className="level">
              Niveau {player.level} &middot; XP : {player.xp} / {player.nextLevelXp} &middot; BIOS v
              {player.biosLevel}.0
            </li>
          </ul>

          <div className="clear" />

          <div className="left">
            <h1>Équipement actif</h1>
            <div className="chipset">
              <img src="/img/icons/chip.png" alt="" /> Chipset :{' '}
              <strong>{activeChip ? activeChip.name : 'Aucun'}</strong>
            </div>

            <table className="table userDecks" style={{ marginTop: 12, width: '100%' }}>
              <tbody>
                {player.decks.map((d) => (
                  <tr key={d.id}>
                    <td className="name">
                      {d.isFavorite ? '★ ' : ''}
                      {d.name}
                    </td>
                    <td>
                      <ul className="virusList">
                        {d.content.map((vid) => (
                          <li
                            key={vid}
                            onMouseEnter={() => showVirus(vid)}
                            onMouseLeave={() => hideVirus(vid)}
                          >
                            <img src={`/img/dockicons/${vid}.png`} alt={vid} />
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {player.settings.cfg && (
              <>
                <div className="cfgTitle">Fichier .hackrc</div>
                <div className="cfg">
                  {player.settings.cfg.split(/\r?\n/).map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="right">
            <h1>Statistiques d&apos;Intrusion</h1>
            <table className="table stats">
              <tbody>
                {STAT_ROWS.map((row) => {
                  const total = row.keys.reduce((acc, k) => acc + (player.goals[k] ?? 0), 0);
                  return (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="value">
                        <strong>{total}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="clear" />
        </div>
      </div>
    </div>
  );
}
