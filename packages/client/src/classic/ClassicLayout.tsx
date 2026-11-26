import type { ReactNode } from 'react';
import type { PlayerDto } from '@intrusion/shared';
import { useVirusTooltip } from './TooltipContext';

export type ClassicRoute =
  | 'missions'
  | 'challenge'
  | 'decks'
  | 'store'
  | 'storage'
  | 'profile'
  | 'guide'
  | 'options';

export function ClassicLayout({
  player,
  route,
  notice,
  sourceRepoUrl = 'https://github.com/eternaltwin/intrusion',
  onNavigate,
  onLogout,
  children,
}: {
  player: PlayerDto | null;
  route: ClassicRoute;
  notice: { text: string; error?: boolean } | null;
  sourceRepoUrl?: string;
  onNavigate: (r: ClassicRoute) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { hideVirus } = useVirusTooltip();
  const go = (r: ClassicRoute) => {
    hideVirus();
    onNavigate(r);
  };

  return (
    <>
      <div className="mxtophead" id="mxtop">
        <div className="mxtopmenu">
          <div className="mxtopmenucontent">
            {player && (
              <div className="opBar">
                Connecté : <strong>{player.username}</strong> (BIOS v{player.biosLevel})
                <a onClick={() => go('options')}>Options</a>
                <a
                  onClick={() => {
                    hideVirus();
                    onLogout();
                  }}
                >
                  Déconnexion
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="mxhead">
          <a
            className="logo"
            onClick={(e) => {
              e.preventDefault();
              go('missions');
            }}
            href="#missions"
          >
            <img src="/img/design/pixel.gif" alt="Intrusion" />
          </a>

          <div className="mxmainmenu">
            {player ? (
              <>
                <div id="glevel">
                  <span>Niveau {player.level}</span>
                </div>

                <div id="money">
                  <span className="gameMoney">
                    {player.money} <img src="/img/icons/money.png" alt="Crédits" />
                  </span>
                </div>

                <a className="anchor" />

                <a
                  className={route === 'missions' ? 'active' : ''}
                  onClick={() => go('missions')}
                >
                  <img src="/img/icons/disk.png" alt="" /> Missions
                </a>
                <a
                  className={route === 'challenge' ? 'active' : ''}
                  onClick={() => go('challenge')}
                >
                  <img src="/img/icons/admin.png" alt="" /> Challenge
                </a>
                <a
                  className={route === 'decks' ? 'active' : ''}
                  onClick={() => go('decks')}
                >
                  <img src="/img/icons/deck.png" alt="" /> Decks
                </a>
                <a
                  className={route === 'store' ? 'active' : ''}
                  onClick={() => go('store')}
                >
                  <img src="/img/icons/uc.png" alt="" /> Hackstore
                </a>
                <a
                  className={route === 'storage' ? 'active' : ''}
                  onClick={() => go('storage')}
                >
                  <img src="/img/icons/storage.png" alt="" /> Disque Dur
                </a>
                <a
                  className={route === 'profile' ? 'active' : ''}
                  onClick={() => go('profile')}
                >
                  <img src="/img/icons/forum.png" alt="" /> Profil
                </a>
                <a
                  className={route === 'guide' ? 'active' : ''}
                  onClick={() => go('guide')}
                >
                  <img src="/img/icons/help.png" alt="" /> Aide
                </a>
                <a
                  className={route === 'options' ? 'active' : ''}
                  onClick={() => go('options')}
                >
                  <img src="/img/icons/chip.png" alt="" /> Options
                </a>
              </>
            ) : (
              <>
                <a className="active">
                  <img src="/img/icons/uc.png" alt="" /> Accueil &amp; Connexion
                </a>
              </>
            )}
          </div>

          <div className="mxtopmaincontent">
            <div className="mxbottommaincontent">
              <div className="mxbordermaincontent">
                <div className="mxcontent" id="mxcontent">
                  {notice && (
                    <div className={`classicNotice${notice.error ? ' error' : ''}`}>
                      {notice.text}
                    </div>
                  )}
                  {children}
                  <div className="clear" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mxbottom">
          Intrusion &copy; 2011{' '}
          <a href="https://motion-twin.com/" target="_blank" rel="noreferrer">
            Motion-Twin
          </a>{' '}
          (Assets{' '}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr"
            target="_blank"
            rel="noreferrer"
          >
            CC-BY-NC-SA 4.0
          </a>
          ) &middot; Hébergé à titre non commercial par{' '}
          <a href="https://eternaltwin.org" target="_blank" rel="noreferrer">
            Eternaltwin
          </a>{' '}
          &middot; Code libre{' '}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noreferrer"
          >
            AGPL-3.0
          </a>{' '}
          (
          <a href={sourceRepoUrl} target="_blank" rel="noreferrer">
            Code source
          </a>
          )
        </div>
      </div>
    </>
  );
}
