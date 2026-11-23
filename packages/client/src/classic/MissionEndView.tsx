import type { MissionEndSummary, ValuableDef, VirusDef } from '@intrusion/shared';
import { useVirusTooltip } from './TooltipContext';

const GOAL_LABELS: Record<string, string> = {
  log: 'Traces effacées',
  corrup: 'Systèmes corrompus',
  crash: 'Systèmes détruits',
  passwd: 'Mots de passe crackés',
  eextra: 'Extraction de ressources',
  mextra: 'Extraction de fichiers de valeur',
  av: "Suppression d'antivirus",
  success: 'Missions remplies',
  missions_fulfilled: 'Missions remplies',
  firsttry: 'Missions sans échec',
  challenge_pass_5: 'Challenges Faciles réussis',
  challenge_pass_7: 'Challenges Moyens réussis',
  challenge_pass_9: 'Challenges Difficiles réussis',
  challenge_top3_5: 'Top 3 Challenge Facile',
  challenge_top3_7: 'Top 3 Challenge Moyen',
  challenge_top3_9: 'Top 3 Challenge Difficile',
};

export interface DebriefState {
  summary: MissionEndSummary;
  earnedMoney: number;
  earnedXp: number;
  scoutRun: boolean;
  previousLevel: number;
  newLevel: number;
  nextRetryPrime: number;
  isRankedChallenge?: boolean;
}

export function MissionEndView({
  debrief,
  valuablesCatalog,
  virusesCatalog,
  onRetry,
  onOpenDecks,
  onOpenTutorials,
  onOpenStorage,
  onFinish,
}: {
  debrief: DebriefState;
  valuablesCatalog: ValuableDef[];
  virusesCatalog: VirusDef[];
  onRetry: () => void;
  onOpenDecks: () => void;
  onOpenTutorials: () => void;
  onOpenStorage: () => void;
  onFinish: () => void;
}) {
  const { showVirus, hideVirus } = useVirusTooltip();
  const { summary, earnedMoney, scoutRun, previousLevel, newLevel, nextRetryPrime } = debrief;

  const valMap = new Map(valuablesCatalog.map((v) => [v.id, v.name]));
  const goalEntries = Object.entries(summary.goals).filter(([, v]) => (v ?? 0) > 0);
  const unlockedViruses =
    newLevel > previousLevel
      ? virusesCatalog.filter((v) => v.level > previousLevel && v.level <= newLevel && v.price > 0)
      : [];

  return (
    <div className="missionEnd">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" onClick={onFinish} />
          <span>
            Débriefing {summary.isChallenge ? 'Challenge du Jour' : `Mission #${summary.seed}`}
          </span>
        </div>

        <div className="container">
          <div className={summary.success ? 'headerSuccess' : 'headerFailure'} />

          <div className="result">
            {summary.success ? (
              <div className="left">
                {scoutRun ? (
                  <p>
                    <strong>Reconnaissance Scout terminée :</strong> ce run d&apos;exploration ne
                    clôture pas le contrat afin que vous puissiez l&apos;exécuter pour de vrai.
                  </p>
                ) : (
                  <p>
                    Votre client vous a transféré la somme de <strong>{earnedMoney}</strong>{' '}
                    <img src="/img/icons/money.png" alt="" /> !
                  </p>
                )}

                {summary.isChallenge && (
                  <p style={{ marginTop: 8 }}>
                    Score Challenge : <strong className="score">{summary.score} pts</strong>
                  </p>
                )}

                {newLevel > previousLevel && (
                  <div className="levelUp">
                    <div className="title">
                      Félicitations ! Vous passez au Niveau {newLevel} !
                    </div>
                    {unlockedViruses.length > 0 && (
                      <>
                        <p>Nouveaux virus disponibles au Hackstore :</p>
                        <ul>
                          {unlockedViruses.map((v) => (
                            <li
                              key={v.id}
                              onMouseEnter={() => showVirus(v.id)}
                              onMouseLeave={() => hideVirus(v.id)}
                            >
                              <img src={`/img/dockicons/${v.id}.png`} alt={v.name} /> {v.name}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {goalEntries.length > 0 && (
                  <div className="goals">
                    Vos statistiques sur Intrusion ont augmenté :
                    <ul>
                      {goalEntries.map(([gid, val]) => (
                        <li key={gid}>
                          {GOAL_LABELS[gid] ?? gid} <strong>+{val}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="left">
                <p>
                  <strong>Vous n&apos;avez pas réussi à remplir les objectifs de votre mission...</strong>
                </p>
                <p>
                  N&apos;hésitez pas à modifier le contenu de votre deck pour adapter votre stratégie
                  à la situation ou à vous procurer de nouveaux virus au Hackstore.
                </p>
                <p>
                  Vous pouvez également rejouer l&apos;une des{' '}
                  <a onClick={onOpenTutorials}>missions du tutoriel</a>.
                </p>
                {!summary.isChallenge && (
                  <p>
                    <strong>
                      Votre client a réduit la prime pour cette mission à {nextRetryPrime}{' '}
                    </strong>
                    <img src="/img/icons/money.png" alt="" />.
                  </p>
                )}
              </div>
            )}

            <div className="right">
              <table className="table">
                <tbody>
                  <tr>
                    <th>Packs Extraits</th>
                  </tr>
                  {summary.valuables.length === 0 ? (
                    <tr>
                      <td>
                        <em>Aucun pack extrait</em>
                      </td>
                    </tr>
                  ) : (
                    summary.valuables.map((vid, idx) => (
                      <tr key={`${vid}_${idx}`}>
                        <td>{valMap.get(vid) ?? vid}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <table className="table">
                <tbody>
                  <tr>
                    <th>Fichiers Copiés</th>
                  </tr>
                  {summary.copiedFiles.length === 0 ? (
                    <tr>
                      <td>
                        <em>Aucun fichier copié</em>
                      </td>
                    </tr>
                  ) : (
                    summary.copiedFiles.map((f, idx) => (
                      <tr key={`${f.name}_${idx}`}>
                        <td>{f.name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div>
                Vous pouvez y accéder depuis votre page{' '}
                <a onClick={onOpenStorage}>disque dur</a>.
              </div>
            </div>
          </div>

          <div className="clear" />

          {summary.success && !scoutRun ? (
            <div className="footer">
              <a
                className="button"
                onClick={() => {
                  hideVirus();
                  onFinish();
                }}
              >
                Terminer
              </a>
            </div>
          ) : (
            <div className="footer">
              <a
                className="button"
                onClick={() => {
                  hideVirus();
                  onRetry();
                }}
              >
                Tenter à nouveau la mission
              </a>
              <a
                className="button"
                onClick={() => {
                  hideVirus();
                  onOpenDecks();
                }}
              >
                Modifier mon deck
              </a>
              <a
                className="button"
                onClick={() => {
                  hideVirus();
                  onFinish();
                }}
              >
                Terminer
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
