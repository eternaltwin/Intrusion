import { useState, type FormEvent } from 'react';
import type { PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function OptionsView({
  player,
  onPlayerUpdate,
  onLogout,
  onNotify,
}: {
  player: PlayerDto;
  onPlayerUpdate: (p: PlayerDto) => void;
  onLogout: () => void;
  onNotify: (msg: string, error?: boolean) => void;
}) {
  const [sfx, setSfx] = useState(player.settings.sfx);
  const [ambiant, setAmbiant] = useState(player.settings.ambiant);
  const [beat, setBeat] = useState(player.settings.beat);
  const [leet, setLeet] = useState(player.settings.leet);
  const [adult, setAdult] = useState(player.settings.adult);
  const [lang, setLang] = useState<'fr' | 'en'>(player.settings.lang);
  const [cfg, setCfg] = useState(player.settings.cfg);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.updateProfile({
        sfx,
        ambiant,
        beat,
        leet,
        adult,
        lang,
        cfg,
      });
      onPlayerUpdate(res.player);
      onNotify('Vos paramètres système et votre fichier .hackrc ont été enregistrés.');
    } catch (err: any) {
      onNotify(err.message || 'Erreur lors de la sauvegarde des options.', true);
    }
  };

  return (
    <div className="options">
      <div className="window">
        <div className="wtitle">
          <img className="wbutton" src="/img/design/pixel.gif" alt="" />
          <span>Configuration Système // Config.sys</span>
        </div>

        <div className="container">
          <form onSubmit={handleSave}>
            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={sfx}
                  onChange={(e) => setSfx(e.target.checked)}
                />{' '}
                <strong>Activer les bruitages d&apos;interface et d&apos;action (SFX)</strong>
              </label>
            </div>

            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={ambiant}
                  onChange={(e) => setAmbiant(e.target.checked)}
                />{' '}
                <strong>Activer les nappes d&apos;ambiance réseau</strong>
              </label>
            </div>

            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={beat}
                  onChange={(e) => setBeat(e.target.checked)}
                />{' '}
                <strong>Activer les rythmes dynamiques en zone hostile</strong>
              </label>
            </div>

            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={adult}
                  onChange={(e) => setAdult(e.target.checked)}
                />{' '}
                <strong>Autoriser les textes non censurés dans les fichiers cibles</strong>
              </label>
            </div>

            <div className="row">
              <label>
                <input
                  type="checkbox"
                  checked={leet}
                  onChange={(e) => setLeet(e.target.checked)}
                />{' '}
                <strong>Mode Uber-Eleet (Terminal en ligne de commande)</strong>
              </label>
              <em>
                Active l&apos;invite de commande en bas du terminal pendant les missions pour lancer
                vos virus au clavier.
              </em>
            </div>

            <div className="row">
              <label htmlFor="langSelect">
                <strong>Langue des systèmes cibles : </strong>
              </label>
              <select
                id="langSelect"
                value={lang}
                onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'fr')}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>

            <div className="row">
              <label htmlFor="hackrc">
                <strong>Configuration .hackrc (Alias Uber-Eleet, 1 par ligne) :</strong>
              </label>
              <em>Exemple : alias d = dmgm</em>
              <textarea
                id="hackrc"
                className="text"
                value={cfg}
                onChange={(e) => setCfg(e.target.value)}
              />
            </div>

            <input type="submit" className="button" value="Enregistrer les options" />
          </form>

          <div style={{ borderTop: '1px dashed #71754c', paddingTop: 12 }}>
            <a className="button" onClick={onLogout}>
              Se déconnecter du compte
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
