import { useState, type FormEvent } from 'react';
import type { PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function AuthView({ onAuthenticated }: { onAuthenticated: (p: PlayerDto) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
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
          <li className={mode === 'login' ? 'active' : ''}>
            <a onClick={() => { setMode('login'); setError(null); }}>Connexion</a>
          </li>
          <li className={mode === 'register' ? 'active' : ''}>
            <a onClick={() => { setMode('register'); setError(null); }}>Nouveau Compte</a>
          </li>
        </ul>

        <div className="window screens">
          <div className="wtitle">
            <img className="wbutton" src="/img/design/pixel.gif" alt="" />
            <span>{mode === 'login' ? 'Login.prg' : 'Register.prg'}</span>
          </div>
          <div className="container">
            <div className="register">
              {error && (
                <p style={{ color: '#ff693e', marginBottom: 8 }}>
                  <strong>{error}</strong>
                </p>
              )}
              <form onSubmit={handleSubmit}>
                <label htmlFor="username">Pseudonyme Hacker :</label>
                <input
                  id="username"
                  type="text"
                  className="field"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
                <label htmlFor="password">Code Secret (4+ caractères) :</label>
                <input
                  id="password"
                  type="password"
                  className="field"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
                <br />
                <input
                  type="submit"
                  className="button"
                  disabled={busy}
                  value={
                    busy
                      ? 'Chargement...'
                      : mode === 'login'
                      ? 'Se connecter'
                      : 'Créer mon accès'
                  }
                />
              </form>
            </div>
          </div>
        </div>
      </div>

      <div className="clear" />
    </div>
  );
}
