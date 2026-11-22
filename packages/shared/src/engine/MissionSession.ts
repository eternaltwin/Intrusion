import { formatLang, type GameDataBundle } from '../data/xmlLoaders.js';
import {
  getMissionTimeMs,
  getTutorialTrack,
  hasMissionTimer,
  isTutorialMission,
} from '../generator/MissionGen.js';
import {
  BOMB_LIMIT,
  CSHIELD_ABSORB,
  generateNetwork,
  SHIELD_ABSORB,
} from '../generator/NetworkGen.js';
import { Rand } from '../rng/Rand.js';
import type {
  DeckLoadout,
  FileNodeState,
  GoalId,
  MissionEndSummary,
  MissionInitParams,
  NetNodeState,
  SimpleFile,
  StolenCard,
  SystemState,
  TutorialStepDef,
  TutorialTrackId,
  UserEffectType,
  VirusDef,
} from '../types/game.js';

export interface ActiveCast {
  virusId: string;
  targetNodeId: number | null;
  targetFileId: number | null;
  deckIndex?: number | null;
  slotIndex?: number | null;
  elapsedMs: number;
  durationMs: number;
  label: string;
}

export interface LogEntry {
  id: number;
  timestampMs: number;
  level: 'info' | 'warn' | 'success' | 'danger';
  text: string;
}

export type SoundCue =
  | { kind: 'sfx'; id: string }
  | { kind: 'loop_start'; id: string; channel: 'sfx' | 'ambient' | 'beat' }
  | { kind: 'loop_stop'; id: string };

export interface DockSlotState {
  index: number;
  virus: VirusDef;
  remainingUses: number | null;
  effectiveCc: number;
}

export class MissionSession {
  public readonly bundle: GameDataBundle;
  public readonly init: MissionInitParams;

  // Network & FS state
  public readonly entranceId: number;
  public readonly nodes: Record<number, NetNodeState>;
  public connectedNodeId: number | null = null;
  public currentFolderId: number | null = null;
  public selectedFileId: number | null = null;
  public selectedNetNodeId: number | null = null;

  // Player stats
  public life = 100;
  public readonly lifeTotal = 100;
  public mana: number;
  public readonly manaTotal: number;
  public readonly maxCombo: number;
  public readonly maxStorage: number;
  public userEffects: Partial<Record<UserEffectType, number>> = {};

  // Decks & Dock
  public decks: DeckLoadout[];
  public activeDeckIndex = 0;
  public deckSlots: DockSlotState[][] = [];
  public canSwitchDeckInFs = false;

  // Timers & Alarm
  public readonly hasTimer: boolean;
  public timeLimitMs: number;
  public elapsedMs = 0;
  public tickSeconds = 0;
  private secondAccumMs = 0;
  public alarmRemainingSec: number | null = null;
  public alarmOriginNodeId: number | null = null;

  // Cast progress
  public activeCast: ActiveCast | null = null;

  // Mission tracking
  public busted = false;
  public ended = false;
  public missionObjectiveCompleted = false;
  public kills = 0;
  public missionCpt = 0;
  public tvCopiedProgram = false;
  public unlockedPasswords = new Set<string>();
  public extractedValuables: string[] = [];
  public copiedFiles: SimpleFile[] = [];
  public collectedCards: StolenCard[] = [];
  public goals: Partial<Record<GoalId, number>> = {};

  // Logs, UI modals & Audio cues
  private logSeq = 1;
  public logs: LogEntry[] = [];
  public soundQueue: SoundCue[] = [];
  public lastPopup: { title: string; message: string; fatal?: boolean } | null = null;
  public scannerState: {
    open: boolean;
    scanLevel: number;
    mode: 'normal' | 'av' | 'pack';
    ignoreScrambler: boolean;
  } | null = null;
  public pendingPasswordFolderId: number | null = null;

  // CLI (.hackrc)
  public aliases = new Map<string, string>();
  public cmdHistory: string[] = [];

  // Tutorial
  public readonly tutorialTrackId: TutorialTrackId | null;
  public readonly tutorialSteps: TutorialStepDef[];
  public tutorialIndex = 0;

  private endTurnQueue: Array<() => void> = [];
  private isDisconnecting = false;
  private pendingFurtivityConsume = 0;
  private burstConsumedThisTurn = false;
  private slotChargeGroups = new WeakMap<
    DockSlotState,
    { remainingUses: number; slots: DockSlotState[] }
  >();

  constructor(bundle: GameDataBundle, init: MissionInitParams) {
    this.bundle = bundle;
    this.init = init;

    const generated = generateNetwork(
      bundle,
      init.mission,
      init.profile.adult,
      init.profile.username || 'Haxxor',
      init.cards
    );
    this.entranceId = generated.entranceId;
    this.nodes = generated.nodes;
    this.missionCpt = generated.extraMissionCount;

    // Chipset stats
    const chip = init.chipset;
    this.manaTotal = chip === 'smana' ? 500 : chip === 'mana' ? 350 : 250;
    this.mana = this.manaTotal;
    this.maxCombo = chip === 'combo' ? 5 : 3;
    this.maxStorage = chip === 'storag' ? 20 : 10;

    // Parse .hackrc aliases safely
    this.parseHackrc(init.profile.cfg);

    // Build decks + inject custom mission virus ('cust') when required
    const isTuto = isTutorialMission(init.mission);
    const defaultDeck: DeckLoadout = {
      id: 'd0',
      name: 'Default',
      capacity: 3,
      isFavorite: true,
      content: ['dmgs', 'copy', 'scan1'],
    };
    if (isTuto) {
      this.decks = [
        {
          id: 'tuto',
          name: 'Tutorial',
          capacity: 3,
          isFavorite: true,
          content: ['dmgs', 'copy', 'scan1'],
        },
      ];
    } else {
      const sourceDecks = init.decks.length > 0 ? init.decks : [defaultDeck];
      const rawDecks = init.isChallenge ? sourceDecks.slice(0, 1) : sourceDecks;
      this.decks = rawDecks;
    }

    const customVirus = this.buildCustomMissionVirus();

    // Compute per-virus exemplar charge pools across decks in Normal mode
    const maxInAnyDeck = new Map<string, number>();
    for (const d of this.decks) {
      const counts = new Map<string, number>();
      for (const vid of d.content) {
        counts.set(vid, (counts.get(vid) ?? 0) + 1);
      }
      for (const [vid, cnt] of counts.entries()) {
        if (cnt > (maxInAnyDeck.get(vid) ?? 0)) {
          maxInAnyDeck.set(vid, cnt);
        }
      }
    }

    const chargePools = new Map<string, Array<{ remainingUses: number; slots: DockSlotState[] }>>();
    const chargeCursors = new Map<string, number>();
    const getExemplarGroup = (
      vid: string,
      baseUses: number
    ): { remainingUses: number; slots: DockSlotState[] } => {
      let pool = chargePools.get(vid);
      if (!pool) {
        const rawOwned =
          vid === 'cust'
            ? 1
            : !init.isChallenge && !isTuto && init.ownedViruses?.[vid] !== undefined
              ? init.ownedViruses[vid]
              : maxInAnyDeck.get(vid) ?? 1;
        const ownedCount = Math.max(1, rawOwned);
        pool = Array.from({ length: ownedCount }, () => ({
          remainingUses: baseUses,
          slots: [],
        }));
        chargePools.set(vid, pool);
        chargeCursors.set(vid, 0);
      }
      const cur = chargeCursors.get(vid) ?? 0;
      chargeCursors.set(vid, cur + 1);
      return pool[cur % pool.length];
    };

    this.deckSlots = this.decks.map((d) => {
      const slots: DockSlotState[] = [];
      for (const vid of d.content) {
        const base = bundle.viruses.get(vid);
        if (!base) continue;
        const slot = this.toSlotState(base, slots.length);
        if (base.uses !== null && !init.isChallenge && !isTuto) {
          const group = getExemplarGroup(vid, base.uses);
          slot.remainingUses = group.remainingUses;
          group.slots.push(slot);
          this.slotChargeGroups.set(slot, group);
        }
        slots.push(slot);
      }
      if (customVirus) {
        const custSlot = this.toSlotState(customVirus, slots.length);
        if (customVirus.uses !== null) {
          const group = getExemplarGroup('cust', customVirus.uses);
          custSlot.remainingUses = group.remainingUses;
          group.slots.push(custSlot);
          this.slotChargeGroups.set(custSlot, group);
        }
        slots.push(custSlot);
      }
      return slots;
    });

    // Timers
    const effectiveLeet = isTuto ? false : init.profile.leet;
    this.hasTimer = hasMissionTimer(init.mission);
    this.timeLimitMs = getMissionTimeMs(init.mission, effectiveLeet);

    // Tutorial setup
    this.tutorialTrackId = getTutorialTrack(init.mission);
    this.tutorialSteps = this.tutorialTrackId ? bundle.tutorials[this.tutorialTrackId] ?? [] : [];

    // Initial logs & audio
    this.pushLog('info', formatLang(bundle.uiStrings, 'Log_ConnectedGlobal'));
    if (chip && chip !== 'none') {
      const cDef = bundle.chipsets.get(chip);
      if (cDef) {
        this.pushLog('info', formatLang(bundle.uiStrings, 'Log_Chipset', { c: cDef.name, id: cDef.id }));
      }
    }
    this.emitSound({ kind: 'loop_start', id: 'menu', channel: 'beat' });
  }

  public getEffectiveCc(v: VirusDef): number {
    let cc = v.cc;
    if (this.hasChipset('brute') && v.cat === 'damage') {
      cc = Math.round(1.3 * cc);
    }
    if (this.hasChipset('thief')) {
      if (v.id === 'fmove1') cc -= Math.floor(v.cc * 0.3);
      else if (v.id === 'fmove2') cc -= Math.floor(v.cc * 0.4);
      else if (v.id === 'invis') cc -= Math.floor(v.cc * 0.6);
    }
    if (this.hasChipset('deciph')) {
      if (v.id === 'unmask' || v.id === 'dec1') cc -= Math.floor(v.cc * 0.5);
      else if (v.id === 'dec2' || v.id === 'dec3') cc -= Math.floor(v.cc * 0.6);
    }
    return Math.max(0, cc);
  }

  private toSlotState(v: VirusDef, index: number): DockSlotState {
    return {
      index,
      virus: v,
      remainingUses: v.uses,
      effectiveCc: this.getEffectiveCc(v),
    };
  }

  private consumeSlotCharge(slot: DockSlotState): void {
    if (slot.remainingUses === null) return;
    const group = this.slotChargeGroups.get(slot);
    if (group) {
      group.remainingUses = Math.max(0, group.remainingUses - 1);
      for (const linked of group.slots) {
        linked.remainingUses = group.remainingUses;
      }
    } else {
      slot.remainingUses = Math.max(0, slot.remainingUses - 1);
    }
  }

  private buildCustomMissionVirus(): VirusDef | null {
    const base = this.bundle.viruses.get('cust');
    if (!base) return null;
    const mp = this.init.mission.type;
    const ui = this.bundle.uiStrings;
    const make = (nameKey: string, descKey: string, target: VirusDef['target'], uses: number | null, vars?: Record<string, string | number>): VirusDef => ({
      ...base,
      name: formatLang(ui, nameKey, vars),
      desc: formatLang(ui, descKey, vars),
      target,
      uses,
    });

    switch (mp.kind) {
      case 'Spy':
      case 'SpyCam':
        return make('CustSpy', 'CustSpyDesc', '_file', null);
      case 'DeliverFile':
      case 'CompromiseMail':
      case 'Arrest':
      case 'CorruptDisplay':
        return make('CustUp', 'CustUpDesc', '_none', 1);
      case 'FalsifyCam':
        return make('CustVideo', 'CustVideoDesc', '_none', null);
      case 'TV':
        return make('CustRep', 'CustRepDesc', '_file', null);
      case 'OverwriteFiles':
        return make('CustOverwrite', 'CustOverwriteDesc', '_none', null, { ext: mp.ext.toUpperCase() });
      case 'GameHack':
        return make('CustGame', 'CustGameDesc', '_file', null);
      case 'InfectNet':
        return { ...base, name: mp.v, desc: formatLang(ui, 'CustVirusDesc'), target: '_file', uses: null };
      case 'GetVirus':
        return make('CustVExtract', 'CustVExtractDesc', '_file', null, { ext: mp.ext.toUpperCase() });
      default:
        return null;
    }
  }

  public hasChipset(id: string): boolean {
    return this.init.chipset === id;
  }

  public get isLeetMode(): boolean {
    return !isTutorialMission(this.init.mission) && this.init.profile.leet;
  }

  public get currentSystem(): SystemState | null {
    if (this.connectedNodeId === null) return null;
    return this.nodes[this.connectedNodeId]?.system ?? null;
  }

  public get currentFolder(): FileNodeState | null {
    const sys = this.currentSystem;
    if (!sys || this.currentFolderId === null) return null;
    return sys.files[this.currentFolderId] ?? null;
  }

  public get currentDeck(): DockSlotState[] {
    return this.deckSlots[this.activeDeckIndex] ?? [];
  }

  public get remainingTimeMs(): number {
    if (!this.hasTimer) return this.timeLimitMs;
    return Math.max(0, this.timeLimitMs - this.elapsedMs);
  }

  public getSpeed(): number {
    let base = this.hasChipset('turbo') ? 1.5 : 1.0;
    const bios = Math.min(4, Math.max(1, this.init.biosLevel));
    if (bios < 4) base += bios;
    else base += 3.5;
    const sysSpeed = this.currentSystem ? this.currentSystem.speed : 1.0;
    return base * sysSpeed;
  }

  public parseHackrc(cfg: string): { errors: string[] } {
    this.aliases.clear();
    const errors: string[] = [];
    for (const rawLine of cfg.split(/\r?\n/)) {
      const clean = rawLine.split('#')[0].trim();
      if (!clean) continue;
      const m = /^alias\s+([a-zA-Z0-9_-]+)\s*=\s*(.+)$/i.exec(clean);
      if (!m) {
        errors.push(rawLine);
        continue;
      }
      this.aliases.set(m[1].toLowerCase(), m[2].trim());
    }
    return { errors };
  }

  public drainSounds(): SoundCue[] {
    const out = [...this.soundQueue];
    this.soundQueue = [];
    return out;
  }

  private emitSound(cue: SoundCue): void {
    this.soundQueue.push(cue);
  }

  private pushLog(level: LogEntry['level'], text: string): void {
    this.logs.unshift({
      id: this.logSeq++,
      timestampMs: this.elapsedMs,
      level,
      text,
    });
    if (this.logs.length > 80) this.logs.length = 80;
  }

  private incGoal(gid: GoalId, n = 1): void {
    this.goals[gid] = (this.goals[gid] ?? 0) + n;
  }

  // --- Network helpers ---
  public isNodeUp(node: NetNodeState): boolean {
    return node.system === null || (!node.system.crashed && !node.system.corrupted);
  }

  public canGoThroughNode(node: NetNodeState): boolean {
    return node.type === 'Entrance' || node.type === 'Empty' || !this.isNodeUp(node);
  }

  public canReachNode(node: NetNodeState): boolean {
    for (const pid of node.pathFromEntrance) {
      if (pid === node.id) continue;
      const p = this.nodes[pid];
      if (!p || !this.canGoThroughNode(p)) return false;
    }
    return true;
  }

  private getNonEmptyNeighbours(node: NetNodeState): NetNodeState[] {
    const visited = new Set<number>([node.id]);
    const out: NetNodeState[] = [];
    const walk = (cur: NetNodeState) => {
      for (const lid of cur.links) {
        if (visited.has(lid)) continue;
        visited.add(lid);
        const peer = this.nodes[lid];
        if (!peer) continue;
        if (peer.type === 'Empty') walk(peer);
        else out.push(peer);
      }
    };
    walk(node);
    return out;
  }

  public isNodeShielded(node: NetNodeState): boolean {
    if (
      !this.isNodeUp(node) ||
      node.type === 'Entrance' ||
      node.type === 'LockServer' ||
      node.type === 'LockServerLight'
    ) {
      return false;
    }
    for (const peer of this.getNonEmptyNeighbours(node)) {
      if (!this.isNodeUp(peer)) continue;
      if (peer.type === 'LockServer' && peer.dist === node.dist) return true;
      if (peer.type === 'LockServerLight' && peer.siblingLockTargetId === node.id) return true;
    }
    return false;
  }

  public refreshFogOfWar(): void {
    for (const n of Object.values(this.nodes)) {
      if (n.dist <= 1 || this.canReachNode(n)) {
        n.visible = true;
      }
    }
  }

  // --- Frame / Real-time Simulation Step ---
  public tick(deltaMs: number): void {
    if (this.ended) return;
    const clampedDelta = Math.min(250, Math.max(0, deltaMs));
    this.elapsedMs += clampedDelta;

    // 1) Cast Progress bar (FPS-independent!)
    if (this.activeCast) {
      this.activeCast.elapsedMs += clampedDelta;
      if (this.activeCast.elapsedMs >= this.activeCast.durationMs) {
        const finished = this.activeCast;
        this.activeCast = null;
        this.emitSound({ kind: 'loop_stop', id: 'progress_01' });
        this.completeCast(finished);
      }
    }

    // 2) Wall-clock timer & 1Hz ticks
    if (this.hasTimer && !this.busted) {
      if (this.elapsedMs >= this.timeLimitMs) {
        this.triggerBusted('TimeOut');
        return;
      }
      this.secondAccumMs += clampedDelta;
      while (this.secondAccumMs >= 1000) {
        this.secondAccumMs -= 1000;
        this.onSecondTick();
      }
    }

    // 3) Drain endTurn queues
    this.drainEndTurn();
  }

  private onSecondTick(): void {
    this.tickSeconds++;

    // Periodic DoT (every 5s)
    const sys = this.currentSystem;
    if (sys && this.tickSeconds % 5 === 0) {
      for (const f of Object.values(sys.files)) {
        if (!f.deleted && (f.effects.E_Dot ?? 0) > 0 && (f.effects.E_DotLength ?? 0) > 0) {
          const dmg = f.effects.E_Dot!;
          f.effects.E_DotLength = f.effects.E_DotLength! - 1;
          if (f.effects.E_DotLength <= 0) {
            delete f.effects.E_Dot;
            delete f.effects.E_DotLength;
          }
          this.damageFile(sys, f, dmg, false, false, true);
        }
      }
    }

    // Chipset regen (+1 CC every 5s)
    if (this.hasChipset('regen') && this.tickSeconds % 5 === 0 && this.mana < this.manaTotal) {
      this.mana = Math.min(this.manaTotal, this.mana + 1);
    }

    // Chipset smana (-1 HP every 4s unblockable)
    if (
      this.hasChipset('smana') &&
      this.tickSeconds % 4 === 0 &&
      this.life > 0 &&
      !this.busted &&
      !this.ended
    ) {
      this.damagePlayer(1, false);
    }

    // Active Alarm countdown
    if (this.alarmRemainingSec !== null) {
      this.alarmRemainingSec--;
      if (this.alarmRemainingSec <= 0) {
        this.triggerBusted('AlarmEnd');
        return;
      }
      if (this.alarmRemainingSec % 10 === 0) {
        this.pushLog(
          'danger',
          formatLang(this.bundle.uiStrings, 'AlarmStatus', { n: this.alarmRemainingSec })
        );
        this.emitSound({ kind: 'sfx', id: this.alarmRemainingSec === 60 ? 'alarm_01' : 'alarm_02' });
      }
    }

    this.drainEndTurn();
    if (!this.busted && !this.ended) {
      this.evaluateMissionObjective();
    }
  }

  private triggerBusted(langKey: 'TimeOut' | 'AlarmEnd'): void {
    this.busted = true;
    this.missionObjectiveCompleted = false;
    this.scannerState = null;
    this.cancelCast();
    if (this.connectedNodeId !== null) {
      this.disconnectFromSystem(true);
    }
    this.emitSound({ kind: 'sfx', id: 'alarm_01' });
    this.lastPopup = {
      title: 'INTRUSION DETECTED',
      message: formatLang(this.bundle.uiStrings, langKey),
      fatal: true,
    };
  }

  public cancelCast(): void {
    if (!this.activeCast) return;
    this.activeCast = null;
    this.emitSound({ kind: 'loop_stop', id: 'progress_01' });
    this.pushLog('warn', formatLang(this.bundle.uiStrings, 'Log_Cancelled'));
  }

  // --- Actions ---
  public connectToNode(nodeId: number): { ok: boolean; error?: string } {
    const ui = this.bundle.uiStrings;
    if (this.activeCast) return this.failAction(formatLang(ui, 'Wait'));
    const node = this.nodes[nodeId];
    if (!node) return { ok: false, error: 'Unknown node' };

    if (this.connectedNodeId !== null) {
      return this.failAction(formatLang(ui, 'InvalidTarget'));
    }

    if (node.type === 'Entrance') {
      return this.finishMission();
    }
    if (this.busted) return this.failAction(formatLang(ui, 'CantConnectWhenBusted'));
    if (this.life <= 0) return this.failAction(formatLang(ui, 'CantConnectWhenDead'));
    if (this.mana <= 0) return this.failAction(formatLang(ui, 'CantConnectWhenOOM'));
    if (!this.canReachNode(node)) return this.failAction(formatLang(ui, 'CantReachNode'));
    if (this.isNodeShielded(node)) return this.failAction(formatLang(ui, 'SystemLocked'));
    if (!node.system || node.system.crashed) return this.failAction(formatLang(ui, 'SystemIsCrashed'));

    // Slower neighbour check
    const hasActiveSlower = this.getNonEmptyNeighbours(node).some(
      (n) => n.type === 'Slower' && this.isNodeUp(n)
    );
    node.system.speed = hasActiveSlower ? 0.4 : 1.0;

    return this.startCast('connec', nodeId, null, 2.0);
  }

  public switchDeck(targetIndex?: number): boolean {
    if (this.activeCast) return false;
    if (this.decks.length <= 1) return false;
    if (this.connectedNodeId !== null && !this.canSwitchDeckInFs) return false;
    const len = this.decks.length;
    const rawNext = targetIndex !== undefined ? targetIndex : this.activeDeckIndex + 1;
    const next = ((Math.trunc(rawNext) % len) + len) % len;
    if (!Number.isFinite(next) || next === this.activeDeckIndex) return false;
    this.activeDeckIndex = next;
    if (this.connectedNodeId !== null) {
      this.canSwitchDeckInFs = false;
    }
    const deckName = this.decks[this.activeDeckIndex].name;
    this.pushLog('info', formatLang(this.bundle.uiStrings, 'Log_ChangedDeck', { name: deckName }));
    this.emitSound({ kind: 'sfx', id: 'bleep_04' });
    return true;
  }

  private tryCollectCard(f: FileNodeState | null | undefined): void {
    if (!f || f.deleted || f.isFolder || !f.cardData) return;
    if ((f.effects.E_Encoded ?? 0) > 0 || (f.effects.E_Masked ?? 0) > 0) return;
    if (
      this.collectedCards.some(
        (c) => c.id === f.cardData!.id || c.number === f.cardData!.number
      )
    ) {
      return;
    }
    this.collectedCards.push(f.cardData);
    this.pushLog(
      'success',
      `Credit card captured: ${f.cardData.number} (+${f.cardData.amount} CR)`
    );
    this.emitSound({ kind: 'sfx', id: 'bonus_01' });
  }

  public selectFile(fileId: number): void {
    const sys = this.currentSystem;
    if (!sys) return;
    const f = sys.files[fileId];
    if (!f || f.deleted) return;
    this.selectedFileId = fileId;
    this.emitSound({ kind: 'sfx', id: 'bleep_01' });

    if (!f.isFolder) {
      this.appendSystemLog(sys, 'TraceAccess', f.name);
      this.tryCollectCard(f);
    }
    this.advanceTutorialIfAt('selectFile');
  }

  public openFolder(folderId: number): { ok: boolean; error?: string } {
    const ui = this.bundle.uiStrings;
    if (this.activeCast) return this.failAction(formatLang(ui, 'Wait'));
    const sys = this.currentSystem;
    if (!sys) return { ok: false };
    const folder = sys.files[folderId];
    if (!folder || folder.deleted || !folder.isFolder) {
      return this.failAction(formatLang(ui, 'NeedFolder'));
    }

    // Check glue in current folder
    if (this.currentFolder && this.folderHasAv(sys, this.currentFolder.id, 'glue') && !this.isMoveFurtive()) {
      return this.failAction(formatLang(ui, 'CantGetOut'));
    }

    // Verify no strict ancestor of target folder is still locked
    let ancId = folder.parentId;
    while (ancId !== null) {
      const anc = sys.files[ancId];
      if (!anc) break;
      if (anc.password !== null || this.folderHasAv(sys, anc.id, 'passwd')) {
        return this.failAction(formatLang(ui, 'MapLocked'));
      }
      ancId = anc.parentId;
    }

    if (folder.password !== null || this.folderHasAv(sys, folder.id, 'passwd')) {
      this.pendingPasswordFolderId = folder.id;
      return { ok: true };
    }

    const isParent = this.currentFolder?.parentId === folderId;
    const mult = isParent || isTutorialMission(this.init.mission) ? 0.3 : 0.6;
    return this.startCast('cd', null, folderId, mult);
  }

  public submitFolderPassword(passwordAttempt: string): boolean {
    if (this.activeCast) return false;
    const sys = this.currentSystem;
    if (!sys || this.pendingPasswordFolderId === null) return false;
    const folder = sys.files[this.pendingPasswordFolderId];
    if (!folder) return false;
    const expectedPw =
      folder.password ?? (this.folderHasAv(sys, folder.id, 'passwd') ? sys.mpass : null);
    if (expectedPw === null) {
      this.pendingPasswordFolderId = null;
      return false;
    }
    if (passwordAttempt.trim().toLowerCase() === expectedPw.toLowerCase()) {
      folder.password = null;
      for (const cid of folder.childrenIds) {
        const cf = sys.files[cid];
        if (cf && !cf.deleted && cf.avKey === 'passwd') {
          this.unregisterAv(sys, cf);
          cf.effects.E_Disabled = 1;
        }
      }
      this.pendingPasswordFolderId = null;
      if (!this.unlockedPasswords.has(expectedPw)) {
        this.unlockedPasswords.add(expectedPw);
        this.incGoal('passwd', 1);
      }
      this.pushLog('success', formatLang(this.bundle.uiStrings, 'LoginSuccess'));
      this.emitSound({ kind: 'sfx', id: 'bonus_02' });
      this.openFolder(folder.id);
      return true;
    }
    this.pushLog('warn', formatLang(this.bundle.uiStrings, 'LoginFailed'));
    this.emitSound({ kind: 'sfx', id: 'bleep_07' });
    return false;
  }

  public goParentOrDisconnect(): { ok: boolean; error?: string } {
    const sys = this.currentSystem;
    const cur = this.currentFolder;
    if (!sys || !cur) return { ok: false };
    if (cur.parentId === null) {
      return this.useVirusById('exit');
    }
    return this.openFolder(cur.parentId);
  }

  public extractPack(fileId: number): { ok: boolean; error?: string } {
    return this.useVirusById('extrac', fileId);
  }

  public useDockSlot(slotIndex: number, explicitFileId?: number): { ok: boolean; error?: string } {
    if (this.isLeetMode) return this.failAction('CLI required in Leet mode');
    const slot = this.currentDeck[slotIndex];
    if (!slot) return { ok: false, error: 'Empty slot' };
    return this.useVirusById(slot.virus.id, explicitFileId, slotIndex);
  }

  public useVirusById(
    virusId: string,
    explicitFileId?: number,
    explicitSlotIndex?: number
  ): { ok: boolean; error?: string } {
    const ui = this.bundle.uiStrings;
    if (this.activeCast) return this.failAction(formatLang(ui, 'Wait'));

    // Find in deck (prefer explicit slot or a copy that still has charges) or hidden system actions
    let resolvedSlotIndex: number | null = null;
    let slot: DockSlotState | undefined;
    if (explicitSlotIndex !== undefined) {
      slot = this.currentDeck[explicitSlotIndex];
      if (!slot) return this.failAction(formatLang(ui, 'UnknownVirus'));
      resolvedSlotIndex = explicitSlotIndex;
    } else {
      const chargedIdx = this.currentDeck.findIndex(
        (s) =>
          s.virus.id.toLowerCase() === virusId.toLowerCase() &&
          (s.remainingUses === null || s.remainingUses > 0)
      );
      if (chargedIdx >= 0) {
        slot = this.currentDeck[chargedIdx];
        resolvedSlotIndex = chargedIdx;
      } else {
        const anyIdx = this.currentDeck.findIndex(
          (s) => s.virus.id.toLowerCase() === virusId.toLowerCase()
        );
        if (anyIdx >= 0) {
          slot = this.currentDeck[anyIdx];
          resolvedSlotIndex = anyIdx;
        }
      }
    }

    const fallback = this.bundle.viruses.get(virusId.toLowerCase());
    if (!slot && fallback?.cat !== 'hidden') {
      return this.failAction(formatLang(ui, 'UnknownVirus'));
    }
    const virus = slot ? slot.virus : fallback!;
    if (virus.id === 'connec') {
      return this.failAction(formatLang(ui, 'UnknownVirus'));
    }

    if (slot && slot.remainingUses !== null && slot.remainingUses <= 0) {
      return this.failAction(formatLang(ui, 'NoCharge'));
    }

    const ccCost = slot ? slot.effectiveCc : this.getEffectiveCc(virus);
    if (this.mana < ccCost) {
      return this.failAction(formatLang(ui, 'NotEnoughMana'));
    }

    const sys = this.currentSystem;
    if (virus.target !== '_net' && !sys) {
      return this.failAction(formatLang(ui, 'OnlyOnFS'));
    }

    const targetFileId = explicitFileId ?? this.selectedFileId;
    const targetFile = sys && targetFileId !== null ? sys.files[targetFileId] ?? null : null;

    if (virus.id === 'cd') {
      return targetFile ? this.openFolder(targetFile.id) : this.failAction(formatLang(ui, 'NeedFolder'));
    }

    // Pre-cast validation
    const validationError = this.validateVirusPreconditions(virus, sys, targetFile);
    if (validationError) return this.failAction(validationError);

    const mult = this.getVirusCastMultiplier(virus, targetFile);
    return this.startCast(
      virus.id,
      null,
      virus.target === '_none' ? null : targetFile?.id ?? null,
      mult,
      resolvedSlotIndex !== null ? this.activeDeckIndex : null,
      resolvedSlotIndex
    );
  }

  private getVirusCastMultiplier(v: VirusDef, f: FileNodeState | null): number {
    switch (v.id) {
      case 'exit':
      case 'target':
      case 'dot1':
      case 'dot2':
      case 'rconv':
        return 0.1;
      case 'fdmg':
        return 0.15;
      case 'dmgs':
        return 0.2;
      case 'corrup':
      case 'corru2':
        return 0.25;
      case 'avdmg1':
      case 'avdmg2':
      case 'dshld':
      case 'tag1':
      case 'tag2':
      case 'tag3':
      case 'unmask':
        return 0.3;
      case 'dmgm':
        return 0.35;
      case 'extrac':
      case 'scan1':
        return 0.4;
      case 'libxpl':
      case 'reveng':
      case 'scan2':
      case 'hunt':
      case 'panic1':
      case 'rolbck':
      case 'cevi':
      case 'cstun':
      case 'cshld':
      case 'cshld2':
      case 'cshld3':
        return 0.5;
      case 'zone':
      case 'clone':
      case 'scan3':
        return 0.6;
      case 'dmgl':
      case 'weak1':
      case 'weak2':
      case 'chrge2':
      case 'chrge3':
      case 'shld1':
      case 'shld2':
        return 0.7;
      case 'dec1':
      case 'dec2':
        return (f?.effects.E_Encoded ?? 1) + 1;
      case 'dec3':
        return 1.3 * (f?.effects.E_Encoded ?? 1);
      case 'panic2':
      case 'heal1':
      case 'heal2':
      case 'mana1':
      case 'mana2':
      case 'mana3':
      case 'fmove1':
      case 'fmove2':
      case 'invis':
        return 1.5;
      case 'cust': {
        const mp = this.init.mission.type;
        if (mp.kind === 'FalsifyCam') {
          const sys = this.currentSystem;
          const cur = this.currentFolder;
          const videoCount =
            sys && cur
              ? cur.childrenIds
                  .map((cid) => sys.files[cid])
                  .filter((cf) => cf && !cf.deleted && !cf.isFolder && cf.ext === 'video').length
              : 1;
          return Math.max(1, videoCount) * 0.75;
        }
        if (mp.kind === 'OverwriteFiles') {
          const sys = this.currentSystem;
          const cur = this.currentFolder;
          const extCount =
            sys && cur
              ? cur.childrenIds
                  .map((cid) => sys.files[cid])
                  .filter((cf) => cf && !cf.deleted && !cf.isFolder && cf.ext === mp.ext).length
              : 1;
          return Math.max(1, extCount) * 0.5;
        }
        if (mp.kind === 'CorruptDisplay') return 4.0;
        if (mp.kind === 'TV') return 1.2;
        return 2.0;
      }
      case 'cbomb':
        return 4.5;
      case 'pbomb':
        return 6.0;
      default:
        return 1.0;
    }
  }

  private validateVirusPreconditions(
    v: VirusDef,
    sys: SystemState | null,
    f: FileNodeState | null
  ): string | null {
    const ui = this.bundle.uiStrings;
    if (!sys) return null;

    if (v.target === '_file') {
      if (!f || f.deleted || f.isFolder) return formatLang(ui, 'NeedFile');
      if ((f.effects.E_Masked ?? 0) > 0 && v.id !== 'unmask') {
        return formatLang(ui, 'UnknownType');
      }
    } else if (v.target === '_folder') {
      if (!f || !f.isFolder) return formatLang(ui, 'NeedFolder');
    }

    if (v.cat === 'combo' && (this.userEffects.UE_Combo ?? 0) <= 0) {
      return formatLang(ui, 'NeedCombo');
    }

    if (this.hasChipset('scout')) {
      if (['corrup', 'corru2', 'pbomb', 'cbomb'].includes(v.id)) {
        return formatLang(ui, 'NotInScoutMode');
      }
      if (v.cat === 'damage' && f && (f.key === 'file.core' || f.key === 'file.guardian')) {
        return formatLang(ui, 'NotInScoutMode');
      }
    }

    switch (v.id) {
      case 'exit':
        if (this.currentFolderId !== sys.rootFolderId) return formatLang(ui, 'OnlyInRoot');
        if (this.folderHasAv(sys, sys.rootFolderId, 'glue') && !this.isMoveFurtive()) {
          return formatLang(ui, 'CantGetOut');
        }
        break;
      case 'rolbck':
        if (this.currentFolderId === sys.rootFolderId) return formatLang(ui, 'NotInRoot');
        break;
      case 'extrac':
        if (!f || f.ext !== 'pack') return formatLang(ui, 'CantExtractThat');
        if (this.systemHasAv(sys, 'couveuse')) return formatLang(ui, 'Couveuse');
        break;
      case 'copy':
        if (!f) return formatLang(ui, 'NeedFile');
        if (this.systemHasAv(sys, 'couveuse')) return formatLang(ui, 'Couveuse');
        if (f.ext === 'pack') return formatLang(ui, 'CantCopyPack');
        if (f.ext === 'log') return formatLang(ui, 'CantCopyLog');
        if ((f.effects.E_Encoded ?? 0) > 0 || (f.effects.E_Masked ?? 0) > 0) return formatLang(ui, 'CantCopyCrypted');
        if ((f.effects.E_Copy ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
        if (f.avKey !== null || (f.effects.E_Disabled ?? 0) > 0) return formatLang(ui, 'InvalidTarget');
        if (!f.isMissionTarget && this.copiedFiles.length >= this.maxStorage) {
          return formatLang(ui, 'DiskFull', { max: this.maxStorage });
        }
        break;
      case 'avdmg1':
      case 'avdmg2':
      case 'clone':
      case 'dot1':
      case 'dot2':
      case 'stun1':
      case 'stun2':
      case 'reveng':
      case 'weak1':
      case 'weak2':
      case 'disabl':
      case 'disab2':
      case 'cstun':
        if (!f || f.avKey === null) return formatLang(ui, 'NeedAV');
        if (['reveng', 'weak1', 'weak2'].includes(v.id)) {
          if (v.id === 'reveng' && (f.effects.E_Revenge ?? 0) > 0) return formatLang(ui, 'OnlyOnce');
          if ((v.id === 'weak1' || v.id === 'weak2') && (f.effects.E_Weaken ?? 0) > 0) return formatLang(ui, 'OnlyOnce');
        }
        break;
      case 'fdmg':
        if (!f || f.avKey !== null || (f.effects.E_Disabled ?? 0) > 0) return formatLang(ui, 'InvalidTarget');
        break;
      case 'zone':
        if (!this.currentFolder || !this.folderHasAnyAv(sys, this.currentFolder.id)) {
          return formatLang(ui, 'NoAntivirusInFolder');
        }
        break;
      case 'libxpl':
        if (!f || f.ext !== 'lib') return formatLang(ui, 'NeedExt', { ext: 'LIB' });
        if ((f.effects.E_Splash ?? 0) > 0) return formatLang(ui, 'OnlyOnce');
        break;
      case 'tag1':
      case 'tag2':
      case 'tag3':
        if (!f || (f.effects.E_Tag ?? 0) > 0) return formatLang(ui, 'OnlyOnce');
        break;
      case 'exploi':
        if (!f || (f.effects.E_Exploit ?? 0) > 0) return formatLang(ui, 'OnlyOnce');
        break;
      case 'unshld':
        if (!f || (f.effects.E_Shield ?? 0) <= 0) return formatLang(ui, 'Useless');
        break;
      case 'dec1':
      case 'dec2':
      case 'dec3': {
        const enc = f?.effects.E_Encoded ?? 0;
        if (enc <= 0) return formatLang(ui, 'Useless');
        if (enc > v.power) return formatLang(ui, 'EncodingTooStrong', { n: enc });
        break;
      }
      case 'unmask':
        if (!f || (f.effects.E_Masked ?? 0) <= 0) return formatLang(ui, 'Useless');
        break;
      case 'corrup':
      case 'corru2':
        if (!f || f.key !== 'file.control') return formatLang(ui, 'NeedExt', { ext: 'CONTROL' });
        if ((f.effects.E_Encoded ?? 0) > 0) return formatLang(ui, 'Crypted');
        if ((f.effects.E_Corrupt ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
        if (this.systemHasAv(sys, 'harmonie')) return formatLang(ui, 'CorruptBlocked');
        break;
      case 'cbomb':
        if (sys.corrupted) return formatLang(ui, 'Useless');
        break;
      case 'heal1':
      case 'heal2':
        if (this.life >= this.lifeTotal) return formatLang(ui, 'Useless');
        break;
      case 'mana1':
      case 'mana2':
      case 'mana3':
        if (this.mana >= this.manaTotal) return formatLang(ui, 'Useless');
        break;
      case 'dckswi':
      case 'dcksw2':
        if (this.decks.length <= 1 || this.canSwitchDeckInFs) return formatLang(ui, 'Useless');
        break;
      case 'reboo1':
      case 'reboo2':
        if (this.systemHasAv(sys, 'sysdef') || this.systemHasAv(sys, 'syslock')) {
          return formatLang(ui, 'RebootBlocked');
        }
        break;
      case 'rconv':
        if (this.life <= v.info) return formatLang(ui, 'WouldKillYou');
        break;
      case 'cust': {
        if (this.systemHasAv(sys, 'couveuse')) return formatLang(ui, 'Couveuse');
        if (v.target === '_file' && f && ((f.effects.E_Encoded ?? 0) > 0 || (f.effects.E_Masked ?? 0) > 0)) {
          return formatLang(ui, 'Crypted');
        }
        const mp = this.init.mission.type;
        const curNode = this.nodes[sys.nodeId];
        const curFolder = this.currentFolder;

        switch (mp.kind) {
          case 'DeliverFile':
            if (
              !curNode?.isMissionTarget ||
              curFolder?.key.toLowerCase() !== mp.parentKey.toLowerCase()
            ) {
              return formatLang(ui, 'NotThisFolder');
            }
            break;
          case 'CompromiseMail':
            if (!curNode?.isMissionTarget || curFolder?.key.toLowerCase() !== '/mail') {
              return formatLang(ui, 'NotThisFolder');
            }
            break;
          case 'Arrest':
            if (!curNode?.isMissionTarget || curFolder?.key.toLowerCase() !== '/subcrimedata') {
              return formatLang(ui, 'NotThisFolder');
            }
            break;
          case 'CorruptDisplay':
            if (!curNode?.isMissionTarget || curFolder?.key.toLowerCase() !== '/playlist') {
              return formatLang(ui, 'NotThisFolder');
            }
            break;
          case 'FalsifyCam':
          case 'OverwriteFiles': {
            if (!curNode?.isMissionTarget) return formatLang(ui, 'NotThisFolder');
            const reqExt = mp.kind === 'FalsifyCam' ? 'video' : mp.ext;
            const matching = curFolder
              ? curFolder.childrenIds
                  .map((cid) => sys.files[cid])
                  .filter((cf) => cf && !cf.deleted && !cf.isFolder && cf.ext === reqExt)
              : [];
            if (matching.length === 0) {
              return formatLang(ui, 'NeedInFolder', { ext: reqExt.toUpperCase() });
            }
            if (matching.every((cf) => (cf.effects.E_CustomInfected ?? 0) > 0)) {
              return formatLang(ui, 'AlreadyDone');
            }
            if (
              matching.some(
                (cf) =>
                  !(cf.effects.E_CustomInfected ?? 0) &&
                  ((cf.effects.E_Encoded ?? 0) > 0 || (cf.effects.E_Masked ?? 0) > 0)
              )
            ) {
              return formatLang(ui, 'Crypted');
            }
            break;
          }
          case 'Spy':
          case 'SpyCam':
            if (!f || f.key !== 'file.core') {
              return formatLang(ui, 'NeedExt', { ext: 'CORE' });
            }
            if (!curNode?.isMissionTarget) return formatLang(ui, 'InvalidTarget');
            if (mp.kind === 'Spy' && (f.effects.E_CShield ?? 0) > 0) {
              return formatLang(ui, 'CoreProtected');
            }
            if ((f.effects.E_CustomInfected ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
            break;
          case 'GameHack':
            if (!f || f.ext !== 'game') {
              return formatLang(ui, 'NeedExt', { ext: 'GAME' });
            }
            if (!curNode?.isMissionTarget || !f.isMissionTarget) {
              return formatLang(ui, 'NotThisFolder');
            }
            if ((f.effects.E_CustomInfected ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
            break;
          case 'InfectNet':
            if (!f || f.key !== 'file.control') {
              return formatLang(ui, 'NeedExt', { ext: 'CONTROL' });
            }
            if (!curNode?.isMissionTarget) return formatLang(ui, 'InvalidTarget');
            if ((f.effects.E_CustomInfected ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
            break;
          case 'GetVirus':
            if (!f || f.ext !== mp.ext) {
              return formatLang(ui, 'NeedExt', { ext: mp.ext.toUpperCase() });
            }
            if ((f.effects.E_CustomInfected ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
            if (!(f.effects.E_Target ?? 0)) {
              return formatLang(ui, 'NotInfected', { vname: mp.v });
            }
            break;
          case 'TV':
            if (!this.tvCopiedProgram) {
              return formatLang(ui, 'NeedTvCopy', { from: mp.tvFrom });
            }
            if (!f || f.key !== 'tvprog.data') {
              return formatLang(ui, 'NeedTvProg');
            }
            if (!curNode?.isMissionTarget) return formatLang(ui, 'InvalidTarget');
            if ((f.effects.E_CustomInfected ?? 0) > 0) return formatLang(ui, 'AlreadyDone');
            break;
          default:
            break;
        }
        break;
      }
    }
    return null;
  }

  private startCast(
    virusId: string,
    targetNodeId: number | null,
    targetFileId: number | null,
    multiplier: number,
    deckIndex: number | null = null,
    slotIndex: number | null = null
  ): { ok: boolean } {
    const sys = this.currentSystem;
    const f = sys && targetFileId !== null ? sys.files[targetFileId] ?? null : null;
    const speed = this.getSpeed();
    const fileSize = f && !['cd', 'exit', 'target'].includes(virusId) ? f.size : 1;

    // Exact duration math from VirusMan.getCT + Progress.start
    const dSec =
      virusId === 'exit' || virusId === 'target' || (this.isLeetMode && virusId !== 'connec')
        ? 0.1 / speed
        : ((1.0 / speed) * fileSize * multiplier) / speed;

    if (dSec < 0.1) {
      this.completeCast({
        virusId,
        targetNodeId,
        targetFileId,
        deckIndex,
        slotIndex,
        elapsedMs: 0,
        durationMs: 0,
        label: virusId.toUpperCase(),
      });
      this.drainEndTurn();
      return { ok: true };
    }

    const durationMs = Math.round(dSec * 1000);
    this.activeCast = {
      virusId,
      targetNodeId,
      targetFileId,
      deckIndex,
      slotIndex,
      elapsedMs: 0,
      durationMs,
      label: virusId.toUpperCase(),
    };
    if (dSec >= 0.5) {
      this.emitSound({ kind: 'loop_start', id: 'progress_01', channel: 'sfx' });
    }
    return { ok: true };
  }

  private completeCast(cast: ActiveCast): void {
    const ui = this.bundle.uiStrings;

    // Network connection cast
    if (cast.virusId === 'connec' && cast.targetNodeId !== null) {
      if (this.life <= 0 || this.busted || this.mana <= 0) return;
      const node = this.nodes[cast.targetNodeId];
      if (!node || !node.system || node.system.crashed) return;
      this.connectedNodeId = node.id;
      this.currentFolderId = node.system.rootFolderId;
      this.selectedFileId = null;
      this.canSwitchDeckInFs = false;
      this.appendSystemLog(node.system, 'TraceConnect', this.init.profile.username);
      this.pushLog('success', formatLang(ui, 'Log_ConnectedNode', { name: node.system.name }));
      this.emitSound({ kind: 'sfx', id: 'modem_03' });
      this.emitSound({ kind: 'loop_stop', id: 'menu' });
      this.emitSound({ kind: 'loop_start', id: 'drone_02', channel: 'ambient' });
      if (node.system.avDanger > 15) {
        this.emitSound({ kind: 'loop_start', id: this.init.mission.gl >= 6 ? 'rythme_03' : 'rythme_02', channel: 'beat' });
      }
      if (node.system.speed < 1.0) {
        this.lastPopup = { title: 'NETWORK BRAKE', message: formatLang(ui, 'SystemSlowedDown') };
      }
      this.advanceTutorialIfAt('connectNode');
      return;
    }

    const sys = this.currentSystem;
    if (!sys) return;

    const slot =
      cast.deckIndex !== undefined &&
      cast.deckIndex !== null &&
      cast.slotIndex !== undefined &&
      cast.slotIndex !== null
        ? this.deckSlots[cast.deckIndex]?.[cast.slotIndex]
        : this.currentDeck.find(
            (s) => s.virus.id === cast.virusId && (s.remainingUses === null || s.remainingUses > 0)
          ) ?? this.currentDeck.find((s) => s.virus.id === cast.virusId);
    const virus = slot?.virus ?? this.bundle.viruses.get(cast.virusId);
    if (!virus) return;

    const f = cast.targetFileId !== null ? sys.files[cast.targetFileId] ?? null : null;

    // Deduct mana & charge
    const ccCost = slot ? slot.effectiveCc : this.getEffectiveCc(virus);
    this.mana = Math.max(0, this.mana - ccCost);
    if (slot) {
      this.consumeSlotCharge(slot);
    }

    const comboCount = this.userEffects.UE_Combo ?? 0;
    if (virus.cat === 'combo') {
      delete this.userEffects.UE_Combo;
    }

    // Execute specific virus logic
    switch (virus.id) {
      case 'cd':
        if (f && f.isFolder) {
          this.onOpenDirectory(sys, f);
        }
        break;
      case 'exit':
        this.disconnectFromSystem(false);
        return;
      case 'rolbck':
        if (this.currentFolder && this.currentFolder.parentId !== null) {
          this.currentFolderId = this.currentFolder.parentId;
          this.selectedFileId = null;
        }
        break;
      case 'target':
        if (f) this.selectFile(f.id);
        break;
      case 'extrac':
        if (f && f.ext === 'pack') {
          if ((f.effects.E_PackMana ?? 0) > 0) {
            const gained = parseInt(f.content || '25', 10);
            this.mana = Math.min(this.manaTotal, this.mana + gained);
            this.incGoal('eextra', 1);
            this.pushLog('success', formatLang(ui, 'Log_GainedMana', { n: gained }));
          } else if ((f.effects.E_PackMoney ?? 0) > 0) {
            const valPrice = parseInt(f.content || '25', 10);
            const valDef =
              Array.from(this.bundle.valuables.values()).find((v) => v.price === valPrice) ??
              Array.from(this.bundle.valuables.values())[0];
            if (valDef) {
              this.extractedValuables.push(valDef.id);
              this.incGoal('mextra', 1);
              this.pushLog('success', formatLang(ui, 'Log_FoundValuable', { name: valDef.name }));
            }
          }
          this.emitSound({ kind: 'sfx', id: 'absorb_02' });
          this.deleteFile(sys, f, true);
        }
        break;
      case 'dmgs':
      case 'dmgm':
      case 'dmgl':
      case 'dmgxl':
      case 'avdmg1':
      case 'avdmg2':
      case 'fdmg':
        if (f) this.damageFile(sys, f, virus.power, true, false, true);
        break;
      case 'dshld':
        if (f) this.damageFile(sys, f, virus.power, true, true, true);
        break;
      case 'zone':
        if (this.currentFolder) {
          for (const cid of this.currentFolder.childrenIds) {
            const cf = sys.files[cid];
            if (cf && !cf.deleted && cf.avKey !== null) {
              this.damageFile(sys, cf, virus.power, true, false, true);
            }
          }
        }
        break;
      case 'clone':
        if (f && f.avKey && this.currentFolder) {
          const targetAv = f.avKey;
          for (const cid of this.currentFolder.childrenIds) {
            const cf = sys.files[cid];
            if (cf && !cf.deleted && cf.avKey === targetAv) {
              this.damageFile(sys, cf, virus.power, true, false, true);
            }
          }
        }
        break;
      case 'dot1':
      case 'dot2':
        if (f) {
          f.effects.E_Dot = virus.power;
          f.effects.E_DotLength = virus.info || 3;
        }
        break;
      case 'dsilen':
        if (f) {
          this.userEffects.UE_SilentDeath = 1;
          this.damageFile(sys, f, virus.power, true, false, true);
        }
        break;
      case 'dsile2':
        if (f) {
          this.userEffects.UE_SilentDeath = 1;
          this.userEffects.UE_Furtivity = (this.userEffects.UE_Furtivity ?? 0) + 1;
          this.damageFile(sys, f, virus.power, true, false, true);
        }
        break;
      case 'libxpl':
        if (f) f.effects.E_Splash = virus.power;
        break;
      case 'stun1':
      case 'stun2':
        if (f) f.effects.E_SkipAction = (f.effects.E_SkipAction ?? 0) + virus.power;
        break;
      case 'pbomb':
        for (const cf of Object.values(sys.files)) {
          if (cf.key === 'file.core') cf.deleted = true;
        }
        this.crashSystem(sys);
        return;
      case 'cbomb':
        this.corruptSystem(sys);
        break;
      case 'reveng':
        if (f) f.effects.E_Revenge = virus.power;
        break;
      case 'tag1':
      case 'tag2':
      case 'tag3':
        if (f) f.effects.E_Tag = virus.power;
        break;
      case 'unshld':
        if (f && (f.effects.E_Shield ?? 0) > 0) {
          f.effects.E_Shield!--;
          if (f.effects.E_Shield! <= 0) delete f.effects.E_Shield;
        }
        break;
      case 'exploi':
        if (f) f.effects.E_Exploit = 1;
        break;
      case 'weak1':
      case 'weak2':
        if (f) f.effects.E_Weaken = virus.power;
        break;
      case 'disabl':
      case 'disab2':
        if (f && f.avKey) {
          this.unregisterAv(sys, f);
          f.effects.E_Disabled = 1;
          this.emitSound({ kind: 'sfx', id: 'electro_02' });
        }
        break;
      case 'copy':
        if (f) {
          f.effects.E_Copy = 1;
          if (!f.isMissionTarget) {
            this.copiedFiles.push({
              name: f.name,
              content: f.content,
              embed: f.embed,
            });
          }
          if (this.init.mission.type.kind === 'TV' && f.key === 'tvprog.data' && f.isMissionTarget) {
            this.tvCopiedProgram = true;
          }
          this.pushLog(
            'success',
            formatLang(ui, 'Log_Copied', {
              name: f.name,
              n: this.copiedFiles.length,
              max: this.maxStorage,
            })
          );
          this.emitSound({ kind: 'sfx', id: 'bleep_06' });
        }
        break;
      case 'dec1':
      case 'dec2':
      case 'dec3':
        if (f) {
          delete f.effects.E_Encoded;
          this.emitSound({ kind: 'sfx', id: 'bleep_05' });
          this.tryCollectCard(f);
        }
        break;
      case 'unmask':
        if (f) {
          delete f.effects.E_Masked;
          this.tryCollectCard(f);
        }
        break;
      case 'scan1':
      case 'scan2':
      case 'scan3':
      case 'scan4':
      case 'scan42':
      case 'hunt':
        this.scannerState = {
          open: true,
          scanLevel: virus.id === 'scan1' || virus.id === 'hunt' ? 1 : virus.id === 'scan2' ? 2 : 3,
          mode: virus.id === 'scan4' ? 'av' : virus.id === 'hunt' ? 'pack' : 'normal',
          ignoreScrambler: virus.id === 'scan42',
        };
        this.pushLog('info', formatLang(ui, 'Log_Scanner'));
        this.emitSound({ kind: 'sfx', id: 'single_01' });
        break;
      case 'panic1':
        this.disconnectFromSystem(false);
        return;
      case 'panic2':
        this.disconnectFromSystem(true);
        return;
      case 'heal1':
      case 'heal2':
        this.life = Math.min(this.lifeTotal, this.life + virus.power);
        this.pushLog('success', formatLang(ui, 'Log_GainedLife', { n: virus.power }));
        this.emitSound({ kind: 'sfx', id: 'bonus_02' });
        break;
      case 'mana1':
      case 'mana2':
      case 'mana3':
        this.mana = Math.min(this.manaTotal, this.mana + virus.power);
        this.pushLog('success', formatLang(ui, 'Log_GainedMana', { n: virus.power }));
        this.emitSound({ kind: 'sfx', id: 'bonus_01' });
        break;
      case 'chrge2':
      case 'chrge3':
        this.userEffects.UE_Charge = (this.userEffects.UE_Charge ?? 0) + (virus.id === 'chrge3' ? 3 : 2);
        break;
      case 'shld1':
      case 'shld2': {
        const existing = this.userEffects.UE_Shield ?? 0;
        const cap = virus.power;
        const gain = virus.power;
        this.userEffects.UE_Shield = Math.max(existing, Math.min(cap, existing + gain));
        this.emitSound({ kind: 'sfx', id: 'shield' });
        break;
      }
      case 'rconv':
        this.damagePlayer(virus.info || 2, false);
        this.mana = Math.min(this.manaTotal, this.mana + virus.power);
        break;
      case 'fmove1':
      case 'fmove2':
        this.userEffects.UE_MoveFurtivity = (this.userEffects.UE_MoveFurtivity ?? 0) + virus.power;
        break;
      case 'invis':
        this.userEffects.UE_Furtivity = (this.userEffects.UE_Furtivity ?? 0) + virus.power + 1;
        break;
      case 'corrup':
      case 'corru2':
        if (f) {
          f.effects.E_Corrupt = 1;
          this.emitSound({ kind: 'sfx', id: 'corrupt_01' });
          const remain = Object.values(sys.files).filter(
            (x) => !x.deleted && x.key === 'file.control' && !(x.effects.E_Corrupt ?? 0)
          ).length;
          if (remain === 0) {
            this.corruptSystem(sys);
          } else if (virus.id === 'corru2') {
            this.pushLog('info', formatLang(ui, 'Log_CorruptRemain', { n: remain }));
          }
        }
        break;
      case 'dckswi':
      case 'dcksw2':
        this.canSwitchDeckInFs = true;
        break;
      case 'reboo1':
      case 'reboo2': {
        const capturedAvs = Object.values(sys.files).filter(
          (af) => !af.deleted && af.avKey !== null && !(af.effects.E_Disabled ?? 0)
        );
        this.onVirusExecuted(sys, virus);
        this.disconnectFromSystem(false);
        for (const af of capturedAvs) {
          if (!af.deleted && af.avKey !== null && !(af.effects.E_Disabled ?? 0)) {
            af.effects.E_SkipAction = Math.max(af.effects.E_SkipAction ?? 0, 3);
            if (virus.id === 'reboo2') af.effects.E_Exploit = 1;
          }
        }
        if (this.mana <= 0 && this.life > 0) {
          this.pushLog('danger', formatLang(ui, 'Log_OOM'));
        }
        this.evaluateMissionObjective();
        return;
      }
      case 'cevi':
        this.userEffects.UE_DamageBurst = comboCount;
        break;
      case 'cstun':
        // Fixed Haxe bug: applies v.power * comboCount stacks as promised in XML!
        if (f) f.effects.E_SkipAction = (f.effects.E_SkipAction ?? 0) + virus.power * comboCount;
        break;
      case 'cshld':
      case 'cshld2':
      case 'cshld3': {
        const existing = this.userEffects.UE_Shield ?? 0;
        const cap = virus.power * comboCount;
        const gain = virus.power * comboCount;
        this.userEffects.UE_Shield = Math.max(existing, Math.min(cap, existing + gain));
        this.emitSound({ kind: 'sfx', id: 'shield' });
        break;
      }
      case 'cchrge':
        this.userEffects.UE_Charge = (this.userEffects.UE_Charge ?? 0) + comboCount;
        break;
      case 'cust':
        this.executeCustomMissionVirus(sys, f);
        break;
    }

    // Trigger onVirusRun AV hooks (ignores cd, connec, extrac, target)
    if (!['cd', 'connec', 'extrac', 'target'].includes(virus.id) && this.connectedNodeId !== null) {
      this.onVirusExecuted(sys, virus);
    }

    this.drainEndTurn();

    // Check OOM disconnect
    if (this.mana <= 0 && this.connectedNodeId !== null) {
      this.pushLog('danger', formatLang(ui, 'Log_OOM'));
      this.disconnectFromSystem(false);
      return;
    }

    this.evaluateMissionObjective();
  }

  private executeCustomMissionVirus(sys: SystemState, f: FileNodeState | null): void {
    const mp = this.init.mission.type;
    const ui = this.bundle.uiStrings;

    const getInheritedUploadEffects = (): FileNodeState['effects'] => {
      let maskStacks = 0;
      let curAnc: FileNodeState | undefined = this.currentFolder ?? undefined;
      while (curAnc) {
        maskStacks += curAnc.childrenIds.filter((cid) => {
          const cf = sys.files[cid];
          return cf && !cf.deleted && cf.avKey === 'mask';
        }).length;
        curAnc = curAnc.parentId !== null ? sys.files[curAnc.parentId] : undefined;
      }
      const effects: FileNodeState['effects'] = { E_CustomInfected: 1 };
      if (this.systemHasAv(sys, 'paladin')) effects.E_Immune = 1;
      if (maskStacks > 0) effects.E_Masked = maskStacks;
      return effects;
    };

    const ensureUniqueUploadedName = (folder: FileNodeState, rawName: string): string => {
      const seen = new Set(
        folder.childrenIds
          .map((cid) => sys.files[cid])
          .filter((cf) => cf && !cf.deleted)
          .map((cf) => cf.name.toLowerCase())
      );
      let candidate = rawName;
      let attempt = 1;
      while (seen.has(candidate.toLowerCase())) {
        attempt++;
        const dot = rawName.lastIndexOf('.');
        candidate =
          dot > 0
            ? `${rawName.slice(0, dot)}_${attempt}${rawName.slice(dot)}`
            : `${rawName}_${attempt}`;
      }
      return candidate;
    };

    if (mp.kind === 'CorruptDisplay') {
      if (!this.currentFolder) return;
      const rng = Rand.fromSeed(this.init.seed ^ 0xcd15);
      const { fsNames } = this.bundle.createTextEngines(this.init.seed ^ 0xcd15, this.init.profile.adult);
      const count = 5 + rng.random(7); // 5..11 subversive .data files
      let nextId = Math.max(0, ...Object.keys(sys.files).map(Number)) + 1;
      for (let i = 0; i < count; i++) {
        const id = nextId++;
        const rawSubName = fsNames.exists('playlist.subversive.data')
          ? fsNames.get('playlist.subversive.data', rng)
          : `subversive_${id}.data`;
        const uploadedName = ensureUniqueUploadedName(this.currentFolder, rawSubName);
        const uploaded: FileNodeState = {
          id,
          key: 'uploaded.mission',
          name: uploadedName,
          ext: 'data',
          isFolder: false,
          parentId: this.currentFolder.id,
          childrenIds: [],
          size: 1,
          life: 1,
          lifeTotal: 1,
          deleted: false,
          password: null,
          avKey: null,
          content: formatLang(ui, 'UploadedFile'),
          embed: null,
          cardData: null,
          isMissionTarget: true,
          infectedByVirus: 'cust',
          effects: getInheritedUploadEffects(),
        };
        sys.files[id] = uploaded;
        this.currentFolder.childrenIds.push(id);
      }
      this.pushLog('success', `${formatLang(ui, 'UploadedFile')} (${count})`);
      this.emitSound({ kind: 'sfx', id: 'bonus_02' });
      return;
    }

    if (mp.kind === 'DeliverFile' || mp.kind === 'CompromiseMail' || mp.kind === 'Arrest') {
      if (!this.currentFolder) return;
      const newId = Math.max(0, ...Object.keys(sys.files).map(Number)) + 1;
      const rawUploadedName =
        mp.kind === 'DeliverFile'
          ? mp.file
          : mp.kind === 'CompromiseMail'
            ? 'compromise.mail'
            : `${mp.name}.data`;
      const uploadedName = ensureUniqueUploadedName(this.currentFolder, rawUploadedName);
      const uploaded: FileNodeState = {
        id: newId,
        key: 'uploaded.mission',
        name: uploadedName,
        ext: uploadedName.split('.').pop()?.toLowerCase() ?? 'dat',
        isFolder: false,
        parentId: this.currentFolder.id,
        childrenIds: [],
        size: 1,
        life: 1,
        lifeTotal: 1,
        deleted: false,
        password: null,
        avKey: null,
        content: formatLang(ui, 'UploadedFile'),
        embed: null,
        cardData: null,
        isMissionTarget: true,
        infectedByVirus: 'cust',
        effects: getInheritedUploadEffects(),
      };
      sys.files[newId] = uploaded;
      this.currentFolder.childrenIds.push(newId);
      this.pushLog('success', `${formatLang(ui, 'UploadedFile')}: ${uploadedName}`);
      this.emitSound({ kind: 'sfx', id: 'bonus_02' });
      return;
    }

    if (mp.kind === 'FalsifyCam' || mp.kind === 'OverwriteFiles') {
      if (!this.currentFolder) return;
      const reqExt = mp.kind === 'FalsifyCam' ? 'video' : mp.ext;
      for (const cid of this.currentFolder.childrenIds) {
        const cf = sys.files[cid];
        if (
          cf &&
          !cf.deleted &&
          !cf.isFolder &&
          cf.ext === reqExt &&
          !(cf.effects.E_Encoded ?? 0) &&
          !(cf.effects.E_Masked ?? 0)
        ) {
          cf.effects.E_CustomInfected = 1;
          cf.infectedByVirus = 'cust';
        }
      }
      this.emitSound({ kind: 'sfx', id: 'corrupt_01' });
      return;
    }

    if (f) {
      f.effects.E_CustomInfected = 1;
      f.infectedByVirus = 'cust';
      if (mp.kind === 'GetVirus' && (f.effects.E_Target ?? 0) > 0) {
        delete f.effects.E_Target;
        this.missionCpt++;
        const pct = Math.min(100, Math.round((this.missionCpt / mp.n) * 100));
        this.pushLog('info', formatLang(ui, 'ExtractedVirus', { pct, vname: mp.v }));
      }
      this.emitSound({ kind: 'sfx', id: 'corrupt_01' });
    }
  }

  private onVirusExecuted(sys: SystemState, virus: VirusDef): void {
    const furtive = (this.userEffects.UE_Furtivity ?? 0) > 0;
    if (!furtive) {
      this.appendSystemLog(sys, 'TraceVirus', virus.id.toUpperCase());
      // Fantassin in current folder
      if (this.currentFolder) {
        this.queueAvAttacks(sys, 'fantassin', this.currentFolder.id);
      }
      // Logic Bomb system-wide
      for (const bf of Object.values(sys.files)) {
        if (!bf.deleted && bf.avKey === 'bomb') {
          const cnt = (bf.effects.E_Counter ?? 0) + 1;
          bf.effects.E_Counter = cnt;
          if (cnt > BOMB_LIMIT) {
            this.queueSingleAvAttack(sys, bf, 'bomb');
          } else if (cnt === BOMB_LIMIT) {
            this.pushLog('danger', formatLang(this.bundle.uiStrings, 'Log_BombLast'));
          } else {
            this.pushLog('warn', formatLang(this.bundle.uiStrings, 'Log_Bomb', { n: cnt, max: BOMB_LIMIT }));
          }
        }
      }
    } else {
      this.endTurnQueue.push(() => {
        this.pendingFurtivityConsume++;
      });
      this.pushLog('info', formatLang(this.bundle.uiStrings, 'Log_Stealth'));
    }
  }

  private onOpenDirectory(sys: SystemState, targetFolder: FileNodeState): void {
    const prevFolderId = this.currentFolderId;
    if (prevFolderId !== null) {
      this.queueAvAttacks(sys, 'mine', prevFolderId);
    }
    this.queueAvAttacks(sys, 'oxy', null);
    this.queueAvAttacks(sys, 'bigoxy', null);

    this.currentFolderId = targetFolder.id;
    this.selectedFileId = null;
    this.appendSystemLog(sys, 'TraceCD', targetFolder.name);
    this.consumeMoveFurtivity();
    this.emitSound({ kind: 'sfx', id: 'bleep_02' });
  }

  public disconnectFromSystem(stealth: boolean): void {
    if (this.isDisconnecting) return;
    this.isDisconnecting = true;
    try {
      const sys = this.currentSystem;
      if (sys) {
        this.drainEndTurn();
        if (!stealth) {
          if (this.currentFolderId !== null) {
            this.queueAvAttacks(sys, 'mine', this.currentFolderId);
          }
          this.queueAvAttacks(sys, 'oxy', null);
          this.queueAvAttacks(sys, 'bigoxy', null);
          this.drainEndTurn();
        }
        for (const f of Object.values(sys.files)) {
          delete f.effects.E_Dot;
          delete f.effects.E_DotLength;
        }
      }

      // Clear per-connection effects
      this.pendingFurtivityConsume = 0;
      delete this.userEffects.UE_Furtivity;
      delete this.userEffects.UE_MoveFurtivity;
      this.connectedNodeId = null;
      this.currentFolderId = null;
      this.selectedFileId = null;
      this.canSwitchDeckInFs = false;
      this.scannerState = null;
      this.pendingPasswordFolderId = null;

      this.emitSound({ kind: 'loop_stop', id: 'drone_02' });
      this.emitSound({ kind: 'loop_stop', id: 'rythme_02' });
      this.emitSound({ kind: 'loop_stop', id: 'rythme_03' });
      this.emitSound({ kind: 'loop_start', id: 'menu', channel: 'beat' });

      this.refreshFogOfWar();
      this.evaluateMissionObjective();
    } finally {
      this.isDisconnecting = false;
    }
  }

  // --- Damage & Combat Math ---
  private damageFile(
    sys: SystemState,
    f: FileNodeState,
    base: number,
    canBeBoosted: boolean,
    ignoreShield: boolean,
    canSpread: boolean,
    applyBrute = true
  ): void {
    if (f.deleted || f.life <= 0) return;
    let dmg = base;
    if (applyBrute && this.hasChipset('brute')) dmg = Math.round(1.5 * dmg);

    if (canBeBoosted) {
      if ((this.userEffects.UE_DamageBurst ?? 0) > 0) {
        dmg += 10;
        if (!this.burstConsumedThisTurn) {
          this.burstConsumedThisTurn = true;
          this.endTurnQueue.push(() => {
            this.burstConsumedThisTurn = false;
            if ((this.userEffects.UE_DamageBurst ?? 0) > 0) {
              this.userEffects.UE_DamageBurst!--;
              if (this.userEffects.UE_DamageBurst! <= 0) delete this.userEffects.UE_DamageBurst;
            }
          });
        }
      }
      if ((this.userEffects.UE_Charge ?? 0) > 0) {
        dmg *= this.userEffects.UE_Charge!;
        this.endTurnQueue.push(() => {
          delete this.userEffects.UE_Charge;
        });
      }
    }

    if ((f.effects.E_Exploit ?? 0) > 0) {
      dmg *= 1.5 * f.effects.E_Exploit!;
    }

    if (!ignoreShield) {
      if ((f.effects.E_Shield ?? 0) > 0) {
        dmg = Math.max(0, dmg - SHIELD_ABSORB * f.effects.E_Shield!);
      }
      if ((f.effects.E_CShield ?? 0) > 0) {
        dmg = Math.max(0, dmg - CSHIELD_ABSORB * f.effects.E_CShield!);
      }
    }

    if (this.hasChipset('scout') && (f.key === 'file.core' || f.key === 'file.guardian')) {
      dmg = 0;
    }

    if ((f.effects.E_Immune ?? 0) > 0) {
      dmg = 0;
    }

    const finalDmg = Math.floor(dmg);
    f.life = Math.max(0, f.life - finalDmg);
    this.emitSound({ kind: 'sfx', id: finalDmg > 0 ? 'hit_01' : 'shield' });

    if (finalDmg > 0) {
      // E_Tag link spread (computed from finalDmg; does not re-apply brute or boosts)
      if (canSpread && (f.effects.E_Tag ?? 0) > 0) {
        const sdamage = Math.floor((finalDmg * f.effects.E_Tag!) / 100);
        if (sdamage > 0) {
          for (const neig of Object.values(sys.files)) {
            if (neig.id !== f.id && !neig.deleted && (neig.effects.E_Tag ?? 0) > 0) {
              this.endTurnQueue.push(() =>
                this.damageFile(sys, neig, sdamage, false, false, false, false)
              );
            }
          }
        }
      }

      // Eject in folder (respects E_SkipAction and UE_Furtivity; queued BEFORE deleteFile/crashSystem)
      if (f.parentId !== null) {
        const folder = sys.files[f.parentId];
        if (folder) {
          for (const cid of folder.childrenIds) {
            const ej = sys.files[cid];
            if (ej && !ej.deleted && ej.avKey === 'eject') {
              this.endTurnQueue.push(() => {
                if (ej.deleted || sys.crashed || this.connectedNodeId !== sys.nodeId) return;
                const ui = this.bundle.uiStrings;
                if ((ej.effects.E_SkipAction ?? 0) > 0) {
                  ej.effects.E_SkipAction!--;
                  if (ej.effects.E_SkipAction! <= 0) delete ej.effects.E_SkipAction;
                  this.pushLog('info', formatLang(ui, 'AntivirusBlocked', { av: 'EJECT' }));
                  return;
                }
                if ((this.userEffects.UE_Furtivity ?? 0) > 0) {
                  this.pushLog('info', formatLang(ui, 'AntivirusDodged', { av: 'EJECT' }));
                  return;
                }
                this.pushLog('danger', formatLang(ui, 'Ejected', { av: 'EJECT' }));
                this.disconnectFromSystem(false);
              });
            }
          }
        }
      }

      // Tique system-wide (queued BEFORE deleteFile/crashSystem so core kills trigger tique)
      this.queueAvAttacks(sys, 'tique', null);
    }

    if (f.life <= 0) {
      // E_Splash on death (does not re-apply brute or boosts)
      if ((f.effects.E_Splash ?? 0) > 0 && f.parentId !== null) {
        const sdamage = Math.floor((finalDmg * f.effects.E_Splash!) / 100);
        const parent = sys.files[f.parentId];
        if (parent && sdamage > 0) {
          for (const cid of parent.childrenIds) {
            const sib = sys.files[cid];
            if (
              sib &&
              sib.id !== f.id &&
              !sib.deleted &&
              (sib.key === 'file.core' || sib.key === 'file.guardian' || sib.avKey !== null)
            ) {
              this.endTurnQueue.push(() =>
                this.damageFile(sys, sib, sdamage, false, false, true, false)
              );
            }
          }
        }
      }
      this.deleteFile(sys, f, false);
    }
  }

  private deleteFile(sys: SystemState, f: FileNodeState, stealth: boolean): void {
    if (f.deleted) return;
    f.deleted = true;
    delete f.effects.E_Dot;
    delete f.effects.E_DotLength;
    if (this.selectedFileId === f.id) this.selectedFileId = null;

    const ui = this.bundle.uiStrings;
    this.emitSound({ kind: 'sfx', id: 'explode_01' });
    this.pushLog('info', formatLang(ui, 'Log_Death', { name: f.name }));

    if (f.ext === 'log') {
      this.incGoal('log', 1);
      if (!this.init.isChallenge && !this.busted && this.hasTimer) {
        this.timeLimitMs += 30 * 1000;
        this.pushLog('success', formatLang(ui, 'Log_GainedTime', { n: 30 }));
      }
    }

    if (f.avKey !== null) {
      this.incGoal('av', 1);
      this.unregisterAv(sys, f);
      this.endTurnQueue.push(() => {
        this.userEffects.UE_Combo = Math.min(this.maxCombo, (this.userEffects.UE_Combo ?? 0) + 1);
      });
    }

    if (f.key === 'file.guardian') {
      for (const core of Object.values(sys.files)) {
        if (core.key === 'file.core' && (core.effects.E_CShield ?? 0) > 0) {
          core.effects.E_CShield!--;
          if (core.effects.E_CShield! <= 0) delete core.effects.E_CShield;
        }
      }
    }

    if (!stealth) {
      this.appendSystemLog(sys, 'TraceDelete', f.name);
      this.queueAvAttacks(sys, 'repurgator', null);
      if (f.key === 'file.core' || f.key === 'file.guardian' || f.key === 'file.control') {
        this.queueAvAttacks(sys, 'sysdef', null);
      }
    }

    // Check system crash (all file.core destroyed)
    const remainingCores = Object.values(sys.files).filter((x) => !x.deleted && x.key === 'file.core');
    const hadCores = Object.values(sys.files).some((x) => x.key === 'file.core');
    if (hadCores && remainingCores.length === 0) {
      this.crashSystem(sys);
    }
  }

  private unregisterAv(sys: SystemState, avFile: FileNodeState): void {
    const oldAv = avFile.avKey;
    if (!oldAv) return;
    avFile.avKey = null;

    if (oldAv === 'shield') {
      for (const f of Object.values(sys.files)) {
        if ((f.effects.E_Shield ?? 0) > 0) {
          f.effects.E_Shield!--;
          if (f.effects.E_Shield! <= 0) delete f.effects.E_Shield;
        }
      }
    } else if (oldAv === 'mask' && avFile.parentId !== null) {
      const decMaskRec = (folderId: number) => {
        const folder = sys.files[folderId];
        if (!folder) return;
        for (const cid of folder.childrenIds) {
          const ch = sys.files[cid];
          if (!ch) continue;
          if ((ch.effects.E_Masked ?? 0) > 0) {
            ch.effects.E_Masked!--;
            if (ch.effects.E_Masked! <= 0) delete ch.effects.E_Masked;
          }
          if (ch.isFolder) decMaskRec(ch.id);
        }
      };
      decMaskRec(avFile.parentId);
      if (this.selectedFileId !== null) {
        this.tryCollectCard(sys.files[this.selectedFileId]);
      }
    } else if (oldAv === 'paladin' && !this.systemHasAv(sys, 'paladin')) {
      for (const f of Object.values(sys.files)) {
        delete f.effects.E_Immune;
      }
    }
  }

  private crashSystem(sys: SystemState): void {
    if (sys.crashed) return;
    const wasAlreadyCorrupted = sys.corrupted;
    sys.crashed = true;
    if (!wasAlreadyCorrupted) this.kills++;
    this.incGoal('crash', 1);
    this.emitSound({ kind: 'sfx', id: 'explode_02' });
    this.pushLog('success', formatLang(this.bundle.uiStrings, 'Crashed'));
    if (!wasAlreadyCorrupted) {
      this.onNodeStatusChanged(sys.nodeId);
    }
    this.disconnectFromSystem(true);
  }

  private corruptSystem(sys: SystemState): void {
    if (sys.corrupted) return;
    sys.corrupted = true;
    this.kills++;
    this.incGoal('corrup', 1);
    this.emitSound({ kind: 'sfx', id: 'corrupt_02' });
    this.pushLog('success', formatLang(this.bundle.uiStrings, 'Corrupted'));
    this.onNodeStatusChanged(sys.nodeId);
    this.refreshFogOfWar();
    this.evaluateMissionObjective();
  }

  private onNodeStatusChanged(nodeId: number): void {
    const node = this.nodes[nodeId];
    if (!node) return;

    if (this.alarmOriginNodeId === nodeId) {
      this.alarmRemainingSec = null;
      this.alarmOriginNodeId = null;
      this.pushLog('success', formatLang(this.bundle.uiStrings, 'AlarmStop'));
    }

    if (this.alarmRemainingSec === null) {
      const linkedAlarm = this.getNonEmptyNeighbours(node).find(
        (n) => n.type === 'Alarm' && this.isNodeUp(n)
      );
      if (linkedAlarm) {
        let d = 60;
        if (this.isNodeShielded(linkedAlarm)) d += 60;
        if (this.init.mission.gl >= 9) d += 30;
        this.alarmOriginNodeId = linkedAlarm.id;
        this.alarmRemainingSec = d + 1;
        this.pushLog('danger', formatLang(this.bundle.uiStrings, 'AlarmStatus', { n: d }));
        this.emitSound({ kind: 'sfx', id: 'alarm_01' });
      }
    }
  }

  private queueAvAttacks(sys: SystemState, avKey: string, folderId: number | null): void {
    const avFiles = Object.values(sys.files).filter(
      (f) => !f.deleted && f.avKey === avKey && (folderId === null || f.parentId === folderId)
    );
    for (const af of avFiles) {
      this.queueSingleAvAttack(sys, af, avKey);
    }
  }

  private queueSingleAvAttack(sys: SystemState, af: FileNodeState, avKey: string): void {
    this.endTurnQueue.push(() => {
      if (af.deleted) return;
      if (avKey === 'bomb') {
        delete af.effects.E_Counter;
      }
      const ui = this.bundle.uiStrings;

      if ((af.effects.E_SkipAction ?? 0) > 0) {
        af.effects.E_SkipAction!--;
        if (af.effects.E_SkipAction! <= 0) delete af.effects.E_SkipAction;
        this.pushLog('info', formatLang(ui, 'AntivirusBlocked', { av: avKey.toUpperCase() }));
        return;
      }

      if ((this.userEffects.UE_Furtivity ?? 0) > 0) {
        this.pushLog('info', formatLang(ui, 'AntivirusDodged', { av: avKey.toUpperCase() }));
        return;
      }

      if (
        (this.userEffects.UE_MoveFurtivity ?? 0) > 0 &&
        (avKey === 'oxy' || avKey === 'bigoxy' || avKey === 'mine')
      ) {
        this.pushLog('info', formatLang(ui, 'AntivirusDodged', { av: avKey.toUpperCase() }));
        return;
      }

      if (
        (this.userEffects.UE_SilentDeath ?? 0) > 0 &&
        (avKey === 'repurgator' || avKey === 'sysdef')
      ) {
        this.pushLog('info', formatLang(ui, 'AntivirusDodged', { av: avKey.toUpperCase() }));
        return;
      }

      const avDef = this.bundle.antiviruses.get(avKey);
      if (!avDef || avDef.power <= 0) return;

      let dmg = avDef.power;
      if (this.hasChipset('nox') && (avKey === 'oxy' || avKey === 'bigoxy')) {
        dmg = Math.ceil(dmg * 0.5);
      }
      if ((af.effects.E_Weaken ?? 0) > 0) {
        dmg = Math.round(dmg / af.effects.E_Weaken!);
      }
      if (this.systemHasAv(sys, 'inferno')) {
        dmg = Math.floor((dmg * 150) / 100);
      }

      if (dmg > 0) {
        this.pushLog(
          'warn',
          `[${avKey.toUpperCase()}] ${formatLang(ui, `AV_${avKey}`)} : ${formatLang(ui, 'AntivirusDamage', { n: dmg })}`
        );
        this.damagePlayer(dmg, true);
        if (
          this.life > 0 &&
          (this.connectedNodeId === sys.nodeId || this.isDisconnecting) &&
          (af.effects.E_Revenge ?? 0) > 0
        ) {
          const rev = af.effects.E_Revenge!;
          delete af.effects.E_Revenge;
          this.pushLog('success', formatLang(ui, 'RevengeEffect', { av: avKey.toUpperCase(), v: 'REVENG', p: rev }));
          this.damageFile(sys, af, rev, false, false, true, false);
        }
      }
    });
  }

  private damagePlayer(amount: number, canBeBlocked: boolean): number {
    if (amount <= 0) return 0;
    let dmg = amount;
    if (canBeBlocked && (this.userEffects.UE_Shield ?? 0) > 0) {
      const absorbed = Math.min(dmg, this.userEffects.UE_Shield!);
      dmg -= absorbed;
      this.userEffects.UE_Shield! -= absorbed;
      if (this.userEffects.UE_Shield! <= 0) delete this.userEffects.UE_Shield;
      if (absorbed > 0) {
        this.pushLog('info', formatLang(this.bundle.uiStrings, 'Log_Shield', { n: absorbed }));
      }
    }
    if (dmg > 0) {
      this.life = Math.max(0, this.life - dmg);
      this.emitSound({ kind: 'sfx', id: 'hit_03' });
      if (this.life <= 0) {
        this.cancelCast();
        if (this.connectedNodeId !== null) {
          this.disconnectFromSystem(true);
        }
        this.lastPopup = {
          title: 'TERMINAL OFFLINE',
          message: formatLang(this.bundle.uiStrings, 'YouAreDead'),
          fatal: true,
        };
      }
    }
    return dmg;
  }

  private drainEndTurn(): void {
    let safety = 0;
    while (this.endTurnQueue.length > 0 && safety++ < 200) {
      const fn = this.endTurnQueue.shift()!;
      fn();
    }
    this.burstConsumedThisTurn = false;
    delete this.userEffects.UE_SilentDeath;
    if (this.pendingFurtivityConsume > 0) {
      const next = (this.userEffects.UE_Furtivity ?? 0) - this.pendingFurtivityConsume;
      this.pendingFurtivityConsume = 0;
      if (next > 0) {
        this.userEffects.UE_Furtivity = next;
      } else {
        delete this.userEffects.UE_Furtivity;
      }
    }
  }

  // --- CLI Execution & Autocomplete ---
  public executeCliCommand(rawCmd: string): { ok: boolean; error?: string } {
    const trimmed = rawCmd.trim();
    if (!trimmed) return { ok: true };

    this.cmdHistory.unshift(trimmed);
    if (this.cmdHistory.length > 20) this.cmdHistory.length = 20;

    // Expand .hackrc aliases ONLY on the first token
    const firstSpaceIdx = trimmed.search(/\s/);
    const rawFirst = firstSpaceIdx === -1 ? trimmed : trimmed.slice(0, firstSpaceIdx);
    const rawRest = firstSpaceIdx === -1 ? '' : trimmed.slice(firstSpaceIdx).trim();

    const aliasExpansion = this.aliases.get(rawFirst.toLowerCase());
    let cmd: string;
    let arg: string;
    if (aliasExpansion !== undefined) {
      const expSpaceIdx = aliasExpansion.search(/\s/);
      if (expSpaceIdx === -1) {
        cmd = aliasExpansion.toLowerCase();
        arg = rawRest;
      } else {
        cmd = aliasExpansion.slice(0, expSpaceIdx).toLowerCase();
        const expArg = aliasExpansion.slice(expSpaceIdx).trim();
        arg = rawRest ? `${expArg} ${rawRest}` : expArg;
      }
    } else {
      cmd = rawFirst.toLowerCase();
      arg = rawRest;
    }

    if (cmd === 'cd' && arg === '..') {
      return this.goParentOrDisconnect();
    }

    const sys = this.currentSystem;
    const cur = this.currentFolder;
    let targetFileId: number | undefined;

    if (arg && sys && cur) {
      const candidates = cur.childrenIds
        .map((id) => sys.files[id])
        .filter((f) => f && !f.deleted && !(f.effects.E_Masked ?? 0));
      const exact = candidates.find((f) => f.name.toLowerCase() === arg.toLowerCase());
      if (!exact) {
        return this.failAction(formatLang(this.bundle.uiStrings, 'FileNotFound'));
      }
      targetFileId = exact.id;
    }

    return this.useVirusById(cmd, targetFileId);
  }

  public autoCompleteCli(input: string): { completed: string; suggestions: string[] } {
    const hasSpace = input.includes(' ');
    if (!hasSpace) {
      const prefix = input.toLowerCase();
      const pool = new Set<string>();
      for (const s of this.currentDeck) {
        if (s.virus.target !== '_net' && (s.remainingUses === null || s.remainingUses > 0)) {
          pool.add(s.virus.id);
        }
      }
      for (const hiddenId of ['cd', 'exit', 'target', 'extrac']) pool.add(hiddenId);
      for (const aliasKey of this.aliases.keys()) pool.add(aliasKey);

      const matches = Array.from(pool)
        .filter((k) => k.toLowerCase().startsWith(prefix))
        .sort();
      if (matches.length === 1) return { completed: matches[0] + ' ', suggestions: [] };
      if (matches.length > 1) {
        const lcp = longestCommonPrefix(matches);
        return { completed: lcp, suggestions: matches };
      }
      return { completed: input, suggestions: [] };
    }

    // Second token: complete only non-deleted, non-masked files/folders in curFolder (fixed Haxe alias bug!)
    const firstSpace = input.indexOf(' ');
    const head = input.slice(0, firstSpace + 1);
    const partial = input.slice(firstSpace + 1).toLowerCase();
    const sys = this.currentSystem;
    const cur = this.currentFolder;
    if (!sys || !cur) return { completed: input, suggestions: [] };

    const names = cur.childrenIds
      .map((cid) => sys.files[cid])
      .filter((f) => f && !f.deleted && !(f.effects.E_Masked ?? 0))
      .map((f) => f.name)
      .filter((n) => n.toLowerCase().startsWith(partial))
      .sort();

    if (names.length === 1) return { completed: head + names[0], suggestions: [] };
    if (names.length > 1) {
      return { completed: head + longestCommonPrefix(names), suggestions: names };
    }
    return { completed: input, suggestions: [] };
  }

  // --- Objective Check ---
  public evaluateMissionObjective(): boolean {
    if (this.busted || this.hasChipset('scout')) return false;

    const targetNodes = Object.values(this.nodes).filter((n) => n.isMissionTarget && n.system !== null);
    if (targetNodes.length === 0) return false;
    const fn = targetNodes[0].system!;
    const mp = this.init.mission.type;

    let done = false;
    switch (mp.kind) {
      case 'Tutorial':
      case 'CrashTerminal':
      case 'CrashPrinter':
      case 'CrashDB':
        done = fn.crashed;
        break;
      case 'TVCrash': {
        const otherTvsCrashed = Object.values(this.nodes).some(
          (n) => n.type === 'Tv' && !n.isMissionTarget && n.system?.crashed
        );
        done = fn.crashed && !otherTvsCrashed;
        break;
      }
      case 'CleanSecurity':
        done = targetNodes.every((n) => n.system!.crashed);
        break;
      case 'CleanTerminal':
        done =
          !fn.crashed &&
          Object.values(fn.files).every(
            (f) => f.deleted || (f.avKey === null && !(f.effects.E_Disabled ?? 0) && f.key !== 'file.antivir')
          );
        break;
      case 'TutorialDelete': {
        const deletedCount = targetNodes.reduce(
          (acc, n) =>
            acc +
            Object.values(n.system!.files).filter((f) => f.isMissionTarget && f.deleted).length,
          0
        );
        done = deletedCount >= mp.n;
        break;
      }
      case 'TutorialBypass':
      case 'Copy':
      case 'CopyMail':
      case 'Passwords':
      case 'CamRec':
      case 'TVTheft':
        done = Object.values(fn.files).some((f) => f.isMissionTarget && (f.effects.E_Copy ?? 0) > 0);
        break;
      case 'FindMails':
        done =
          Object.values(fn.files).filter((f) => f.isMissionTarget && (f.effects.E_Copy ?? 0) > 0)
            .length >= mp.n;
        break;
      case 'Delete':
        done = Object.values(fn.files).some((f) => f.isMissionTarget && f.deleted);
        break;
      case 'Steal':
        done = Object.values(fn.files).some(
          (f) => f.isMissionTarget && (f.effects.E_Copy ?? 0) > 0 && f.deleted
        );
        break;
      case 'DeleteAll':
        done = Object.values(fn.files)
          .filter((f) => !f.isFolder && f.ext === mp.ext)
          .every((f) => f.deleted);
        break;
      case 'Moderate': {
        const mediaFiles = Object.values(fn.files).filter(
          (f) => !f.isFolder && (f.ext === 'mp3' || f.ext === 'video')
        );
        done = !fn.crashed && mediaFiles.length > 0 && mediaFiles.every((f) => f.deleted);
        break;
      }
      case 'CleanCriminal':
        done =
          !fn.crashed &&
          Object.values(fn.files).some((f) => f.isMissionTarget && f.deleted);
        break;
      case 'Spy': {
        const cores = Object.values(fn.files).filter((f) => f.key === 'file.core');
        done =
          !fn.crashed &&
          cores.length > 0 &&
          cores.every((f) => !f.deleted && (f.effects.E_CustomInfected ?? 0) > 0);
        break;
      }
      case 'SpyCam':
        done = targetNodes.every((n) => {
          const cores = Object.values(n.system!.files).filter((f) => f.key === 'file.core');
          return (
            !n.system!.crashed &&
            cores.length > 0 &&
            cores.every((f) => !f.deleted && (f.effects.E_CustomInfected ?? 0) > 0)
          );
        });
        break;
      case 'DeliverFile':
      case 'CompromiseMail':
        done =
          !fn.crashed &&
          Object.values(fn.files).some((f) => f.key === 'uploaded.mission' && !f.deleted);
        break;
      case 'CorruptDisplay': {
        const playlistDir = Object.values(fn.files).find(
          (f) => f.isFolder && f.key.toLowerCase() === '/playlist'
        );
        const activePlaylistFiles = playlistDir
          ? playlistDir.childrenIds
              .map((cid) => fn.files[cid])
              .filter((cf) => cf && !cf.deleted && !cf.isFolder)
          : [];
        done =
          !fn.crashed &&
          activePlaylistFiles.length > 0 &&
          activePlaylistFiles.every((cf) => (cf.effects.E_CustomInfected ?? 0) > 0);
        break;
      }
      case 'Arrest':
        done =
          !fn.crashed &&
          Object.values(fn.files).some((f) => f.key === 'uploaded.mission' && !f.deleted) &&
          Object.values(fn.files)
            .filter((f) => f.ext === 'log')
            .every((f) => f.deleted);
        break;
      case 'FalsifyCam':
      case 'GameHack': {
        const targets = Object.values(fn.files).filter((f) => f.isMissionTarget);
        done =
          !fn.crashed &&
          targets.length > 0 &&
          targets.every((f) => !f.deleted && (f.effects.E_CustomInfected ?? 0) > 0);
        break;
      }
      case 'OverwriteFiles':
      case 'InfectNet': {
        const allTargets = targetNodes.flatMap((n) =>
          Object.values(n.system!.files).filter((f) => f.isMissionTarget)
        );
        done =
          targetNodes.every((n) => !n.system!.crashed) &&
          allTargets.length > 0 &&
          allTargets.every((f) => !f.deleted && (f.effects.E_CustomInfected ?? 0) > 0);
        break;
      }
      case 'GetVirus':
        done = this.missionCpt >= mp.n;
        break;
      case 'TV': {
        const progs = Object.values(fn.files).filter((f) => f.key === 'tvprog.data');
        done =
          !fn.crashed &&
          this.tvCopiedProgram &&
          progs.length > 0 &&
          progs.every((f) => !f.deleted && (f.effects.E_CustomInfected ?? 0) > 0);
        break;
      }
    }

    if (done && !this.missionObjectiveCompleted) {
      this.missionObjectiveCompleted = true;
      this.pushLog('success', formatLang(this.bundle.uiStrings, 'Log_MissionComplete'));
      this.emitSound({ kind: 'sfx', id: 'bonus_02' });
    } else if (!done) {
      this.missionObjectiveCompleted = false;
    }
    return done;
  }

  public finishMission(aborted = false): { ok: boolean; summary: MissionEndSummary } {
    this.ended = true;
    this.cancelCast();
    if (this.connectedNodeId !== null) {
      this.disconnectFromSystem(true);
    }
    const scoutRun = this.hasChipset('scout');
    const success = !aborted && !this.busted && !scoutRun && this.evaluateMissionObjective();
    const remainingSec = this.hasTimer ? Math.floor(this.remainingTimeMs / 1000) : 0;

    const score = success
      ? 1000 * this.init.mission.gl +
        remainingSec * 5 +
        this.kills * 75 +
        this.extractedValuables.length * 50 +
        this.life * 3
      : 0;

    return {
      ok: true,
      summary: {
        missionKey: this.init.missionKey,
        seed: this.init.seed,
        gl: this.init.gl,
        isChallenge: this.init.isChallenge,
        scoutRun,
        success,
        kills: this.kills,
        remainingSec,
        valuables: success ? this.extractedValuables : [],
        copiedFiles: success ? this.copiedFiles : [],
        stolenCards: success ? this.collectedCards : [],
        goals: this.goals,
        score,
      },
    };
  }

  // --- Tutorial Helpers ---
  public get currentTutorialStep(): TutorialStepDef | null {
    return this.tutorialSteps[this.tutorialIndex] ?? null;
  }

  public advanceTutorial(): void {
    if (this.tutorialIndex < this.tutorialSteps.length - 1) {
      this.tutorialIndex++;
    }
  }

  private advanceTutorialIfAt(stepHint: string): void {
    const cur = this.currentTutorialStep;
    if (!cur) return;
    if (cur.id.toLowerCase().includes(stepHint.toLowerCase()) && !cur.auto) {
      this.advanceTutorial();
    }
  }

  // --- Internal utilities ---
  private failAction(error: string): { ok: false; error: string } {
    this.pushLog('warn', error);
    this.emitSound({ kind: 'sfx', id: 'bleep_07' });
    return { ok: false, error };
  }

  private isMoveFurtive(): boolean {
    return (this.userEffects.UE_Furtivity ?? 0) > 0 || (this.userEffects.UE_MoveFurtivity ?? 0) > 0;
  }

  private consumeMoveFurtivity(): void {
    if ((this.userEffects.UE_MoveFurtivity ?? 0) > 0) {
      this.userEffects.UE_MoveFurtivity!--;
      if (this.userEffects.UE_MoveFurtivity! <= 0) delete this.userEffects.UE_MoveFurtivity;
    }
  }

  private folderHasAv(sys: SystemState, folderId: number, avKey: string): boolean {
    const folder = sys.files[folderId];
    if (!folder) return false;
    return folder.childrenIds.some((cid) => {
      const f = sys.files[cid];
      return f && !f.deleted && f.avKey === avKey;
    });
  }

  private folderHasAnyAv(sys: SystemState, folderId: number): boolean {
    const folder = sys.files[folderId];
    if (!folder) return false;
    return folder.childrenIds.some((cid) => {
      const f = sys.files[cid];
      return f && !f.deleted && f.avKey !== null;
    });
  }

  public systemHasAv(sys: SystemState, avKey: string): boolean {
    return Object.values(sys.files).some((f) => !f.deleted && f.avKey === avKey);
  }

  private appendSystemLog(sys: SystemState, langKey: string, targetName: string): void {
    if ((this.userEffects.UE_Furtivity ?? 0) > 0) return;
    const entry = formatLang(this.bundle.uiStrings, langKey, {
      name: targetName,
      id: targetName,
    });
    const mins = Math.floor(this.elapsedMs / 60000);
    const secs = Math.floor((this.elapsedMs % 60000) / 1000);
    const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const line = `\n[${ts}] ${entry}`;
    for (const f of Object.values(sys.files)) {
      if (!f.deleted && f.ext === 'log') {
        f.content += line;
      }
    }
  }
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}
