import type { ChipsetDef, PlayerDto } from '@intrusion/shared';
import { useVirusTooltip } from './TooltipContext';

interface StatRowDef {
  keys: string[];
  label: string;
  icon: string;
}

const GENERAL_STAT_ROWS: StatRowDef[] = [
  { keys: ['missions_fulfilled', 'success'], label: 'Missions remplies', icon: 'disk' },
  { keys: ['firsttry'], label: 'Missions sans échec', icon: 'lead1' },
  { keys: ['av'], label: "Suppression d'antivirus", icon: 'av' },
  { keys: ['crash'], label: 'Systèmes détruits', icon: 'screen' },
  { keys: ['corrup'], label: 'Systèmes corrompus', icon: 'admin' },
  { keys: ['log'], label: 'Traces effacées', icon: 'delete' },
  { keys: ['passwd'], label: 'Mots de passe crackés', icon: 'id' },
  { keys: ['eextra'], label: 'Extraction de ressources', icon: 'mana' },
  { keys: ['mextra'], label: 'Extraction de fichiers de valeur', icon: 'pack' },
  { keys: ['cards_redeemed'], label: 'Cartes bancaires détournées', icon: 'cb' },
];

const CHALLENGE_STAT_ROWS: StatRowDef[] = [
  { keys: ['challenge_pass_5'], label: 'Challenges Faciles réussis', icon: 'ismiley_happy' },
  { keys: ['challenge_pass_7'], label: 'Challenges Moyens réussis', icon: 'ismiley_yeah' },
  { keys: ['challenge_pass_9'], label: 'Challenges Difficiles réussis', icon: 'ismiley_cool' },
  { keys: ['challenge_top3_5'], label: 'Top 3 Challenge Facile', icon: 'lead2' },
  { keys: ['challenge_top3_7'], label: 'Top 3 Challenge Moyen', icon: 'lead31' },
  { keys: ['challenge_top3_9'], label: 'Top 3 Challenge Difficile', icon: 'lead3' },
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

  const computeVisibleStats = (rows: StatRowDef[]) =>
    rows
      .map((row) => ({
        ...row,
        total: row.keys.reduce((acc, k) => acc + (player.goals[k] ?? 0), 0),
      }))
      .filter((row) => row.total >= 1);

  const visibleGeneralStats = computeVisibleStats(GENERAL_STAT_ROWS);
  const visibleChallengeStats = computeVisibleStats(CHALLENGE_STAT_ROWS);

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
                        {d.content.map((vid, idx) => (
                          <li
                            key={`${vid}_${idx}`}
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
            {visibleGeneralStats.length === 0 && visibleChallengeStats.length === 0 ? (
              <p style={{ padding: '10px 6px', fontSize: '9pt' }}>
                <em>Aucune statistique enregistrée pour le moment.</em>
              </p>
            ) : (
              <table className="table stats">
                {visibleGeneralStats.length > 0 && (
                  <tbody>
                    {visibleGeneralStats.map((row) => (
                      <tr key={row.label}>
                        <td>
                          <img
                            className="statIcon"
                            src={`/img/icons/${row.icon}.png`}
                            alt=""
                          />
                          {row.label}
                        </td>
                        <td className="value">
                          <strong>{row.total}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
                {visibleChallengeStats.length > 0 && (
                  <tbody
                    className={
                      visibleGeneralStats.length > 0 ? 'statsChallengeGroup' : undefined
                    }
                  >
                    {visibleChallengeStats.map((row) => (
                      <tr key={row.label}>
                        <td>
                          <img
                            className="statIcon"
                            src={`/img/icons/${row.icon}.png`}
                            alt=""
                          />
                          {row.label}
                        </td>
                        <td className="value">
                          <strong>{row.total}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            )}
          </div>

          <div className="clear" />
        </div>
      </div>
    </div>
  );
}
