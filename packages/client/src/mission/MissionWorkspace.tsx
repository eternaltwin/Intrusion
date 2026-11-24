import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CornerLeftUp,
  Download,
  Folder,
  FolderLock,
  HardDrive,
  LogOut,
  Radar,
  RefreshCw,
  Shield,
  Skull,
  Terminal as TerminalIcon,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  buildGameDataBundle,
  formatVirusDesc,
  MissionSession,
  type FileNodeState,
  type MissionEndSummary,
  type MissionInitParams,
} from '@intrusion/shared';
import type { CatalogResponse } from '../api/client';
import { soundEngine } from '../audio/SoundEngine';
import { SafeHtml } from '../components/SafeHtml';
import { ModalDialog } from '../components/ModalDialog';
import { TacticalNetworkCanvas } from './TacticalNetworkCanvas';

function getFileSprite(f: FileNodeState): string {
  if (f.isFolder) return '/assets/img/sprites/file_folder.png';
  if ((f.effects.E_Masked ?? 0) > 0) return '/assets/img/sprites/file_misc.png';
  if (f.avKey) return '/assets/img/sprites/file_antivir.png';
  if (f.key === 'file.core') return '/assets/img/sprites/file_mastersystem.png';
  if (f.key === 'file.guardian') return '/assets/img/sprites/file_system.png';
  if (f.key === 'file.control') return '/assets/img/sprites/file_control.png';
  if (f.ext === 'pack') return '/assets/img/sprites/file_pack.png';
  if (f.ext === 'mail') return '/assets/img/sprites/file_mail.png';
  if (f.ext === 'doc' || f.ext === 'pass') return '/assets/img/sprites/file_doc.png';
  if (f.ext === 'lib') return '/assets/img/sprites/file_lib.png';
  if (f.ext === 'video') return '/assets/img/sprites/file_video.png';
  return '/assets/img/sprites/file_sysdoc.png';
}

function getMaskedFileName(f: FileNodeState, hasUnmaskChip: boolean): string {
  if (!(f.effects.E_Masked ?? 0)) return f.name;
  if (!hasUnmaskChip) return '*'.repeat(Math.max(4, f.name.length));
  return Array.from(f.name)
    .map((ch, i) => ((f.id + i) % 3 === 0 ? ch : '*'))
    .join('');
}

function formatTimer(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface MissionWorkspaceProps {
  init: MissionInitParams;
  catalog: CatalogResponse;
  keybinds: string[];
  onFinishMission: (summary: MissionEndSummary) => Promise<void>;
}

export function MissionWorkspace({
  init,
  catalog,
  keybinds,
  onFinishMission,
}: MissionWorkspaceProps) {
  const [session] = useState<MissionSession>(() => {
    const bundle = buildGameDataBundle(init.profile.lang, catalog.rawXml);
    return new MissionSession(bundle, init);
  });

  const [renderTick, setRenderTick] = useState(0);
  const [cliInput, setCliInput] = useState('');
  const [cliSuggestions, setCliSuggestions] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [passwordAttempt, setPasswordAttempt] = useState('');
  const [hoveredSlotIdx, setHoveredSlotIdx] = useState<number | null>(null);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [submittingEnd, setSubmittingEnd] = useState(false);

  const cliRef = useRef<HTMLInputElement>(null);

  // Real-time simulation RAF loop
  useEffect(() => {
    soundEngine.syncSettings({
      sfx: init.profile.sfx,
      ambiant: init.profile.ambiant,
      beat: init.profile.beat,
    });
    soundEngine.processCues(session.drainSounds());

    let lastTs = performance.now();
    let rafId = 0;

    const frame = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      session.tick(dt);
      const cues = session.drainSounds();
      if (cues.length > 0) soundEngine.processCues(cues);
      setRenderTick((t) => (t + 1) % 1000000);
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      soundEngine.stopAll();
    };
  }, [session, init.profile]);

  // Global keyboard shortcuts inside mission
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        if (session.scannerState?.open) {
          session.scannerState = null;
          setRenderTick((t) => t + 1);
          return;
        }
        if (session.pendingPasswordFolderId !== null) {
          session.pendingPasswordFolderId = null;
          setRenderTick((t) => t + 1);
          return;
        }
        if (session.activeCast) {
          session.cancelCast();
          setRenderTick((t) => t + 1);
          return;
        }
      }

      if (inInput) return;

      // Space -> parent folder or disconnect
      if (e.key === ' ' && session.connectedNodeId !== null) {
        e.preventDefault();
        session.goParentOrDisconnect();
        setRenderTick((t) => t + 1);
        return;
      }

      // 'C' -> switch deck when allowed
      if (e.key.toLowerCase() === 'c' && (session.connectedNodeId === null || session.canSwitchDeckInFs)) {
        session.switchDeck();
        setRenderTick((t) => t + 1);
        return;
      }

      // Tab -> cycle files in current folder
      if (e.key === 'Tab' && session.currentSystem && session.currentFolder) {
        e.preventDefault();
        const visibleFiles = session.currentFolder.childrenIds
          .map((id) => session.currentSystem!.files[id])
          .filter((f) => f && !f.deleted);
        if (visibleFiles.length > 0) {
          const curIdx = visibleFiles.findIndex((f) => f.id === session.selectedFileId);
          const next = visibleFiles[(curIdx + 1) % visibleFiles.length];
          session.selectFile(next.id);
          setRenderTick((t) => t + 1);
        }
        return;
      }

      // Hotkeys 1..0 for dock slots
      const slotIdx = keybinds.findIndex((k) => k.toLowerCase() === e.key.toLowerCase());
      if (slotIdx >= 0 && session.connectedNodeId !== null) {
        e.preventDefault();
        session.useDockSlot(slotIdx);
        setRenderTick((t) => t + 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, keybinds]);

  async function triggerFinish(aborted = false) {
    if (submittingEnd) return;
    setSubmittingEnd(true);
    soundEngine.stopAll();
    const { summary } = session.finishMission(aborted);
    await onFinishMission(summary);
  }

  function handleCliSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cliInput.trim()) return;
    session.executeCliCommand(cliInput);
    setCliInput('');
    setCliSuggestions([]);
    setHistoryIdx(-1);
    setRenderTick((t) => t + 1);
  }

  const sys = session.currentSystem;
  const curFolder = session.currentFolder;
  const selectedFile =
    sys && session.selectedFileId !== null ? sys.files[session.selectedFileId] ?? null : null;

  const folderItems: FileNodeState[] =
    sys && curFolder
      ? curFolder.childrenIds
          .map((id) => sys.files[id])
          .filter((f): f is FileNodeState => Boolean(f && !f.deleted))
      : [];

  // Breadcrumb path
  const breadcrumbs: FileNodeState[] = [];
  if (sys && curFolder) {
    let ptr: FileNodeState | null = curFolder;
    while (ptr) {
      breadcrumbs.unshift(ptr);
      ptr = ptr.parentId !== null ? sys.files[ptr.parentId] ?? null : null;
    }
  }

  const combo = session.userEffects.UE_Combo ?? 0;
  const shieldPts = session.userEffects.UE_Shield ?? 0;
  const tutoStep = session.currentTutorialStep;
  const hoveredSlot = hoveredSlotIdx !== null ? session.currentDeck[hoveredSlotIdx] ?? null : null;

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#0a0e08] text-[#e1e8c5]">
      {/* Top Tactical Telemetry Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#344023] bg-[#141b0f] px-4 py-2">
        <div className="flex items-center gap-4">
          {/* Timer */}
          <div
            className={`flex items-center gap-2 rounded border px-3 py-1 font-mono text-sm font-bold ${
              session.alarmRemainingSec !== null
                ? 'animate-pulse border-rose-500 bg-rose-950/70 text-rose-200'
                : session.hasTimer && session.remainingTimeMs < 45000
                  ? 'border-amber-500 bg-amber-950/60 text-amber-200'
                  : 'border-[#45542f] bg-[#0d120a] text-[#fed82a]'
            }`}
          >
            {session.hasTimer ? formatTimer(session.remainingTimeMs) : 'TRAINING // ∞'}
            {session.alarmRemainingSec !== null && (
              <span className="ml-1 rounded bg-rose-600 px-1.5 py-0.5 text-[11px] text-white">
                ALARME {session.alarmRemainingSec}s
              </span>
            )}
          </div>

          {/* Armor Bar */}
          <div className="w-40">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-[#a4b281]">ARMURE</span>
              <span className="font-bold text-[#7be082]">
                {session.life}/{session.lifeTotal}
                {shieldPts > 0 ? ` (+${shieldPts} SHD)` : ''}
              </span>
            </div>
            <div className="mt-0.5 h-2 w-full overflow-hidden rounded bg-[#0c1009] border border-[#333f22]">
              <div
                className="h-full bg-gradient-to-r from-emerald-600 to-[#58f287] transition-all"
                style={{ width: `${(session.life / session.lifeTotal) * 100}%` }}
              />
            </div>
          </div>

          {/* Resources (CC) Bar */}
          <div className="w-40">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-[#a4b281]">RESSOURCES</span>
              <span className="font-bold text-[#fed82a]">
                {session.mana}/{session.manaTotal} CC
              </span>
            </div>
            <div className="mt-0.5 h-2 w-full overflow-hidden rounded bg-[#0c1009] border border-[#333f22]">
              <div
                className="h-full bg-gradient-to-r from-amber-600 to-[#fed82a] transition-all"
                style={{ width: `${(session.mana / session.manaTotal) * 100}%` }}
              />
            </div>
          </div>

          {/* Combo Pips */}
          <div className="flex items-center gap-1 font-mono text-xs">
            <span className="mr-1 text-[11px] text-[#95a370]">COMBO</span>
            {Array.from({ length: session.maxCombo }).map((_, idx) => (
              <span
                key={idx}
                className={`h-3 w-3 rounded-sm border ${
                  idx < combo
                    ? 'border-[#fed82a] bg-[#fed82a] shadow-[0_0_6px_#fed82a]'
                    : 'border-[#3d4a2a] bg-[#0e130b]'
                }`}
              />
            ))}
          </div>

          {/* Active User Buff Pills */}
          <div className="flex flex-wrap gap-1 font-mono text-[10px]">
            {(session.userEffects.UE_Furtivity ?? 0) > 0 && (
              <span className="rounded bg-purple-900/70 px-2 py-0.5 text-purple-200">
                FURTIVITÉ ×{session.userEffects.UE_Furtivity}
              </span>
            )}
            {(session.userEffects.UE_MoveFurtivity ?? 0) > 0 && (
              <span className="rounded bg-indigo-900/70 px-2 py-0.5 text-indigo-200">
                FURTIVITÉ DÉPL. ×{session.userEffects.UE_MoveFurtivity}
              </span>
            )}
            {(session.userEffects.UE_Charge ?? 0) > 0 && (
              <span className="rounded bg-amber-900/70 px-2 py-0.5 text-amber-200">
                CHARGE ×{session.userEffects.UE_Charge}
              </span>
            )}
            {(session.userEffects.UE_DamageBurst ?? 0) > 0 && (
              <span className="rounded bg-rose-900/70 px-2 py-0.5 text-rose-200">
                SURCHARGE +10 (×{session.userEffects.UE_DamageBurst})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          {session.missionObjectiveCompleted && (
            <button
              type="button"
              onClick={() => void triggerFinish(false)}
              className="cyber-btn-amber flex items-center gap-1.5 rounded px-3 py-1.5 animate-pulse cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              Objectif Accompli — Se Déconnecter &amp; Valider !
            </button>
          )}

          {confirmAbort ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void triggerFinish(true)}
                className="rounded border border-rose-500 bg-rose-700 px-2.5 py-1 text-white cursor-pointer"
              >
                Confirmer Abandon ?
              </button>
              <button
                type="button"
                onClick={() => setConfirmAbort(false)}
                className="cyber-btn rounded px-2 py-1 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAbort(true)}
              className="cyber-btn flex items-center gap-1.5 rounded px-2.5 py-1.5 text-rose-300 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Quitter Mission
            </button>
          )}
        </div>
      </header>

      {/* Main 3-Pane Tactical Body */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
        {/* Left Inspector: Briefing, Circe Tutorial & Selected File Content */}
        <aside className="flex flex-col gap-3 overflow-y-auto border-r border-[#2e3820] bg-[#11160d] p-3.5 lg:col-span-3">
          {/* Objective Card */}
          <div className="rounded border border-[#384426] bg-[#171e12] p-3">
            <div className="flex items-center justify-between font-mono text-[11px] uppercase text-[#95a370]">
              <span>CONTRAT // {init.mission.corp}</span>
              {session.missionObjectiveCompleted ? (
                <span className="font-bold text-[#58f287]">ACCOMPLI</span>
              ) : (
                <span className="text-[#fed82a]">EN COURS</span>
              )}
            </div>
            <div className="mt-1 text-xs font-bold text-[#fed82a]">{init.mission.short}</div>
          </div>

          {/* Liaison Agent Circe Tutorial Box */}
          {tutoStep && tutoStep.text && (
            <div className="rounded border border-[#fed82a]/60 bg-[#232b17] p-3 shadow-md">
              <div className="font-mono text-xs font-bold text-[#fed82a]">
                AGENT DE LIAISON CIRCÉ ({session.tutorialIndex + 1}/{session.tutorialSteps.length})
              </div>
              <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[#eef4d8]">
                {tutoStep.text
                  .replace(/::name::/g, init.profile.username)
                  .replace(/\*/g, '')}
              </p>
              <button
                type="button"
                onClick={() => {
                  session.advanceTutorial();
                  setRenderTick((t) => t + 1);
                }}
                className="cyber-btn-amber mt-2.5 w-full rounded py-1 font-mono text-xs cursor-pointer"
              >
                Continuer →
              </button>
            </div>
          )}

          {/* Selected File Reader */}
          <div className="flex flex-1 flex-col overflow-hidden rounded border border-[#343f24] bg-[#0d110a]">
            <div className="border-b border-[#29321c] bg-[#161d11] px-3 py-2 font-mono text-xs font-bold text-[#fed82a]">
              {selectedFile
                ? `INSPECTEUR // ${getMaskedFileName(selectedFile, session.hasChipset('unmask'))}`
                : 'INSPECTEUR DE FICHIER'}
            </div>

            <div className="flex-1 overflow-y-auto p-3 text-xs leading-relaxed">
              {!selectedFile ? (
                <p className="font-mono text-[#6f7c51]">
                  {sys
                    ? 'Cliquez sur un fichier du système pour inspecter son contenu, ses protections ou extraire ses données.'
                    : 'Cliquez sur un noeud accessible de la carte réseau pour lancer la connexion.'}
                </p>
              ) : (selectedFile.effects.E_Masked ?? 0) > 0 ? (
                <div className="rounded border border-purple-500/40 bg-purple-950/30 p-3 font-mono text-purple-200">
                  Fichier masqué par un anti-virus <strong>MASK</strong>. Détruisez l&apos;anti-virus ou utilisez <code>UNMASK</code>.
                </div>
              ) : (selectedFile.effects.E_Encoded ?? 0) > 0 ? (
                <div className="space-y-2">
                  <div className="rounded border border-amber-500/40 bg-amber-950/40 p-2 font-mono text-amber-200">
                    Contenu chiffré — Niveau d&apos;encodage <strong>{selectedFile.effects.E_Encoded}</strong>. Utilisez un décodeur (<code>DEC1..DEC3</code>).
                  </div>
                  <div className="bin rounded border border-dashed border-[#344224] bg-[#080b06] p-2 font-mono text-[11px] text-[#58f287]">
                    --BEGIN ENCRYPTED BLOCK--\n83 E7 5F B2 F3 B7 B7 DF 71 77 26 47\nED 19 86 B8 3F A3 98 27 AC B2 8D F2\n--EOF--
                  </div>
                </div>
              ) : selectedFile.avKey ? (
                <div className="space-y-2">
                  <div className="font-mono font-bold text-rose-400 uppercase">
                    ANTI-VIRUS ACTIF : {selectedFile.avKey}
                  </div>
                  <p className="text-[#d6dec0]">
                    {catalog.antiviruses.find((a) => a.key === selectedFile.avKey)?.desc ?? ''}
                  </p>
                </div>
              ) : selectedFile.ext === 'pack' ? (
                <div className="space-y-3">
                  <p className="text-[#d6dec0]">
                    Archive de données compressées ({(selectedFile.effects.E_PackMana ?? 0) > 0 ? 'Ressources CC' : 'Pack Warez Marché Noir'}).
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      session.extractPack(selectedFile.id);
                      setRenderTick((t) => t + 1);
                    }}
                    className="cyber-btn-amber flex w-full items-center justify-center gap-1.5 rounded py-2 font-mono text-xs cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Extraire les données (EXTRAC)
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedFile.embed?.startsWith('video:') && (
                    <div className="rounded border border-[#3d4b2a] bg-[#12180e] p-3 text-center font-mono">
                      <img
                        src="/assets/img/cine/camera_on.gif"
                        alt="Flux vidéo"
                        className="mx-auto h-28 rounded border border-[#495933] object-cover"
                      />
                      <div className="mt-1.5 text-[10px] text-[#7be082]">
                        FLUX VIDÉO // {selectedFile.name}
                      </div>
                    </div>
                  )}
                  <SafeHtml html={selectedFile.content || '<em>Fichier binaire système.</em>'} />
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Center Tactical Viewport: Network Graph OR Infiltrated Filesystem */}
        <main className="relative flex flex-col overflow-hidden lg:col-span-6">
          {/* Active Cast Progress Overlay */}
          {session.activeCast && (
            <div className="absolute inset-x-6 top-4 z-30 flex items-center justify-between gap-3 rounded-md border border-[#fed82a] bg-[#161e10]/95 px-4 py-2.5 shadow-2xl">
              <div className="flex-1">
                <div className="flex justify-between font-mono text-xs font-bold text-[#fed82a]">
                  <span>EXÉCUTION // {session.activeCast.label}.PRG</span>
                  <span>
                    {Math.min(
                      100,
                      Math.round((session.activeCast.elapsedMs / session.activeCast.durationMs) * 100)
                    )}
                    %
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded bg-[#0a0e08]">
                  <div
                    className="h-full bg-[#fed82a] transition-all duration-75"
                    style={{
                      width: `${Math.min(
                        100,
                        (session.activeCast.elapsedMs / session.activeCast.durationMs) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  session.cancelCast();
                  setRenderTick((t) => t + 1);
                }}
                className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1 font-mono text-xs text-rose-300 cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5" />
                Stop (Esc)
              </button>
            </div>
          )}

          {!sys ? (
            <TacticalNetworkCanvas
              session={session}
              renderTick={renderTick}
              onSelectNode={(n) => {
                session.selectedNetNodeId = n.id;
                setRenderTick((t) => t + 1);
              }}
              onConnectNode={(n) => {
                if (n.type === 'Entrance') {
                  void triggerFinish(false);
                } else {
                  session.connectToNode(n.id);
                  setRenderTick((t) => t + 1);
                }
              }}
            />
          ) : (
            /* Infiltrated System File Explorer */
            <div className="flex h-full flex-col overflow-hidden bg-[#0c110a]">
              {/* System Header & Breadcrumb */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#303b21] bg-[#161e11] px-4 py-2.5">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      session.goParentOrDisconnect();
                      setRenderTick((t) => t + 1);
                    }}
                    className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1 cursor-pointer"
                  >
                    {curFolder?.parentId === null ? (
                      <>
                        <ArrowLeft className="h-3.5 w-3.5 text-amber-300" />
                        Déconnecter (Space)
                      </>
                    ) : (
                      <>
                        <CornerLeftUp className="h-3.5 w-3.5 text-[#fed82a]" />
                        Dossier Parent (Space)
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1 text-[#98a675]">
                    <span className="font-bold text-[#fed82a]">[{sys.ip}]</span>
                    {breadcrumbs.map((b, i) => {
                      const canJump =
                        b.id !== curFolder?.id &&
                        (session.isLeetMode || curFolder?.parentId === b.id);
                      return (
                        <span key={b.id} className="flex items-center gap-1">
                          <span>/</span>
                          {canJump ? (
                            <button
                              type="button"
                              onClick={() => {
                                session.openFolder(b.id);
                                setRenderTick((t) => t + 1);
                              }}
                              className="hover:text-[#fed82a] cursor-pointer"
                            >
                              {i === 0 ? sys.name : b.name}
                            </button>
                          ) : (
                            <span>{i === 0 ? sys.name : b.name}</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  {sys.corrupted && (
                    <span className="rounded bg-emerald-900/70 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                      ROOT ADMIN
                    </span>
                  )}
                  {session.scannerState && (
                    <button
                      type="button"
                      onClick={() => {
                        session.scannerState!.open = true;
                        setRenderTick((t) => t + 1);
                      }}
                      className="cyber-btn flex items-center gap-1 rounded px-2.5 py-1 text-[#7be082] cursor-pointer"
                    >
                      <Radar className="h-3.5 w-3.5" />
                      Carte Scanner
                    </button>
                  )}
                </div>
              </div>

              {/* Files & Folders Grid */}
              <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-4">
                {folderItems.map((f) => {
                  const isSel = session.selectedFileId === f.id;
                  const masked = (f.effects.E_Masked ?? 0) > 0;
                  const displayName = getMaskedFileName(f, session.hasChipset('unmask'));
                  const shieldTotal =
                    (f.effects.E_Shield ?? 0) * 4 + (f.effects.E_CShield ?? 0) * 5;

                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        if (f.isFolder) {
                          session.openFolder(f.id);
                        } else {
                          session.selectFile(f.id);
                        }
                        setRenderTick((t) => t + 1);
                      }}
                      onDoubleClick={() => {
                        if (!f.isFolder && f.ext === 'pack') {
                          session.extractPack(f.id);
                          setRenderTick((t) => t + 1);
                        }
                      }}
                      className={`group relative flex flex-col items-center rounded-lg border p-3 text-center transition cursor-pointer ${
                        isSel
                          ? 'border-[#fed82a] bg-[#26311b] shadow-[0_0_15px_rgba(254,216,42,0.18)]'
                          : f.avKey && !masked
                            ? 'border-rose-500/40 bg-[#1d1414] hover:border-rose-400'
                            : 'border-[#333f23] bg-[#141b0f] hover:border-[#627644] hover:bg-[#1b2415]'
                      }`}
                    >
                      {/* Top Effect Badges */}
                      <div className="mb-1 flex min-h-[16px] flex-wrap justify-center gap-1 font-mono text-[9px]">
                        {f.isMissionTarget && !masked && (
                          <span className="rounded bg-[#fed82a] px-1 font-bold text-[#14190e]">
                            OBJ
                          </span>
                        )}
                        {f.password !== null && (
                          <span className="flex items-center gap-0.5 rounded bg-amber-800/80 px-1 text-amber-200">
                            <FolderLock className="h-2.5 w-2.5" /> PASS
                          </span>
                        )}
                        {(f.effects.E_Encoded ?? 0) > 0 && !masked && (
                          <span className="rounded bg-sky-900/80 px-1 text-sky-200">
                            ENC.{f.effects.E_Encoded}
                          </span>
                        )}
                        {shieldTotal > 0 && !masked && (
                          <span className="flex items-center gap-0.5 rounded bg-cyan-900/80 px-1 text-cyan-200">
                            <Shield className="h-2.5 w-2.5" /> -{shieldTotal}
                          </span>
                        )}
                        {(f.effects.E_Immune ?? 0) > 0 && !masked && (
                          <span className="rounded bg-purple-900/80 px-1 text-purple-200">
                            IMMUNE
                          </span>
                        )}
                        {(f.effects.E_Corrupt ?? 0) > 0 && (
                          <span className="rounded bg-emerald-800/80 px-1 text-emerald-200">
                            CORRUPT
                          </span>
                        )}
                        {(f.effects.E_Copy ?? 0) > 0 && (
                          <span className="rounded bg-emerald-950 px-1 text-emerald-300">
                            COPIÉ
                          </span>
                        )}
                        {(f.effects.E_SkipAction ?? 0) > 0 && (
                          <span className="rounded bg-indigo-900/80 px-1 text-indigo-200">
                            STUN ×{f.effects.E_SkipAction}
                          </span>
                        )}
                        {(f.effects.E_Counter ?? 0) > 0 && (
                          <span className="rounded bg-rose-700 px-1 font-bold text-white">
                            {f.effects.E_Counter}/10
                          </span>
                        )}
                      </div>

                      {/* Authentic File / Folder Icon */}
                      <img
                        src={getFileSprite(f)}
                        alt={displayName}
                        className="h-11 w-11 object-contain"
                      />

                      {/* Crisp HiDPI Filename */}
                      <div className="mt-1.5 max-w-full truncate font-mono text-xs font-semibold text-[#eef4d8]">
                        {displayName}
                      </div>

                      {/* Sub-type / HP Bar (damaged masked files show HP bar like legacy FSNode.hx:731) */}
                      {!f.isFolder && (!masked || (f.lifeTotal > 1 && f.life < f.lifeTotal)) && (
                        <div className="mt-1.5 w-full">
                          <div className="flex justify-between font-mono text-[10px] text-[#95a370]">
                            <span>{masked ? '???' : f.avKey ? f.avKey.toUpperCase() : f.ext.toUpperCase()}</span>
                            <span>
                              {f.life}/{f.lifeTotal} PV
                            </span>
                          </div>
                          {f.lifeTotal > 1 && (
                            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-[#090d07]">
                              <div
                                className={`h-full transition-all ${
                                  f.avKey ? 'bg-rose-500' : 'bg-[#58f287]'
                                }`}
                                style={{ width: `${(f.life / f.lifeTotal) * 100}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom Dock + Interactive CLI Bar */}
          <div className="border-t border-[#323d22] bg-[#13190e] px-4 py-2.5">
            {/* Hover Virus Preview Banner */}
            {hoveredSlot && (
              <div className="mb-2 flex items-center justify-between rounded border border-[#475631] bg-[#1b2414] px-3 py-1.5 text-xs">
                <div>
                  <strong className="font-mono text-[#fed82a]">
                    {hoveredSlot.virus.name} ({hoveredSlot.virus.id.toUpperCase()})
                  </strong>{' '}
                  — <span className="text-[#d4dcba]">{formatVirusDesc(hoveredSlot.virus, combo || null)}</span>
                </div>
                <span className="shrink-0 font-mono text-[#fed82a]">
                  {hoveredSlot.effectiveCc} CC
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Virus Slots */}
              <div className="flex flex-wrap items-center gap-1.5">
                {session.currentDeck.map((slot, idx) => {
                  const exhausted = slot.remainingUses !== null && slot.remainingUses <= 0;
                  const noMana = session.mana < slot.effectiveCc;
                  const disabled = exhausted || noMana || (!sys && slot.virus.target !== '_net');

                  return (
                    <button
                      key={`${slot.virus.id}_${idx}`}
                      type="button"
                      disabled={disabled || session.isLeetMode}
                      onMouseEnter={() => setHoveredSlotIdx(idx)}
                      onMouseLeave={() => setHoveredSlotIdx(null)}
                      onClick={() => {
                        session.useDockSlot(idx);
                        setRenderTick((t) => t + 1);
                      }}
                      className={`relative flex h-14 w-14 flex-col items-center justify-center rounded border p-1 transition ${
                        disabled
                          ? 'border-[#2b341e] bg-[#0f130b] opacity-40'
                          : 'border-[#536439] bg-[#1c2515] hover:border-[#fed82a] cursor-pointer'
                      }`}
                    >
                      <span className="absolute top-0.5 left-1 font-mono text-[9px] text-[#8d9a6a]">
                        {session.isLeetMode ? slot.virus.id : keybinds[idx] ?? idx + 1}
                      </span>
                      <img
                        src={`/assets/img/dockicons/${slot.virus.id}.png`}
                        alt={slot.virus.name}
                        className="h-7 w-7 object-contain"
                      />
                      <span className="font-mono text-[9px] font-bold text-[#fed82a]">
                        {slot.effectiveCc}cc
                        {slot.remainingUses !== null ? `·${slot.remainingUses}` : ''}
                      </span>
                    </button>
                  );
                })}

                {session.decks.length > 1 && (sys === null || session.canSwitchDeckInFs) && (
                  <button
                    type="button"
                    onClick={() => {
                      session.switchDeck();
                      setRenderTick((t) => t + 1);
                    }}
                    className="cyber-btn flex h-14 flex-col items-center justify-center rounded px-2.5 font-mono text-[10px] cursor-pointer"
                  >
                    <RefreshCw className="mb-0.5 h-3.5 w-3.5 text-[#fed82a]" />
                    Deck (C)
                  </button>
                )}
              </div>

              {/* Interactive Shell CLI (always usable, primary in Uber-Eleet mode!) */}
              <form onSubmit={handleCliSubmit} className="relative min-w-[260px] flex-1">
                {cliSuggestions.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 flex flex-wrap gap-1.5 rounded border border-[#4c5c34] bg-[#12180e] p-2 shadow-xl">
                    {cliSuggestions.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-[#242e1a] px-1.5 py-0.5 font-mono text-[11px] text-[#fed82a]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center rounded border border-[#45532f] bg-[#0a0d08] px-2.5 py-1.5 focus-within:border-[#fed82a]">
                  <TerminalIcon className="mr-2 h-4 w-4 shrink-0 text-[#58f287]" />
                  <input
                    ref={cliRef}
                    type="text"
                    value={cliInput}
                    onChange={(e) => {
                      setCliInput(e.target.value);
                      setCliSuggestions([]);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab') {
                        e.preventDefault();
                        const res = session.autoCompleteCli(cliInput);
                        setCliInput(res.completed);
                        setCliSuggestions(res.suggestions);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const nextIdx = Math.min(session.cmdHistory.length - 1, historyIdx + 1);
                        if (nextIdx >= 0 && session.cmdHistory[nextIdx]) {
                          setHistoryIdx(nextIdx);
                          setCliInput(session.cmdHistory[nextIdx]);
                        }
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const nextIdx = historyIdx - 1;
                        if (nextIdx < 0) {
                          setHistoryIdx(-1);
                          setCliInput('');
                        } else {
                          setHistoryIdx(nextIdx);
                          setCliInput(session.cmdHistory[nextIdx] ?? '');
                        }
                      }
                    }}
                    placeholder={
                      sys
                        ? 'Shell CLI (ex: dmgs core, scan1, cd ..) — [Tab] complétion'
                        : 'Connectez-vous à un système pour exécuter des commandes...'
                    }
                    className="w-full bg-transparent font-mono text-xs text-[#7ee787] placeholder-[#4e5b38] focus:outline-none"
                  />
                </div>
              </form>
            </div>
          </div>
        </main>

        {/* Right Event Log & Loot Console */}
        <aside className="flex flex-col overflow-hidden border-l border-[#2e3820] bg-[#10150c] lg:col-span-3">
          <div className="flex items-center justify-between border-b border-[#2c361e] bg-[#161d11] px-3.5 py-2 font-mono text-xs font-bold text-[#fed82a]">
            <span>REGISTRE SYSTÈME</span>
            <span className="flex items-center gap-1 text-[11px] text-[#95a370]">
              <HardDrive className="h-3.5 w-3.5" />
              {session.copiedFiles.length}/{session.maxStorage} copiés
            </span>
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto p-3 font-mono text-[11px]">
            {session.logs.map((entry) => (
              <div
                key={entry.id}
                className={`rounded border-l-2 bg-[#141a0f] px-2.5 py-1.5 leading-snug ${
                  entry.level === 'danger'
                    ? 'border-rose-500 text-rose-300'
                    : entry.level === 'warn'
                      ? 'border-amber-400 text-amber-200'
                      : entry.level === 'success'
                        ? 'border-[#58f287] text-[#8ef5a7]'
                        : 'border-[#4c5b34] text-[#c7d1aa]'
                }`}
              >
                {entry.text}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Modal 1: Folder Password Prompt */}
      <ModalDialog
        open={session.pendingPasswordFolderId !== null}
        title="AUTHENTIFICATION DOSSIER VERROUILLÉ"
        onClose={() => {
          session.pendingPasswordFolderId = null;
          setPasswordAttempt('');
          setRenderTick((t) => t + 1);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (session.submitFolderPassword(passwordAttempt)) {
              setPasswordAttempt('');
            }
            setRenderTick((t) => t + 1);
          }}
          className="space-y-4"
        >
          <p className="font-mono text-xs text-[#c7d1aa]">
            Entrez le mot de passe administrateur (trouvable dans les mails, fichiers <code>.pass</code> ou la base <code>global.pass</code>) :
          </p>
          <input
            type="text"
            autoFocus
            value={passwordAttempt}
            onChange={(e) => setPasswordAttempt(e.target.value)}
            placeholder="Mot de passe..."
            className="w-full rounded border border-[#4a5933] bg-[#0c1009] px-3 py-2 font-mono text-sm text-[#fed82a] focus:border-[#fed82a] focus:outline-none"
          />
          <div className="flex justify-end gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => {
                session.pendingPasswordFolderId = null;
                setRenderTick((t) => t + 1);
              }}
              className="cyber-btn rounded px-3 py-1.5 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="cyber-btn-amber rounded px-4 py-1.5 cursor-pointer"
            >
              Déverrouiller
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal 2: System Scanner (WinAppMap) */}
      <ModalDialog
        open={Boolean(session.scannerState?.open && sys)}
        title={`SCANNER SYSTÈME // ${sys?.name ?? ''}`}
        maxWidthClass="max-w-2xl"
        onClose={() => {
          if (session.scannerState) session.scannerState.open = false;
          setRenderTick((t) => t + 1);
        }}
      >
        {sys && session.scannerState && (() => {
          const scrambled =
            session.systemHasAv(sys, 'brouilleur') &&
            !session.scannerState.ignoreScrambler &&
            !session.hasChipset('sscan');

          const activeAvCounts = new Map<string, number>();
          for (const f of Object.values(sys.files)) {
            if (!f.deleted && f.avKey) {
              activeAvCounts.set(f.avKey, (activeAvCounts.get(f.avKey) ?? 0) + 1);
            }
          }

          const renderFolderTree = (folderId: number, depth = 0): any => {
            const folder = sys.files[folderId];
            if (!folder) return null;
            const children = folder.childrenIds.map((cid) => sys.files[cid]).filter((x) => x && !x.deleted);
            const hasAv = children.some((c) => c.avKey !== null);
            const hasPack = children.some((c) => c.ext === 'pack');
            const label = scrambled
              ? 'X#?@'
              : folder.id === sys.rootFolderId
                ? sys.name
                : folder.name;

            const lockedHide = folder.password !== null && !session.hasChipset('sscan');
            const isAdjScanner =
              curFolder !== null &&
              (curFolder.parentId === folder.id || folder.parentId === curFolder.id);
            const canClickScannerFolder =
              folder.id !== session.currentFolderId && (session.isLeetMode || isAdjScanner);

            return (
              <div key={folder.id} style={{ paddingLeft: `${depth * 16}px` }} className="my-1 font-mono text-xs">
                <button
                  type="button"
                  disabled={!canClickScannerFolder}
                  onClick={() => {
                    if (!canClickScannerFolder) return;
                    if (session.scannerState) session.scannerState.open = false;
                    session.openFolder(folder.id);
                    setRenderTick((t) => t + 1);
                  }}
                  className={`flex items-center gap-1.5 rounded px-2 py-0.5 ${
                    canClickScannerFolder ? 'hover:bg-[#242e1a] cursor-pointer' : 'cursor-default'
                  } ${
                    session.currentFolderId === folder.id ? 'bg-[#2a361e] font-bold text-[#fed82a]' : ''
                  }`}
                >
                  <Folder className="h-3.5 w-3.5 text-[#a8b683]" />
                  <span>{label}</span>
                  {session.scannerState!.scanLevel >= 3 && hasAv && !scrambled && (
                    <span className="rounded bg-rose-700 px-1 text-[9px] text-white">AV!</span>
                  )}
                  {session.scannerState!.mode === 'pack' && hasPack && !scrambled && (
                    <span className="rounded bg-emerald-700 px-1 text-[9px] text-white">PACK</span>
                  )}
                </button>
                {lockedHide ? (
                  <div style={{ paddingLeft: `${(depth + 1) * 16}px` }} className="text-[11px] text-amber-400/80">
                    └── [??? Dossier Verrouillé]
                  </div>
                ) : (
                  children.filter((c) => c.isFolder).map((sub) => renderFolderTree(sub.id, depth + 1))
                )}
              </div>
            );
          };

          return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="max-h-80 overflow-y-auto rounded border border-[#344023] bg-[#0d110a] p-3 md:col-span-7">
                {scrambled && (
                  <div className="mb-2 rounded bg-amber-950/60 px-2 py-1 font-mono text-[11px] text-amber-300">
                    Signal brouillé par un anti-virus BROUILLEUR !
                  </div>
                )}
                {renderFolderTree(sys.rootFolderId, 0)}
              </div>

              <div className="max-h-80 overflow-y-auto rounded border border-[#344023] bg-[#0d110a] p-3 md:col-span-5">
                <div className="mb-2 font-mono text-xs font-bold text-[#fed82a]">
                  ANTI-VIRUS DÉTECTÉS
                </div>
                {session.scannerState.scanLevel < 2 ? (
                  <p className="font-mono text-xs text-[#7f8c5e]">
                    Utilisez <code>SCAN2</code> ou supérieur pour lister les modèles d&apos;anti-virus actifs.
                  </p>
                ) : activeAvCounts.size === 0 ? (
                  <p className="font-mono text-xs text-emerald-400">Aucun anti-virus actif !</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(activeAvCounts.entries()).map(([avKey, cnt]) => {
                      const def = catalog.antiviruses.find((a) => a.key === avKey);
                      return (
                        <div key={avKey} className="rounded border border-[#2f3a20] bg-[#151b10] p-2">
                          <div className="font-mono text-xs font-bold text-rose-300 uppercase">
                            {avKey} ×{cnt}
                          </div>
                          {def && <div className="mt-0.5 text-[11px] text-[#b8c496]">{def.desc}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </ModalDialog>

      {/* Modal 3: Fatal / Busted / System Alert Popup */}
      <ModalDialog
        open={Boolean(session.lastPopup)}
        title={session.lastPopup?.title ?? 'ALERTE SYSTÈME'}
        onClose={() => {
          const wasFatal = session.lastPopup?.fatal;
          session.lastPopup = null;
          setRenderTick((t) => t + 1);
          if (wasFatal && session.busted) {
            void triggerFinish(false);
          }
        }}
      >
        {session.lastPopup && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              {session.lastPopup.fatal ? (
                <Skull className="h-7 w-7 shrink-0 text-rose-400" />
              ) : (
                <AlertTriangle className="h-7 w-7 shrink-0 text-[#fed82a]" />
              )}
              <p className="whitespace-pre-line font-mono text-xs leading-relaxed text-[#e8efd0]">
                {session.lastPopup.message}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const wasFatal = session.lastPopup?.fatal;
                  session.lastPopup = null;
                  setRenderTick((t) => t + 1);
                  if (wasFatal && session.busted) {
                    void triggerFinish(false);
                  }
                }}
                className="cyber-btn-amber rounded px-4 py-1.5 font-mono text-xs cursor-pointer"
              >
                {session.lastPopup.fatal && session.busted ? 'Quitter le réseau' : 'Continuer'}
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
