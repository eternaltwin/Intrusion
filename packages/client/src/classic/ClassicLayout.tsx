import type { ReactNode } from 'react';
import type { PlayerDto } from '@intrusion/shared';

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
  onNavigate,
  onLogout,
  children,
}: {
  player: PlayerDto | null;
  route: ClassicRoute;
  notice: { text: string; error?: boolean } | null;
  onNavigate: (r: ClassicRoute) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mxtophead" id="mxtop">
        <div className="mxtopmenu">
          <div className="mxtopmenucontent">
            {player && (
              <div className="opBar">
                Connecté : <strong>{player.username}</strong> (BIOS v{player.biosLevel})
                <a onClick={() => onNavigate('options')}>Options</a>
                <a onClick={onLogout}>Déconnexion</a>
              </div>
            )}
          </div>
        </div>

        <div className="mxhead">
          <a
            className="logo"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('missions');
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
                  onClick={() => onNavigate('missions')}
                >
                  <img src="/img/icons/disk.png" alt="" /> Missions
                </a>
                <a
                  className={route === 'challenge' ? 'active' : ''}
                  onClick={() => onNavigate('challenge')}
                >
                  <img src="/img/icons/admin.png" alt="" /> Challenge
                </a>
                <a
                  className={route === 'decks' ? 'active' : ''}
                  onClick={() => onNavigate('decks')}
                >
                  <img src="/img/icons/deck.png" alt="" /> Decks
                </a>
                <a
                  className={route === 'store' ? 'active' : ''}
                  onClick={() => onNavigate('store')}
                >
                  <img src="/img/icons/uc.png" alt="" /> Hackstore
                </a>
                <a
                  className={route === 'storage' ? 'active' : ''}
                  onClick={() => onNavigate('storage')}
                >
                  <img src="/img/icons/storage.png" alt="" /> Disque Dur
                </a>
                <a
                  className={route === 'profile' ? 'active' : ''}
                  onClick={() => onNavigate('profile')}
                >
                  <img src="/img/icons/forum.png" alt="" /> Profil
                </a>
                <a
                  className={route === 'guide' ? 'active' : ''}
                  onClick={() => onNavigate('guide')}
                >
                  <img src="/img/icons/help.png" alt="" /> Aide
                </a>
                <a
                  className={route === 'options' ? 'active' : ''}
                  onClick={() => onNavigate('options')}
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
          Intrusion &copy; 2011 Motion-Twin &middot; Édition Remasterisée HiDPI (React 19 + Hono + SQLite + PixiJS)
        </div>
      </div>
    </>
  );
}
