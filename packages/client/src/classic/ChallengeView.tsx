import { useEffect, useState } from 'react';
import { api, type ChallengeTodayResponse } from '../api/client';
import { SafeHtml } from '../components/SafeHtml';

export function ChallengeView({
  onStartChallenge,
  onNotify,
}: {
  onStartChallenge: () => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const [data, setData] = useState<ChallengeTodayResponse | null>(null);

  useEffect(() => {
    api
      .challengeToday()
      .then(setData)
      .catch((err) => onNotify(err.message || 'Impossible de charger le challenge.', true));
  }, []);

  return (
    <div className="challenge">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Challenge Quotidien // {data?.date ?? '...'}</span>
        </div>

        <div className="container">
          <div className="help" style={{ marginBottom: 15 }}>
            Chaque jour, un réseau haute sécurité identique (Niveau 7) est proposé à tous les
            hackers. Votre <strong>première tentative</strong> de la journée compte pour le
            classement officiel (+1500 <img src="/img/icons/money.png" alt="" /> et +2 XP en cas de
            succès). Les tentatives suivantes sont libres pour l&apos;entraînement !
          </div>

          {!data ? (
            <p>Chargement du contrat quotidien...</p>
          ) : (
            <>
              <div style={{ float: 'left', width: 550 }}>
                <h1>Cible du jour : {data.corp}</h1>
                <p style={{ marginBottom: 8 }}>
                  <strong>Objectif :</strong> {data.short}
                </p>
                <div style={{ marginBottom: 15 }}>
                  <SafeHtml html={data.details} />
                </div>

                {data.hasPlayedRanked && data.playerRankedRun && (
                  <p style={{ marginBottom: 12 }}>
                    Votre tentative classée du jour :{' '}
                    <strong>
                      {data.playerRankedRun.success ? 'SUCCÈS' : 'ÉCHEC'} —{' '}
                      {data.playerRankedRun.score} pts
                    </strong>
                  </p>
                )}

                <a className="button" style={{ width: 220 }} onClick={onStartChallenge}>
                  {data.hasPlayedRanked
                    ? 'Rejouer (Entraînement)'
                    : 'Lancer la tentative classée'}
                </a>
              </div>

              <table className="table ranking">
                <tbody>
                  <tr>
                    <th colSpan={3} className="header">
                      Classement du Jour
                    </th>
                  </tr>
                  {data.leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={3}>
                        <em>Aucun score enregistré aujourd&apos;hui. Soyez le premier !</em>
                      </td>
                    </tr>
                  ) : (
                    data.leaderboard.map((row, i) => (
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

              <div className="clear" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
