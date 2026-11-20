import { useState } from 'react';
import { Save, Terminal } from 'lucide-react';
import type { PlayerDto } from '@intrusion/shared';
import { api } from '../api/client';

export function TerminalConfigApp({
  player,
  onPlayerUpdate,
}: {
  player: PlayerDto;
  onPlayerUpdate: (p: PlayerDto) => void;
}) {
  const [cfg, setCfg] = useState(player.settings.cfg);
  const [leet, setLeet] = useState(player.settings.leet);
  const [crtEffect, setCrtEffect] = useState(player.settings.crtEffect);
  const [adult, setAdult] = useState(player.settings.adult);
  const [keybinds, setKeybinds] = useState<string[]>([...player.settings.keybinds]);
  const [capturingSlot, setCapturingSlot] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSave() {
    setStatus(null);
    try {
      const res = await api.updateProfile({
        cfg,
        leet,
        crtEffect,
        adult,
        keybinds,
      });
      onPlayerUpdate(res.player);
      setStatus({ ok: true, msg: 'Configuration système enregistrée avec succès.' });
    } catch (e: any) {
      setStatus({ ok: false, msg: e.message });
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-12">
      <div className="cyber-card flex flex-col justify-between rounded-lg p-5 lg:col-span-7">
        <div>
          <div className="flex items-center gap-2 font-mono text-sm font-bold uppercase text-[#fed82a]">
            <Terminal className="h-4 w-4" />
            ÉDITEUR DE PROFIL SHELL (.hackrc) &amp; MODE UBER-ELEET
          </div>
          <p className="mt-1 text-xs text-[#95a370]">
            En mode <strong>Uber-Eleet</strong>, vous pilotez vos virus au clavier via la ligne de commande (+40s bonus de mission et exécution quasi-instantanée). Définissez vos alias ci-dessous :
          </p>

          <label className="mt-4 flex items-center gap-3 rounded border border-[#414f2d] bg-[#141a0f] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={leet}
              onChange={(e) => setLeet(e.target.checked)}
              className="h-4 w-4 accent-[#fed82a]"
            />
            <div>
              <div className="font-mono text-xs font-bold text-[#fed82a]">
                Activer le Mode Uber-Eleet CLI (Ligne de commande en mission)
              </div>
              <div className="text-[11px] text-[#9aa876]">
                Remplace les clics du dock par le terminal shell interactif avec complétion <code>Tab</code>.
              </div>
            </div>
          </label>

          <div className="mt-4">
            <label className="mb-1.5 block font-mono text-xs text-[#b5c291]">
              FICHIER ~/.hackrc (1 directive <code>alias raccourci = commande</code> par ligne)
            </label>
            <textarea
              rows={9}
              value={cfg}
              onChange={(e) => setCfg(e.target.value)}
              spellCheck={false}
              className="w-full rounded border border-[#43512e] bg-[#0a0e08] p-3 font-mono text-xs leading-relaxed text-[#7ee787] focus:border-[#fed82a] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#313b22] pt-4">
          {status ? (
            <span
              className={`font-mono text-xs ${
                status.ok ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {status.msg}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleSave}
            className="cyber-btn-amber flex items-center gap-2 rounded px-4 py-2 font-mono text-xs uppercase cursor-pointer"
          >
            <Save className="h-4 w-4" />
            Sauvegarder .hackrc &amp; Options
          </button>
        </div>
      </div>

      <div className="cyber-card space-y-5 rounded-lg p-5 lg:col-span-5">
        <div>
          <h3 className="font-mono text-xs font-bold uppercase text-[#fed82a]">
            Raccourcis Clavier des 10 Slots du Dock
          </h3>
          <p className="mt-1 text-xs text-[#8f9d6d]">
            Cliquez sur un emplacement puis pressez une touche pour personnaliser son raccourci.
          </p>

          <div className="mt-3 grid grid-cols-5 gap-2">
            {keybinds.map((keyStr, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCapturingSlot(idx)}
                onKeyDown={(e) => {
                  if (capturingSlot === idx) {
                    e.preventDefault();
                    if (e.key !== 'Escape') {
                      const next = [...keybinds];
                      next[idx] = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                      setKeybinds(next);
                    }
                    setCapturingSlot(null);
                  }
                }}
                className={`rounded border py-2 text-center font-mono text-xs cursor-pointer ${
                  capturingSlot === idx
                    ? 'border-[#fed82a] bg-[#334022] text-[#fed82a] animate-pulse'
                    : 'border-[#3d4a2a] bg-[#13180e] text-[#e8efd0]'
                }`}
              >
                <div className="text-[10px] text-[#839162]">Slot {idx + 1}</div>
                <div className="mt-0.5 font-bold">
                  {capturingSlot === idx ? '...' : keyStr}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-[#2f3920] pt-4">
          <h3 className="font-mono text-xs font-bold uppercase text-[#fed82a]">
            Affichage &amp; Contenu
          </h3>

          <label className="flex items-center gap-2.5 text-xs text-[#d4dcba] cursor-pointer">
            <input
              type="checkbox"
              checked={crtEffect}
              onChange={(e) => setCrtEffect(e.target.checked)}
              className="h-4 w-4 accent-[#fed82a]"
            />
            Activer l&apos;effet écran cathodique (Scanlines CRT légères)
          </label>

          <label className="flex items-center gap-2.5 text-xs text-[#d4dcba] cursor-pointer">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              className="h-4 w-4 accent-[#fed82a]"
            />
            Autoriser les textes d&apos;ambiance underground non censurés
          </label>
        </div>
      </div>
    </div>
  );
}
