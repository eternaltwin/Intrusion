import { useRef, useState } from 'react';
import {
  Award,
  Briefcase,
  Cpu,
  Flame,
  HardDrive,
  LogOut,
  ShoppingBag,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { LangCode, MissionInitParams, PlayerDto } from '@intrusion/shared';
import { api, type CatalogResponse } from '../api/client';
import { ContractsApp } from './ContractsApp';
import { ChallengeApp } from './ChallengeApp';
import { DeckBuilderApp } from './DeckBuilderApp';
import { HackstoreApp } from './HackstoreApp';
import { HardDriveApp } from './HardDriveApp';
import { TerminalConfigApp } from './TerminalConfigApp';

type AppId = 'contracts' | 'challenge' | 'decks' | 'store' | 'storage' | 'config';

interface CyberdeckShellProps {
  player: PlayerDto;
  catalog: CatalogResponse;
  onPlayerUpdate: (p: PlayerDto) => void;
  onLaunchMission: (init: MissionInitParams) => void;
  onLogout: () => void;
}

export function CyberdeckShell({
  player,
  catalog,
  onPlayerUpdate,
  onLaunchMission,
  onLogout,
}: CyberdeckShellProps) {
  const [activeApp, setActiveApp] = useState<AppId>('contracts');
  const [error, setError] = useState<string | null>(null);
  const viewHeadingRef = useRef<HTMLHeadingElement>(null);

  function navigateApp(next: AppId) {
    if (next === activeApp) return;
    setError(null);
    const anyDoc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (!anyDoc.startViewTransition) {
      setActiveApp(next);
      queueMicrotask(() => viewHeadingRef.current?.focus());
      return;
    }
    const transition = anyDoc.startViewTransition(() => {
      setActiveApp(next);
    });
    transition.finished.finally(() => {
      viewHeadingRef.current?.focus();
    });
  }

  async function toggleLang() {
    setError(null);
    try {
      const nextLang: LangCode = player.settings.lang === 'fr' ? 'en' : 'fr';
      const res = await api.updateProfile({ lang: nextLang });
      onPlayerUpdate(res.player);
    } catch (err: any) {
      setError(err.message || 'Impossible de modifier la langue.');
    }
  }

  async function toggleMuteAll() {
    setError(null);
    try {
      const anyOn = player.settings.sfx || player.settings.ambiant || player.settings.beat;
      const res = await api.updateProfile({
        sfx: !anyOn,
        ambiant: !anyOn,
        beat: !anyOn,
      });
      onPlayerUpdate(res.player);
    } catch (err: any) {
      setError(err.message || 'Impossible de modifier les réglages audio.');
    }
  }

  const navItems: Array<{ id: AppId; label: string; icon: any }> = [
    { id: 'contracts', label: 'Missions', icon: Briefcase },
    { id: 'challenge', label: 'Challenge', icon: Flame },
    { id: 'decks', label: 'Decks & Puces', icon: Cpu },
    { id: 'store', label: 'Hackstore', icon: ShoppingBag },
    { id: 'storage', label: 'Disque Dur', icon: HardDrive },
    { id: 'config', label: '.hackrc & OS', icon: Sliders },
  ];

  const anyAudio = player.settings.sfx || player.settings.ambiant || player.settings.beat;

  return (
    <div
      className={`flex h-dvh w-screen flex-col overflow-hidden bg-[#0c1009] ${
        player.settings.crtEffect ? 'crt-overlay' : ''
      }`}
    >
      {/* Persistent Cyberdeck Top Telemetry Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#343f24] bg-[#141a0f] px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="font-mono text-sm font-bold tracking-widest text-[#fed82a]">
            INTRUSION // OS
          </div>

          <div className="hidden h-4 w-px bg-[#344023] sm:block" />

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="rounded border border-[#44522f] bg-[#1d2515] px-2.5 py-1 font-bold text-[#e8efd0]">
              @{player.username}
            </span>
            <span className="flex items-center gap-1 text-[#7be082]">
              <Award className="h-3.5 w-3.5" />
              Niv.{player.level}{' '}
              <span className="text-[10px] text-[#8d9a6a]">
                ({player.xp}/{player.nextLevelXp} XP)
              </span>
            </span>
            <span className="rounded bg-[#28321b] px-2.5 py-1 font-bold text-[#fed82a]">
              {player.money.toLocaleString()} CR
            </span>
            <span className="hidden text-[#95a370] md:inline">
              BIOS v{player.biosLevel}.0
              {player.activeChipset ? ` · [${player.activeChipset.toUpperCase()}]` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={toggleLang}
            className="cyber-btn rounded px-2.5 py-1 uppercase cursor-pointer"
          >
            {player.settings.lang}
          </button>

          <button
            type="button"
            onClick={toggleMuteAll}
            title="Activer / Couper l'audio"
            className="cyber-btn rounded p-1.5 cursor-pointer"
          >
            {anyAudio ? (
              <Volume2 className="h-4 w-4 text-[#7be082]" />
            ) : (
              <VolumeX className="h-4 w-4 text-rose-400" />
            )}
          </button>

          <button
            type="button"
            onClick={onLogout}
            title="Déconnexion"
            className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1 text-rose-300 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      {/* Cyberdeck Module Navigation Dock */}
      <nav className="flex gap-1.5 overflow-x-auto border-b border-[#2a331d] bg-[#11160d] px-4 py-2">
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = activeApp === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigateApp(id)}
              className={`flex shrink-0 items-center gap-2 rounded px-3.5 py-1.5 font-mono text-xs transition cursor-pointer ${
                active
                  ? 'border border-[#fed82a] bg-[#2a351d] font-bold text-[#fed82a] shadow'
                  : 'border border-transparent text-[#9aa876] hover:bg-[#1a2213] hover:text-[#e8efd0]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="border-b border-rose-500/40 bg-rose-950/60 px-4 py-1.5 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Active Application Workspace */}
      <main className="flex-1 overflow-hidden p-4">
        <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">
          {navItems.find((n) => n.id === activeApp)?.label}
        </h1>

        {activeApp === 'contracts' && (
          <ContractsApp
            player={player}
            catalog={catalog}
            onPlayerUpdate={onPlayerUpdate}
            onLaunchMission={onLaunchMission}
          />
        )}
        {activeApp === 'challenge' && <ChallengeApp onLaunchMission={onLaunchMission} />}
        {activeApp === 'decks' && (
          <DeckBuilderApp
            player={player}
            catalog={catalog}
            onPlayerUpdate={onPlayerUpdate}
          />
        )}
        {activeApp === 'store' && (
          <HackstoreApp
            player={player}
            catalog={catalog}
            onPlayerUpdate={onPlayerUpdate}
          />
        )}
        {activeApp === 'storage' && (
          <HardDriveApp
            player={player}
            catalog={catalog}
            onPlayerUpdate={onPlayerUpdate}
          />
        )}
        {activeApp === 'config' && (
          <TerminalConfigApp player={player} onPlayerUpdate={onPlayerUpdate} />
        )}
      </main>

      <footer className="border-t border-[#2a331d] bg-[#10150c] px-4 py-1.5 text-center font-mono text-[11px] text-[#8f9b6c]">
        Intrusion &copy; 2011{' '}
        <a
          href="https://motion-twin.com/"
          target="_blank"
          rel="noreferrer"
          className="text-[#d8dfb8] underline"
        >
          Motion-Twin
        </a>{' '}
        (Assets{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr"
          target="_blank"
          rel="noreferrer"
          className="text-[#d8dfb8] underline"
        >
          CC-BY-NC-SA 4.0
        </a>
        ) &middot; Hébergé à titre non commercial par{' '}
        <a
          href="https://eternaltwin.org"
          target="_blank"
          rel="noreferrer"
          className="text-[#fed82a] underline"
        >
          Eternaltwin
        </a>{' '}
        &middot; Licence{' '}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noreferrer"
          className="text-[#d8dfb8] underline"
        >
          AGPL-3.0
        </a>{' '}
        (
        <a
          href="https://github.com/eternaltwin/intrusion"
          target="_blank"
          rel="noreferrer"
          className="text-[#fed82a] underline"
        >
          Code source
        </a>
        )
      </footer>
    </div>
  );
}
