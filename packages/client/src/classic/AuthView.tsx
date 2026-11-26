import { useState, type FormEvent } from 'react';
import type { AuthConfigDto, PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function AuthView({
  authConfig,
  onAuthenticated,
}: {
  authConfig: AuthConfigDto;
  onAuthenticated: (p: PlayerDto) => void;
}) {
  const [devUsername, setDevUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDevSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!devUsername.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.devLogin(devUsername.trim());
      onAuthenticated(res.player);
    } catch (err: any) {
      setError(err.message || 'Erreur de connexion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authSplit">
      <div className="window infos">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Intrusion.prg // Présentation</span>
        </div>
        <div className="container">
          <p style={{ marginBottom: 12 }}>
            <strong>Plongez dans la scène underground la plus fermée du réseau international.</strong>{' '}
            Oubliez toutes les règles, c&apos;est VOUS qui avez le contrôle.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li style={{ marginBottom: 10 }}>
              <img src="/img/icons/uc.png" alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              <strong>Exploration libre :</strong> infiltrez serveurs, bases de données, terminaux et caméras de sécurité.
            </li>
            <li style={{ marginBottom: 10 }}>
              <img src="/img/icons/disk.png" alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              <strong>Contrats dynamiques :</strong> espionnage, sabotage, vol de documents, effacement de preuves.
            </li>
            <li style={{ marginBottom: 10 }}>
              <img src="/img/icons/chip.png" alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              <strong>Decks &amp; Chipsets :</strong> assemblez vos virus offensifs, furtifs et combos sur mesure.
            </li>
            <li style={{ marginBottom: 10 }}>
              <img src="/img/icons/money.png" alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              <strong>Marché noir :</strong> revendez vos fichiers PACK et encaissez les numéros de cartes volées.
            </li>
            <li>
              <img src="/img/icons/admin.png" alt="" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              <strong>Mode Uber-Eleet :</strong> pilotez vos intrusions intégralement en ligne de commande + alias <em>.hackrc</em>.
            </li>
          </ul>
        </div>
      </div>

      <div className="authBox">
        <ul className="tabs">
          <li className="active">
            <a>Connexion Eternaltwin</a>
          </li>
        </ul>

        <div className="window screens">
          <div className="wtitle">
            <img className="wbutton" src="/img/design/pixel.gif" alt="" />
            <span>Eternaltwin_OAuth.prg</span>
          </div>
          <div className="container">
            <div className="register">
              {error && (
                <p style={{ color: '#ff693e', marginBottom: 8 }}>
                  <strong>{error}</strong>
                </p>
              )}

              <p style={{ marginBottom: 10, fontSize: '8.5pt', lineHeight: 1.4 }}>
                L&apos;authentification est assurée exclusivement par{' '}
                <strong>Eternaltwin (OAuth 2.0)</strong>. Seuls votre identifiant et votre
                pseudonyme public Eternaltwin sont utilisés après votre accord.
              </p>

              {authConfig.etwinEnabled ? (
                <p style={{ marginBottom: 12 }}>
                  <a
                    className="button"
                    href={authConfig.etwinAuthorizePath}
                    style={{ display: 'inline-block', textDecoration: 'none' }}
                  >
                    Se connecter avec Eternaltwin
                  </a>
                </p>
              ) : (
                <p style={{ marginBottom: 10, fontSize: '8.5pt', color: '#fed82a' }}>
                  <em>Client OAuth Eternaltwin non configuré sur cet environnement local.</em>
                </p>
              )}

              {authConfig.devAuthEnabled && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: '1px dashed #71754c',
                  }}
                >
                  <p style={{ marginBottom: 6, fontSize: '8pt', color: '#d0d194' }}>
                    <strong>Simulateur OAuth (Développement local hors-ligne uniquement) :</strong>
                  </p>
                  <form onSubmit={handleDevSubmit}>
                    <label htmlFor="dev-username">Pseudonyme Eternaltwin simulé :</label>
                    <input
                      id="dev-username"
                      type="text"
                      className="field"
                      name="username"
                      value={devUsername}
                      onChange={(e) => setDevUsername(e.target.value)}
                      placeholder="ex: ZeroCool"
                      minLength={2}
                      maxLength={32}
                      required
                    />
                    <br />
                    <input
                      type="submit"
                      className="button"
                      disabled={busy}
                      value={busy ? 'Connexion...' : 'Accès Dev Local'}
                    />
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="clear" />
    </div>
  );
}
