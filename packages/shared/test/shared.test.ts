import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildGameDataBundle,
  generateMission,
  generateNetwork,
  getAdjustedPrime,
  getGameLevel,
  MissionSession,
  Rand,
  type LangCode,
  type MissionInitParams,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsXmlDir = path.resolve(__dirname, '../../../assets/xml');

function loadBundleFromDisk(lang: LangCode) {
  const read = (file: string) => fs.readFileSync(path.join(assetsXmlDir, file), 'utf8');
  return buildGameDataBundle(lang, {
    virus: read(lang === 'en' ? 'virus.en.xml' : 'virus.xml'),
    antivirus: read(lang === 'en' ? 'antivirus.en.xml' : 'antivirus.xml'),
    chipsets: read(lang === 'en' ? 'chipsets.en.xml' : 'chipsets.xml'),
    valuables: read(lang === 'en' ? 'valuables.en.xml' : 'valuables.xml'),
    langClient: read(`lang.client.${lang}.xml`),
    tutorials: read(`tutorials.${lang}.xml`),
    sysPatterns: read('sysPatterns.xml'),
    texts: read(`texts.${lang}.xml`),
    fsNames: read(`fsNames.${lang}.xml`),
    names: read(`names.${lang}.xml`),
  });
}

function advanceMs(session: MissionSession, totalMs: number): void {
  let rem = totalMs;
  while (rem > 0) {
    const step = Math.min(200, rem);
    session.tick(step);
    rem -= step;
  }
}

describe('@intrusion/shared — PRNG, XML Loaders, Procedural Gen & Simulation Engine', () => {
  it('reproduces deterministic Parker-Miller-Carta LCG sequences', () => {
    const r1 = Rand.fromSeed(123456);
    const r2 = Rand.fromSeed(123456);
    const seq1 = Array.from({ length: 20 }, () => r1.int());
    const seq2 = Array.from({ length: 20 }, () => r2.int());
    expect(seq1).toEqual(seq2);
    expect(seq1.every((x) => Number.isInteger(x) && x >= 0 && x <= 0x3fffffff)).toBe(true);
  });

  it('loads all FR and EN XML & DSL catalogs cleanly', () => {
    const fr = loadBundleFromDisk('fr');
    const en = loadBundleFromDisk('en');

    expect(fr.viruses.size).toBeGreaterThanOrEqual(55);
    expect(en.viruses.size).toBe(fr.viruses.size);
    expect(fr.antiviruses.size).toBe(20); // 19 active AVs + avslot placeholder
    expect(fr.chipsets.size).toBe(13);
    expect(fr.valuables.size).toBe(9);
    expect(fr.tutorials.first.length).toBeGreaterThan(20);
    expect(en.uiStrings.get('OnlyInRoot')).toContain('ROOT');
  });

  it('computes XP progression and retry prime decay accurately', () => {
    expect(getGameLevel(0)).toBe(1);
    expect(getGameLevel(3)).toBe(4);
    expect(getGameLevel(250)).toBe(9);
    expect(getAdjustedPrime(1000, 0)).toBe(1000);
    expect(getAdjustedPrime(1000, 1)).toBe(900);
    expect(getAdjustedPrime(1000, 10)).toBe(0);
  });

  it(
    'generates valid missions & networks across levels 1..9 in both FR and EN',
    { timeout: 25000 },
    () => {
    const fr = loadBundleFromDisk('fr');
    const en = loadBundleFromDisk('en');

    for (const bundle of [fr, en]) {
      for (let gl = 1; gl <= 9; gl++) {
        for (let i = 0; i < 6; i++) {
          const seed = 10000 + gl * 100 + i * 37;
          const m = generateMission(bundle, gl, seed, true);
          expect(m.short.length).toBeGreaterThan(3);
          expect(m.details.length).toBeGreaterThan(5);

          const net = generateNetwork(bundle, m, true);
          const nodeValues = Object.values(net.nodes);
          expect(nodeValues.some((n) => n.type === 'Entrance')).toBe(true);
          expect(nodeValues.some((n) => n.isMissionTarget)).toBe(true);
        }
      }
    }
  });

  it('runs real-time MissionSession simulation: connect, combat, CLI autocomplete & tutorial complete', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 1, 4242, true);
    const init: MissionInitParams = {
      missionKey: 'tuto_1',
      seed: 4242,
      gl: 1,
      mission,
      decks: [
        {
          id: 'd1',
          name: 'Deck Principal',
          capacity: 5,
          isFavorite: true,
          content: ['dmgs', 'dmgxl', 'copy', 'scan1'],
        },
      ],
      chipset: 'turbo',
      isChallenge: false,
      biosLevel: 2,
      tries: 0,
      profile: {
        username: 'Neo',
        level: 4,
        leet: false,
        adult: true,
        cfg: 'alias d = dmgs\nalias s = scan1',
        sfx: true,
        ambiant: true,
        beat: true,
        lang: 'fr',
      },
    };

    const session = new MissionSession(fr, init);
    // Tutorial missions force the canonical 3-virus tutorial deck
    expect(session.decks).toHaveLength(1);
    expect(session.decks[0].content).toEqual(['dmgs', 'copy', 'scan1']);

    const targetNode = Object.values(session.nodes).find((n) => n.isMissionTarget)!;
    expect(targetNode).toBeDefined();

    // Connect to target tutorial node
    const cRes = session.connectToNode(targetNode.id);
    expect(cRes.ok).toBe(true);
    advanceMs(session, 3000);
    expect(session.connectedNodeId).toBe(targetNode.id);

    // Autocomplete CLI alias 'scan' -> 'scan1 '
    const ac = session.autoCompleteCli('scan');
    expect(ac.completed).toBe('scan1 ');

    // Navigate to system folder, destroy guardian first, then destroy core via CLI alias
    const sys = session.currentSystem!;
    const guardian = Object.values(sys.files).find((f) => f.key === 'file.guardian')!;
    const core = Object.values(sys.files).find((f) => f.key === 'file.core')!;
    expect(guardian).toBeDefined();
    expect(core).toBeDefined();
    session.currentFolderId = core.parentId;

    while (!guardian.deleted) {
      const gRes = session.executeCliCommand(`d ${guardian.name}`);
      expect(gRes.ok).toBe(true);
      advanceMs(session, 2000);
    }
    while (!core.deleted) {
      const exec = session.executeCliCommand(`d ${core.name}`);
      expect(exec.ok).toBe(true);
      advanceMs(session, 2000);
    }

    expect(sys.crashed).toBe(true);
    expect(session.connectedNodeId).toBeNull();
    expect(session.evaluateMissionObjective()).toBe(true);

    const end = session.finishMission();
    expect(end.summary.success).toBe(true);
    expect(end.summary.remainingSec).toBe(0);
    expect(end.summary.score).toBeGreaterThan(1000);
  });

  it('triggers all N sysdef antiviruses on file.core destruction and respects furtivity (including dsile2 & last invis stack)', () => {
    const fr = loadBundleFromDisk('fr');
    const baseMission = generateMission(fr, 4, 4242, true);
    const mission = {
      ...baseMission,
      gl: 4,
      type: { kind: 'CrashTerminal' as const, owner: 'Neo' },
    };
    const makeInit = (content: string[] = ['dmgxl', 'invis', 'dsile2']): MissionInitParams => ({
      missionKey: 'm_sysdef',
      seed: 4242,
      gl: 4,
      mission,
      decks: [
        {
          id: 'd1',
          name: 'Deck Principal',
          capacity: 6,
          isFavorite: true,
          content,
        },
      ],
      chipset: 'turbo',
      isChallenge: false,
      biosLevel: 2,
      tries: 0,
      profile: {
        username: 'Neo',
        level: 6,
        leet: false,
        adult: true,
        cfg: '',
        sfx: true,
        ambiant: true,
        beat: true,
        lang: 'fr',
      },
    });

    const clearAndInjectAvs = (sys: NonNullable<MissionSession['currentSystem']>, avKeys: string[]) => {
      for (const f of Object.values(sys.files)) {
        f.avKey = null;
        delete f.effects.E_Shield;
        delete f.effects.E_Immune;
        delete f.effects.E_Masked;
      }
      const candidates = Object.values(sys.files)
        .filter((f) => !f.isFolder && !f.deleted && f.key !== 'file.core' && f.key !== 'file.guardian')
        .slice(0, avKeys.length);
      expect(candidates.length).toBe(avKeys.length);
      avKeys.forEach((k, idx) => {
        candidates[idx].avKey = k;
        candidates[idx].key = 'file.antivir';
      });
    };

    // 1) Without invisibility: 3 sysdef must deal 3 * 15 = 45 damage on guardian AND 45 damage on core
    const session = new MissionSession(fr, makeInit());
    const reachableNode = Object.values(session.nodes).find(
      (n) => n.system !== null && session.canReachNode(n) && !session.isNodeShielded(n)
    )!;
    session.connectToNode(reachableNode.id);
    advanceMs(session, 3000);
    const sys = session.currentSystem!;
    clearAndInjectAvs(sys, ['sysdef', 'sysdef', 'sysdef']);

    const guardian = Object.values(sys.files).find((f) => f.key === 'file.guardian')!;
    const core = Object.values(sys.files).find((f) => f.key === 'file.core')!;
    session.currentFolderId = guardian.parentId;

    const hpBeforeGuardian = session.life;
    guardian.life = 1;
    session.selectFile(guardian.id);
    session.useVirusById('dmgxl', guardian.id);
    advanceMs(session, 3000);
    expect(hpBeforeGuardian - session.life).toBe(45);

    const hpBeforeCore = session.life;
    session.currentFolderId = core.parentId;
    core.life = 1;
    delete core.effects.E_CShield;
    session.selectFile(core.id);
    session.useVirusById('dmgxl', core.id);
    advanceMs(session, 3000);
    expect(sys.crashed).toBe(true);
    expect(hpBeforeCore - session.life).toBe(45);

    // 2) With invisibility active: BOTH 1st stack (killing guardian) AND 2nd/last stack (killing core) dodge sysdef + tique!
    const stealthSession = new MissionSession(fr, makeInit());
    const stealthTarget = Object.values(stealthSession.nodes).find(
      (n) => n.system !== null && stealthSession.canReachNode(n) && !stealthSession.isNodeShielded(n)
    )!;
    stealthSession.connectToNode(stealthTarget.id);
    advanceMs(stealthSession, 3000);
    const stealthSys = stealthSession.currentSystem!;
    clearAndInjectAvs(stealthSys, ['sysdef', 'sysdef', 'tique']);

    const stealthGuardian = Object.values(stealthSys.files).find((f) => f.key === 'file.guardian')!;
    const stealthCore = Object.values(stealthSys.files).find((f) => f.key === 'file.core')!;
    stealthGuardian.life = 1;
    stealthCore.life = 1;
    delete stealthCore.effects.E_CShield;

    stealthSession.currentFolderId = stealthGuardian.parentId;
    stealthSession.useVirusById('invis');
    advanceMs(stealthSession, 3000);
    expect(stealthSession.userEffects.UE_Furtivity).toBe(2);

    const hpStealthBefore = stealthSession.life;
    // Consume 1st invis stack on guardian
    stealthSession.useVirusById('dmgxl', stealthGuardian.id);
    advanceMs(stealthSession, 3000);
    expect(stealthSession.userEffects.UE_Furtivity).toBe(1);
    expect(stealthSession.life).toBe(hpStealthBefore);

    // Consume 2nd (LAST) invis stack on core — must STILL dodge both tique and sysdef!
    stealthSession.currentFolderId = stealthCore.parentId;
    stealthSession.useVirusById('dmgxl', stealthCore.id);
    advanceMs(stealthSession, 3000);
    expect(stealthSys.crashed).toBe(true);
    expect(stealthSession.life).toBe(hpStealthBefore);

    // 3) dsile2 dodges tique + sysdef + repurgator on lethal strike
    const dsileSession = new MissionSession(fr, makeInit());
    const dsileTarget = Object.values(dsileSession.nodes).find(
      (n) => n.system !== null && dsileSession.canReachNode(n) && !dsileSession.isNodeShielded(n)
    )!;
    dsileSession.connectToNode(dsileTarget.id);
    advanceMs(dsileSession, 3000);
    const dsileSys = dsileSession.currentSystem!;
    clearAndInjectAvs(dsileSys, ['sysdef', 'repurgator', 'tique']);
    const dsileGuardian = Object.values(dsileSys.files).find((f) => f.key === 'file.guardian')!;
    dsileGuardian.life = 1;
    dsileSession.currentFolderId = dsileGuardian.parentId;
    const hpBeforeDsile2 = dsileSession.life;
    dsileSession.useVirusById('dsile2', dsileGuardian.id);
    advanceMs(dsileSession, 3000);
    expect(dsileGuardian.deleted).toBe(true);
    expect(dsileSession.life).toBe(hpBeforeDsile2);
    expect(dsileSession.userEffects.UE_Furtivity).toBeUndefined();
  });

  it('enforces multi-deck exemplar charge pools & Challenge mode 1-deck restriction', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 6, 7777, true);
    const baseProfile: MissionInitParams['profile'] = {
      username: 'DeckTester',
      level: 8,
      leet: false,
      adult: true,
      cfg: '',
      sfx: false,
      ambiant: false,
      beat: false,
      lang: 'fr',
    };

    // a) Challenge mode restricts to 1 deck
    const challengeSession = new MissionSession(fr, {
      missionKey: 'chal_1',
      seed: 7777,
      gl: 6,
      mission,
      decks: [
        { id: 'd1', name: 'Deck 1', capacity: 5, isFavorite: true, content: ['dmgs', 'dckswi'] },
        { id: 'd2', name: 'Deck 2', capacity: 5, isFavorite: false, content: ['dmgxl'] },
      ],
      chipset: null,
      isChallenge: true,
      biosLevel: 2,
      tries: 0,
      profile: baseProfile,
    });
    expect(challengeSession.decks).toHaveLength(1);
    expect(challengeSession.switchDeck()).toBe(false);

    // b) Normal mode: 5 owned mana1 in Deck 2 = 5 independent charges; 1 owned pbomb in 2 decks = 1 shared charge
    const normalSession = new MissionSession(fr, {
      missionKey: 'norm_1',
      seed: 7777,
      gl: 6,
      mission,
      ownedViruses: {
        pbomb: 1,
        mana1: 5,
        dcksw2: 1,
        dmgs: 1,
      },
      decks: [
        { id: 'd1', name: 'Deck 1', capacity: 5, isFavorite: true, content: ['pbomb', 'dcksw2', 'dmgs'] },
        {
          id: 'd2',
          name: 'Deck 2',
          capacity: 6,
          isFavorite: false,
          content: ['pbomb', 'mana1', 'mana1', 'mana1', 'mana1', 'mana1'],
        },
      ],
      chipset: null,
      isChallenge: false,
      biosLevel: 4,
      tries: 0,
      profile: baseProfile,
    });

    for (const n of Object.values(normalSession.nodes)) {
      if ((n.type === 'LockServer' || n.type === 'LockServerLight') && n.system) {
        n.system.corrupted = true;
      }
    }
    const nodes = Object.values(normalSession.nodes).filter(
      (n) => n.system !== null && !n.system.corrupted && normalSession.canReachNode(n) && !normalSession.isNodeShielded(n)
    );
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    normalSession.connectToNode(nodes[0].id);
    advanceMs(normalSession, 3000);
    expect(normalSession.connectedNodeId).toBe(nodes[0].id);

    // Use pbomb in Deck 1 -> crashes node & consumes the single shared pbomb charge in BOTH Deck 1 and Deck 2
    const pbRes = normalSession.useVirusById('pbomb');
    expect(pbRes.ok).toBe(true);
    advanceMs(normalSession, 5000);
    expect(nodes[0].system!.crashed).toBe(true);
    expect(normalSession.deckSlots[0].find((s) => s.virus.id === 'pbomb')!.remainingUses).toBe(0);
    expect(normalSession.deckSlots[1].find((s) => s.virus.id === 'pbomb')!.remainingUses).toBe(0);

    // Switch to Deck 2 on network map and connect to another reachable node to use all 5 mana1 charges
    expect(normalSession.switchDeck(1)).toBe(true);
    const nextNode = Object.values(normalSession.nodes).find(
      (n) =>
        n.system !== null &&
        !n.system.crashed &&
        !n.system.corrupted &&
        normalSession.canReachNode(n) &&
        !normalSession.isNodeShielded(n)
    )!;
    normalSession.connectToNode(nextNode.id);
    advanceMs(normalSession, 3000);

    // Trying pbomb in Deck 2 must fail with NoCharge
    const pbFail = normalSession.useVirusById('pbomb');
    expect(pbFail.ok).toBe(false);

    // All 5 mana1 slots in Deck 2 work independently when mana < manaTotal
    for (let i = 0; i < 5; i++) {
      normalSession.mana = 100;
      const mRes = normalSession.useVirusById('mana1');
      expect(mRes.ok).toBe(true);
      advanceMs(normalSession, 2000);
      expect(normalSession.mana).toBe(150);
    }
    normalSession.mana = 100;
    expect(normalSession.useVirusById('mana1').ok).toBe(false);
  });

  it('applies reboo1/reboo2 disconnect damage first and leaves 3 intact E_SkipAction charges on reconnect', () => {
    const fr = loadBundleFromDisk('fr');
    const baseMission = generateMission(fr, 7, 8888, true);
    const mission = {
      ...baseMission,
      gl: 7,
      type: { kind: 'CrashTerminal' as const, owner: 'RebootTarget' },
    };
    const session = new MissionSession(fr, {
      missionKey: 'm_reboot',
      seed: 8888,
      gl: 7,
      mission,
      decks: [{ id: 'd1', name: 'Reboot', capacity: 4, isFavorite: true, content: ['reboo2', 'dmgs'] }],
      chipset: 'mana',
      isChallenge: false,
      biosLevel: 4,
      tries: 0,
      profile: {
        username: 'Neo',
        level: 9,
        leet: false,
        adult: true,
        cfg: '',
        sfx: false,
        ambiant: false,
        beat: false,
        lang: 'fr',
      },
    });

    for (const n of Object.values(session.nodes)) {
      if ((n.type === 'LockServer' || n.type === 'LockServerLight') && n.system) {
        n.system.corrupted = true;
      }
    }
    const node = Object.values(session.nodes).find(
      (n) => n.system !== null && !n.system.corrupted && session.canReachNode(n) && !session.isNodeShielded(n)
    )!;
    session.connectToNode(node.id);
    advanceMs(session, 3000);
    const sys = session.currentSystem!;

    // Clear AVs and place 1 mine + 1 fantassin in root folder, plus 1 oxy in another folder
    for (const f of Object.values(sys.files)) {
      f.avKey = null;
      delete f.effects.E_SkipAction;
      delete f.effects.E_Exploit;
    }
    const plainFiles = Object.values(sys.files).filter(
      (f) => !f.isFolder && !f.deleted && f.key !== 'file.core' && f.key !== 'file.guardian'
    );
    expect(plainFiles.length).toBeGreaterThanOrEqual(3);
    const [mineAv, fantassinAv, oxyAv] = plainFiles;

    for (const rootAv of [mineAv, fantassinAv]) {
      if (rootAv.parentId !== null && sys.files[rootAv.parentId]) {
        sys.files[rootAv.parentId].childrenIds = sys.files[rootAv.parentId].childrenIds.filter(
          (id) => id !== rootAv.id
        );
      }
      rootAv.parentId = sys.rootFolderId;
      if (!sys.files[sys.rootFolderId].childrenIds.includes(rootAv.id)) {
        sys.files[sys.rootFolderId].childrenIds.push(rootAv.id);
      }
    }
    mineAv.avKey = 'mine';
    mineAv.key = 'file.antivir';
    fantassinAv.avKey = 'fantassin';
    fantassinAv.key = 'file.antivir';
    oxyAv.avKey = 'oxy';
    oxyAv.key = 'file.antivir';

    const hpBefore = session.life;
    const res = session.useVirusById('reboo2');
    expect(res.ok).toBe(true);
    advanceMs(session, 3000);

    // Legacy VirusMan._reboo1/_reboo2: stuns AVs BEFORE reboot/disconnect!
    // Player takes 0 damage on reboot; mine & oxy consume 1 stun stack on disconnect (leaving 2), fantassin keeps 3!
    expect(session.connectedNodeId).toBeNull();
    expect(hpBefore - session.life).toBe(0);
    expect(mineAv.effects.E_SkipAction).toBe(2);
    expect(fantassinAv.effects.E_SkipAction).toBe(3);
    expect(oxyAv.effects.E_SkipAction).toBe(2);
    expect(mineAv.effects.E_Exploit).toBe(1);
    expect(fantassinAv.effects.E_Exploit).toBe(1);
    expect(oxyAv.effects.E_Exploit).toBe(1);

    // Reconnect and verify remaining E_SkipAction charges stay intact upon reconnection
    session.connectToNode(node.id);
    advanceMs(session, 3000);
    expect(session.connectedNodeId).toBe(node.id);
    expect(mineAv.effects.E_SkipAction).toBe(2);
    expect(fantassinAv.effects.E_SkipAction).toBe(3);
    expect(oxyAv.effects.E_SkipAction).toBe(2);
  });

  it('blocks unequipped CLI viruses and enforces folder passwords & glue on CLI cd', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 5, 5151, true);
    const session = new MissionSession(fr, {
      missionKey: 'm_cli',
      seed: 5151,
      gl: 5,
      mission,
      decks: [{ id: 'd1', name: 'Basic', capacity: 3, isFavorite: true, content: ['dmgs', 'scan1'] }],
      chipset: null,
      isChallenge: false,
      biosLevel: 3,
      tries: 0,
      profile: {
        username: 'Hacker',
        level: 5,
        leet: true,
        adult: true,
        cfg: 'alias up = cd ..\nalias d = dmgs',
        sfx: false,
        ambiant: false,
        beat: false,
        lang: 'fr',
      },
    });

    for (const n of Object.values(session.nodes)) {
      if ((n.type === 'LockServer' || n.type === 'LockServerLight') && n.system) {
        n.system.corrupted = true;
      }
    }
    const node = Object.values(session.nodes).find(
      (n) => n.system !== null && !n.system.corrupted && session.canReachNode(n) && !session.isNodeShielded(n)
    )!;
    session.connectToNode(node.id);
    advanceMs(session, 3000);
    const sys = session.currentSystem!;

    // Clear existing AVs so glue/mine don't interfere before our assertions
    for (const f of Object.values(sys.files)) {
      f.avKey = null;
    }

    // Dock click blocked in Leet mode
    expect(session.useDockSlot(0).ok).toBe(false);

    // Unequipped viruses (e.g. pbomb, invis, dmgxl) blocked via CLI!
    expect(session.executeCliCommand('pbomb').ok).toBe(false);
    expect(session.executeCliCommand('invis').ok).toBe(false);
    expect(session.executeCliCommand('dmgxl').ok).toBe(false);

    // Find a subfolder in root that contains at least one file and lock it with a password
    const subFolder = sys.files[sys.rootFolderId].childrenIds
      .map((id) => sys.files[id])
      .find(
        (f) =>
          f &&
          f.isFolder &&
          f.childrenIds.some((cid) => {
            const ch = sys.files[cid];
            return ch && !ch.isFolder && ch.key !== 'file.core';
          })
      )!;
    expect(subFolder).toBeDefined();
    subFolder.password = 'secret123';

    // CLI `cd <subFolder>` must trigger password prompt instead of bypassing into folder
    const cdLocked = session.executeCliCommand(`cd ${subFolder.name}`);
    expect(cdLocked.ok).toBe(true);
    advanceMs(session, 1000);
    expect(session.currentFolderId).toBe(sys.rootFolderId);
    expect(session.pendingPasswordFolderId).toBe(subFolder.id);

    // Submitting password unlocks subfolder and stays in root until `cd <subFolder>` is run (matching legacy validatePass)
    expect(session.submitFolderPassword('wrong')).toBe(false);
    expect(session.submitFolderPassword('secret123')).toBe(true);
    expect(session.currentFolderId).toBe(sys.rootFolderId);
    expect(session.executeCliCommand(`cd ${subFolder.name}`).ok).toBe(true);
    advanceMs(session, 1000);
    expect(session.currentFolderId).toBe(subFolder.id);

    // Place a glue AV inside subFolder -> `up` (`cd ..`) must be blocked by glue!
    const anyFileInSub = subFolder.childrenIds
      .map((id) => sys.files[id])
      .find((f) => f && !f.isFolder && f.key !== 'file.core');
    expect(anyFileInSub).toBeDefined();
    anyFileInSub!.avKey = 'glue';
    expect(session.executeCliCommand('up').ok).toBe(false);
    expect(session.currentFolderId).toBe(subFolder.id);
  });

  it('generates and completes Moderate and FalsifyCam missions properly', () => {
    const fr = loadBundleFromDisk('fr');

    // 1) Moderate mission: spawns mp3/video files under userDir and requires deleting all of them
    const modMission = {
      ...generateMission(fr, 7, 9001, true),
      gl: 7,
      type: { kind: 'Moderate' as const, owner: 'BobMorane' },
    };
    const modSession = new MissionSession(fr, {
      missionKey: 'm_mod',
      seed: 9001,
      gl: 7,
      mission: modMission,
      decks: [{ id: 'd1', name: 'Mod', capacity: 3, isFavorite: true, content: ['dmgxl'] }],
      chipset: null,
      isChallenge: false,
      biosLevel: 4,
      tries: 0,
      profile: {
        username: 'Mod',
        level: 8,
        leet: false,
        adult: true,
        cfg: '',
        sfx: false,
        ambiant: false,
        beat: false,
        lang: 'fr',
      },
    });
    const modTarget = Object.values(modSession.nodes).find((n) => n.isMissionTarget)!;
    const modSys = modTarget.system!;
    const mediaFiles = Object.values(modSys.files).filter(
      (f) => !f.isFolder && (f.ext === 'mp3' || f.ext === 'video')
    );
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1);
    expect(mediaFiles.every((f) => f.content.length > 0 && f.embed !== null)).toBe(true);
    expect(modSession.evaluateMissionObjective()).toBe(false);
    for (const mf of mediaFiles) mf.deleted = true;
    expect(modSession.evaluateMissionObjective()).toBe(true);

    // 2) FalsifyCam mission: folder-wide cust ('_none') infects all videos in folder & fails if deleted
    const camMission = {
      ...generateMission(fr, 9, 9002, true),
      gl: 9,
      type: { kind: 'FalsifyCam' as const, sector: 'archives 1' },
    };
    const camSession = new MissionSession(fr, {
      missionKey: 'm_cam',
      seed: 9002,
      gl: 9,
      mission: camMission,
      decks: [{ id: 'd1', name: 'Cam', capacity: 3, isFavorite: true, content: ['dmgs'] }],
      chipset: 'smana',
      isChallenge: false,
      biosLevel: 4,
      tries: 0,
      profile: {
        username: 'CamOp',
        level: 9,
        leet: false,
        adult: true,
        cfg: '',
        sfx: false,
        ambiant: false,
        beat: false,
        lang: 'fr',
      },
    });
    // Force path reachable and strip AVs/locks so we can test folder-wide cust execution cleanly
    for (const n of Object.values(camSession.nodes)) {
      if (!n.isMissionTarget && n.system) n.system.corrupted = true;
    }
    const camTarget = Object.values(camSession.nodes).find((n) => n.isMissionTarget)!;
    const camSys = camTarget.system!;
    for (const f of Object.values(camSys.files)) {
      f.avKey = null;
      f.password = null;
      delete f.effects.E_Masked;
      delete f.effects.E_Encoded;
    }

    expect(camSession.connectToNode(camTarget.id).ok).toBe(true);
    advanceMs(camSession, 3000);

    // Running cust in root (0 video files) fails with NeedInFolder
    expect(camSession.useVirusById('cust').ok).toBe(false);

    // Run cust once inside each folder that contains target .video files
    const videoFolders = new Set(
      Object.values(camSys.files)
        .filter((f) => f.isMissionTarget && f.ext === 'video' && f.parentId !== null)
        .map((f) => f.parentId!)
    );
    expect(videoFolders.size).toBeGreaterThanOrEqual(1);
    for (const fid of videoFolders) {
      camSession.currentFolderId = fid;
      camSession.mana = camSession.manaTotal;
      const res = camSession.useVirusById('cust');
      expect(res.ok).toBe(true);
      advanceMs(camSession, 5000);
    }
    expect(camSession.evaluateMissionObjective()).toBe(true);

    // Deleting one of the falsified videos invalidates the objective
    const oneVid = Object.values(camSys.files).find((f) => f.isMissionTarget && f.ext === 'video')!;
    oneVid.deleted = true;
    expect(camSession.evaluateMissionObjective()).toBe(false);
  });

  it('triggers eject only when damaging while inside the eject folder, not remotely via E_Tag', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 7, 4242, false);
    const session = new MissionSession(fr, {
      missionKey: 'eject_tag_test',
      seed: 4242,
      gl: 7,
      mission,
      decks: [
        {
          id: 'd1',
          name: 'Deck 1',
          capacity: 8,
          isFavorite: true,
          content: ['tag1', 'tag1', 'dmgs', 'dmgs'],
        },
      ],
      chipset: null,
      isChallenge: false,
      biosLevel: 2,
      tries: 0,
      profile: {
        username: 'EjectTester',
        level: 8,
        leet: false,
        adult: true,
        cfg: '',
        sfx: false,
        ambiant: false,
        beat: false,
        lang: 'fr',
      },
    });

    const targetNode = Object.values(session.nodes).find(
      (n) => n.system !== null && session.canReachNode(n) && !session.isNodeShielded(n)
    )!;
    expect(session.connectToNode(targetNode.id).ok).toBe(true);
    advanceMs(session, 3000);

    const sys = session.currentSystem!;
    // Strip existing AVs/locks/masks
    for (const f of Object.values(sys.files)) {
      f.avKey = null;
      f.password = null;
      delete f.effects.E_Masked;
      delete f.effects.E_Encoded;
      delete f.effects.E_Immune;
      delete f.effects.E_Shield;
      delete f.effects.E_CShield;
    }

    // Find two distinct folders, each with at least one non-folder file
    const foldersWithFiles = Object.values(sys.files).filter(
      (f) =>
        f.isFolder &&
        f.childrenIds.some((cid) => {
          const ch = sys.files[cid];
          return ch && !ch.isFolder && !ch.deleted;
        })
    );
    expect(foldersWithFiles.length).toBeGreaterThanOrEqual(2);

    const safeFolder = foldersWithFiles[0];
    const ejectFolder = foldersWithFiles[1];

    const safeFile = sys.files[safeFolder.childrenIds.find((cid) => !sys.files[cid].isFolder)!]!;
    const ejectFiles = ejectFolder.childrenIds
      .map((cid) => sys.files[cid]!)
      .filter((ch) => ch && !ch.isFolder);

    // Put an eject AV in ejectFolder and a linked target file (different file if available, or eject itself with high HP)
    const ejectAv = ejectFiles[0];
    ejectAv.avKey = 'eject';
    ejectAv.life = 20;
    ejectAv.lifeTotal = 20;

    safeFile.life = 20;
    safeFile.lifeTotal = 20;

    // Link both files with tag1 (50% spread)
    session.currentFolderId = safeFolder.id;
    expect(session.useVirusById('tag1', safeFile.id).ok).toBe(true);
    advanceMs(session, 2000);

    session.currentFolderId = ejectFolder.id;
    expect(session.useVirusById('tag1', ejectAv.id).ok).toBe(true);
    advanceMs(session, 2000);

    // Move back to safeFolder (no eject) and hit safeFile -> ejectAv takes linked damage, player is NOT ejected
    session.currentFolderId = safeFolder.id;
    const ejectHpBefore = ejectAv.life;
    expect(session.useVirusById('dmgs', safeFile.id).ok).toBe(true);
    advanceMs(session, 2000);

    expect(ejectAv.life).toBeLessThan(ejectHpBefore);
    expect(session.connectedNodeId).toBe(targetNode.id);

    // Now move into ejectFolder and hit ejectAv directly -> player IS ejected
    session.currentFolderId = ejectFolder.id;
    expect(session.useVirusById('dmgs', ejectAv.id).ok).toBe(true);
    advanceMs(session, 2000);

    expect(session.connectedNodeId).toBeNull();
  });

  it('aligns combat, stealth, Uber-Eleet perks, reboot, bomb, route files & control deletion with legacy', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 8, 9191, true);

    const makeSession = (leet: boolean, chipset: string | null = null, deckContent: string[] = []) =>
      new MissionSession(fr, {
        missionKey: 'align_test',
        seed: 9191,
        gl: 8,
        mission,
        decks: [
          {
            id: 'd1',
            name: 'Main',
            capacity: 9,
            isFavorite: true,
            content: deckContent,
          },
        ],
        chipset,
        isChallenge: false,
        biosLevel: 3,
        tries: 0,
        profile: {
          username: 'LegacyAligned',
          level: 9,
          leet,
          adult: true,
          cfg: '',
          sfx: false,
          ambiant: false,
          beat: false,
          lang: 'fr',
        },
      });

    // 1. A1.1 (masked blind damage), A1.3 (fmove1=2, fmove2=6), A1.4 & A1.5 (Normal vs Uber-Eleet perks), A1.8 (cd .. at root)
    const norm = makeSession(false, null, ['dmgs', 'avdmg1', 'fmove1', 'fmove2', 'invis', 'reboo2']);
    const firstNode = Object.values(norm.nodes).find(
      (n) => n.system !== null && norm.canReachNode(n) && !norm.isNodeShielded(n)
    )!;
    norm.connectToNode(firstNode.id);
    advanceMs(norm, 2000);
    const sys = norm.currentSystem!;

    // Clear all AVs/passwords first
    for (const f of Object.values(sys.files)) {
      f.avKey = null;
      f.password = null;
      delete f.effects.E_Masked;
      delete f.effects.E_Encoded;
      delete f.effects.E_Immune;
      delete f.effects.E_Shield;
    }

    // A1.8: cd .. at root returns InvalidTarget and stays connected
    expect(norm.executeCliCommand('cd ..').ok).toBe(false);
    expect(norm.connectedNodeId).toBe(firstNode.id);

    // A1.1: Blind-attacking an E_Masked AV with dmgs works, while avdmg1 is blocked with UnknownType; CLI finds masked file by real name
    const rootChildren = sys.files[sys.rootFolderId].childrenIds.map((id) => sys.files[id]);
    const subFolders = rootChildren.filter((f) => f.isFolder);
    const childFolder = subFolders[0];
    const grandChildFolder = Object.values(sys.files).find(
      (f) => f.isFolder && f.parentId !== null && f.parentId !== sys.rootFolderId
    );

    const anyFileInChild = childFolder.childrenIds
      .map((id) => sys.files[id])
      .find((f) => !f.isFolder)!;
    anyFileInChild.avKey = 'mask';
    anyFileInChild.life = 15;
    anyFileInChild.lifeTotal = 15;
    anyFileInChild.effects.E_Masked = 1;

    norm.currentFolderId = childFolder.id;
    expect(norm.useVirusById('avdmg1', anyFileInChild.id).ok).toBe(false);
    expect(norm.executeCliCommand(`dmgs ${anyFileInChild.name}`).ok).toBe(true);
    advanceMs(norm, 1000);
    expect(anyFileInChild.life).toBeLessThan(15);
    anyFileInChild.avKey = null;
    delete anyFileInChild.effects.E_Masked;

    // A1.3: fmove1 dodges 2 moves against oxy, 3rd move takes damage
    const oxyHost = childFolder.childrenIds
      .map((id) => sys.files[id])
      .find((f) => !f.isFolder)!;
    oxyHost.avKey = 'oxy';
    oxyHost.life = 15;
    oxyHost.lifeTotal = 15;

    norm.currentFolderId = sys.rootFolderId;
    expect(norm.useVirusById('fmove1').ok).toBe(true);
    advanceMs(norm, 1000);
    const hpBeforeMoves = norm.life;

    // Move 1 (root -> child): dodged, 1 stack left
    expect(norm.openFolder(childFolder.id).ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.life).toBe(hpBeforeMoves);
    expect(norm.userEffects.UE_MoveFurtivity).toBe(1);

    // Move 2 (child -> root): dodged, 0 stacks left!
    expect(norm.openFolder(sys.rootFolderId).ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.life).toBe(hpBeforeMoves);
    expect(norm.userEffects.UE_MoveFurtivity).toBeUndefined();

    // Move 3 (root -> child): takes oxy damage!
    expect(norm.openFolder(childFolder.id).ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.life).toBeLessThan(hpBeforeMoves);

    // A1.4 & A1.5 in Normal mode: invis IS consumed on cd, and non-adjacent folder jump is rejected
    expect(norm.useVirusById('invis').ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.userEffects.UE_Furtivity).toBe(2);
    expect(norm.openFolder(sys.rootFolderId).ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.userEffects.UE_Furtivity).toBe(1);

    if (grandChildFolder) {
      expect(norm.openFolder(grandChildFolder.id).ok).toBe(false);
    }

    // A1.2: reboo2 stuns oxy BEFORE disconnect (0 damage on reboot, leaving 2 stun stacks on oxy + E_Exploit=1)
    const hpBeforeReboot = norm.life;
    norm.mana = norm.manaTotal;
    delete norm.userEffects.UE_Furtivity;
    expect(norm.useVirusById('reboo2').ok).toBe(true);
    advanceMs(norm, 1000);
    expect(norm.connectedNodeId).toBeNull();
    expect(norm.life).toBe(hpBeforeReboot);
    expect(oxyHost.effects.E_SkipAction).toBe(2);
    expect(oxyHost.effects.E_Exploit).toBe(1);

    // 2. A1.4 & A1.5 in Uber-Eleet mode: invis NOT consumed on cd, and non-adjacent folder jump IS allowed!
    const leet = makeSession(true, null, ['invis']);
    leet.connectToNode(firstNode.id);
    advanceMs(leet, 2000);
    const leetSys = leet.currentSystem!;
    for (const f of Object.values(leetSys.files)) {
      f.avKey = null;
      f.password = null;
    }
    expect(leet.useVirusById('invis').ok).toBe(true);
    advanceMs(leet, 500);
    expect(leet.userEffects.UE_Furtivity).toBe(2);

    const leetDeepFolder = Object.values(leetSys.files).find(
      (f) => f.isFolder && f.parentId !== null && f.parentId !== leetSys.rootFolderId
    );
    if (leetDeepFolder) {
      expect(leet.openFolder(leetDeepFolder.id).ok).toBe(true);
      advanceMs(leet, 500);
      expect(leet.currentFolderId).toBe(leetDeepFolder.id);
      // Still 2 stacks of UE_Furtivity in Uber-Eleet mode!
      expect(leet.userEffects.UE_Furtivity).toBe(2);
      // Multi-hop CLI cd / back to root in Uber-Eleet mode!
      expect(leet.executeCliCommand('cd /').ok).toBe(true);
      advanceMs(leet, 500);
      expect(leet.currentFolderId).toBe(leetSys.rootFolderId);
      expect(leet.userEffects.UE_Furtivity).toBe(2);
    }

    // 3. A1.6 (libxpl kills eject before eject triggers), A1.7 (bomb stun resets counter), B.4 (bomb 15 HP), C.4 (deleted control blocks corrup)
    const comb = makeSession(false, 'brute', ['libxpl', 'dmgxl', 'stun1', 'corrup', 'corru2', 'reveng']);
    comb.connectToNode(firstNode.id);
    advanceMs(comb, 2000);
    const cSys = comb.currentSystem!;
    for (const f of Object.values(cSys.files)) {
      f.avKey = null;
      f.password = null;
      delete f.effects.E_Masked;
      delete f.effects.E_Encoded;
      delete f.effects.E_Immune;
      delete f.effects.E_Shield;
    }

    // Find folder with >= 2 non-folder files
    const multiFileFolder = Object.values(cSys.files).find(
      (f) => f.isFolder && f.childrenIds.filter((id) => !cSys.files[id].isFolder).length >= 2
    )!;
    const mFiles = multiFileFolder.childrenIds
      .map((id) => cSys.files[id])
      .filter((x) => !x.isFolder);
    const libFile = mFiles[0];
    libFile.ext = 'lib';
    libFile.life = 1;
    libFile.lifeTotal = 1;

    const ejFile = mFiles[1];
    ejFile.avKey = 'eject';
    ejFile.life = 15;
    ejFile.lifeTotal = 15;

    comb.currentFolderId = multiFileFolder.id;
    expect(comb.useVirusById('libxpl', libFile.id).ok).toBe(true);
    advanceMs(comb, 1000);
    // dmgxl (30) * brute (1.5) = 45 -> splash 50% = 22 -> * brute (1.5) = 33 >= 15 -> kills eject BEFORE eject runs!
    expect(comb.useVirusById('dmgxl', libFile.id).ok).toBe(true);
    advanceMs(comb, 1000);
    expect(ejFile.deleted).toBe(true);
    expect(comb.connectedNodeId).toBe(firstNode.id);

    // A1.7 & B.8: stunned bomb at 10/10 blocks explosion & resets counter to 0; E_Revenge with brute deals 23 even on lethal hit
    const bombFile = Object.values(cSys.files).find(
      (f) => !f.isFolder && !f.deleted && f.key !== 'file.core'
    )!;
    bombFile.avKey = 'bomb';
    bombFile.life = 25;
    bombFile.lifeTotal = 25;
    bombFile.effects.E_Counter = 10;
    expect(comb.useVirusById('stun1', bombFile.id).ok).toBe(true);
    advanceMs(comb, 1000);
    // Casting stun1 incremented counter to 11 -> blocked by stun1 -> counter reset to 0!
    expect(bombFile.effects.E_Counter).toBeUndefined();

    // Lethal bomb hit triggers E_Revenge with brute (round(15 * 1.5) = 23 dmg)!
    expect(comb.useVirusById('reveng', bombFile.id).ok).toBe(true);
    advanceMs(comb, 1000);
    delete bombFile.effects.E_SkipAction;
    bombFile.effects.E_Counter = 10;
    comb.life = 5;
    comb.mana = comb.manaTotal;
    // Cast a harmless virus to trigger bomb explosion (10 -> 11)
    expect(comb.useVirusById('corru2', bombFile.id).ok).toBe(false); // precondition fails, doesn't cast
    const controlFiles = Object.values(cSys.files).filter((f) => f.key === 'file.control');
    if (controlFiles.length >= 1) {
      // Delete one control file (or create a second deleted control file) to test C.4 too!
      const ctrl = controlFiles[0];
      const extraDeletedCtrl = Object.values(cSys.files).find(
        (f) => !f.isFolder && f.id !== ctrl.id && f.id !== bombFile.id && f.key !== 'file.core'
      )!;
      extraDeletedCtrl.key = 'file.control';
      extraDeletedCtrl.deleted = true;

      expect(comb.useVirusById('corrup', ctrl.id).ok).toBe(true);
      advanceMs(comb, 1000);
      // C.4: deleted file.control prevents corruptSystem!
      expect(cSys.corrupted).toBe(false);
      // B.8 & B.3: player died to bomb, AND E_Revenge STILL hit bombFile for 23 damage (25 -> 2)!
      expect(comb.life).toBe(0);
      expect(bombFile.life).toBe(2);
    }

    // 4. A2.12 (CorruptDisplay place varies across seeds) & A2.14 (TVTheft .data suffix)
    const places = new Set<string>();
    let checkedTvTheft = false;
    for (let s = 100; s < 250; s++) {
      const m = generateMission(fr, 7, s, true);
      if (m.type.kind === 'CorruptDisplay') places.add(m.type.place);
      if (m.type.kind === 'TVTheft') {
        expect(m.type.program.toLowerCase().endsWith('.data')).toBe(true);
        checkedTvTheft = true;
      }
    }
    expect(places.size).toBeGreaterThan(1);
    expect(checkedTvTheft).toBe(true);
  });

  it('enforces authentic cast speeds across BIOS v1..v4, Overclock & Slower nodes, keeping instant casts exclusive to Uber-Eleet', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = {
      ...generateMission(fr, 6, 4040, true),
      gl: 6,
      type: { kind: 'CrashTerminal' as const, owner: 'SpeedCheck' },
    };

    const createSpeedSession = (biosLevel: number, leet: boolean, chipset: string | null = null) =>
      new MissionSession(fr, {
        missionKey: `speed_${biosLevel}_${leet}`,
        seed: 4040,
        gl: 6,
        mission,
        decks: [
          {
            id: 'd1',
            name: 'SpeedDeck',
            capacity: 8,
            isFavorite: true,
            content: ['dmgs', 'dmgl', 'extrac', 'pbomb', 'scan1'],
          },
        ],
        chipset,
        isChallenge: false,
        biosLevel,
        tries: 0,
        profile: {
          username: 'Chronos',
          level: 8,
          leet,
          adult: true,
          cfg: '',
          sfx: false,
          ambiant: false,
          beat: false,
          lang: 'fr',
        },
      });

    // 1. BIOS v1 (starter) = exact 1.0x Motion-Twin 2011 speeds
    const s1 = createSpeedSession(1, false);
    expect(s1.getSpeed()).toBeCloseTo(1.0, 5);
    const node1 = Object.values(s1.nodes).find(
      (n) => n.system !== null && n.system.speed === 1 && s1.canReachNode(n) && !s1.isNodeShielded(n)
    )!;
    expect(s1.connectToNode(node1.id).ok).toBe(true);
    expect(s1.activeCast?.durationMs).toBe(2000); // connec = 2.0s at 1.0x
    advanceMs(s1, 2000);
    expect(s1.connectedNodeId).toBe(node1.id);

    const sys1 = s1.currentSystem!;
    for (const f of Object.values(sys1.files)) {
      f.avKey = null;
      f.password = null;
    }
    const sub1 = sys1.files[sys1.rootFolderId].childrenIds
      .map((id) => sys1.files[id])
      .find((f) => f.isFolder && f.childrenIds.some((cid) => !sys1.files[cid].isFolder))!;
    expect(s1.openFolder(sub1.id).ok).toBe(true);
    expect(s1.activeCast?.durationMs).toBe(600); // child cd = 0.6s at 1.0x
    advanceMs(s1, 600);
    expect(s1.currentFolderId).toBe(sub1.id);

    expect(s1.openFolder(sys1.rootFolderId).ok).toBe(true);
    expect(s1.activeCast?.durationMs).toBe(300); // parent cd .. = 0.3s at 1.0x
    advanceMs(s1, 300);

    s1.currentFolderId = sub1.id;
    const doc1 = sub1.childrenIds
      .map((id) => sys1.files[id])
      .find((f) => !f.isFolder && f.key !== 'file.core')!;
    doc1.size = 1;
    doc1.life = 20;
    expect(s1.useVirusById('dmgs', doc1.id).ok).toBe(true);
    expect(s1.activeCast?.durationMs).toBe(200); // dmgs = 0.2s at 1.0x (NOT instant)
    advanceMs(s1, 200);

    // 2. Normal mode at MAX speed (BIOS v4 + Overclock = speed 2.0 => 4x) STILL never executes viruses or cd instantaneously!
    const sMax = createSpeedSession(4, false, 'turbo');
    expect(sMax.getSpeed()).toBeCloseTo(2.0, 5);
    const nodeMax = sMax.nodes[node1.id];
    expect(sMax.connectToNode(nodeMax.id).ok).toBe(true);
    expect(sMax.activeCast?.durationMs).toBe(500); // connec = 2.0 / 4 = 0.5s
    advanceMs(sMax, 500);
    const sysMax = sMax.currentSystem!;
    for (const f of Object.values(sysMax.files)) {
      f.avKey = null;
      f.password = null;
    }
    const subMax = sysMax.files[sub1.id];
    expect(sMax.openFolder(subMax.id).ok).toBe(true);
    expect(sMax.activeCast).not.toBeNull();
    expect(sMax.activeCast!.durationMs).toBeGreaterThanOrEqual(150); // cd still shows progress bar
    advanceMs(sMax, 200);

    const docMax = sysMax.files[doc1.id];
    docMax.size = 1;
    docMax.life = 20;
    expect(sMax.useVirusById('dmgs', docMax.id).ok).toBe(true);
    expect(sMax.activeCast).not.toBeNull();
    expect(sMax.activeCast!.durationMs).toBe(150); // clamped >= 150ms, never 0ms instant in normal mode!
    advanceMs(sMax, 200);

    // 3. Uber-Eleet mode (even at BIOS v1, speed = 1.0): CLI viruses and cd ARE instantaneous (0ms), while connec still casts!
    const sLeet = createSpeedSession(1, true);
    const nodeLeet = sLeet.nodes[node1.id];
    expect(sLeet.connectToNode(nodeLeet.id).ok).toBe(true);
    expect(sLeet.activeCast?.durationMs).toBe(2000); // connec is never instant
    advanceMs(sLeet, 2000);
    const sysLeet = sLeet.currentSystem!;
    for (const f of Object.values(sysLeet.files)) {
      f.avKey = null;
      f.password = null;
      delete f.effects.E_Shield;
      delete f.effects.E_Immune;
      delete f.effects.E_CShield;
    }
    const subLeet = sysLeet.files[sub1.id];
    expect(sLeet.executeCliCommand(`cd ${subLeet.name}`).ok).toBe(true);
    expect(sLeet.activeCast).toBeNull(); // 0ms instant in Uber-Eleet!
    expect(sLeet.currentFolderId).toBe(subLeet.id);

    const docLeet = sysLeet.files[doc1.id];
    docLeet.life = 10;
    docLeet.lifeTotal = 10;
    expect(sLeet.executeCliCommand(`dmgs ${docLeet.name}`).ok).toBe(true);
    expect(sLeet.activeCast).toBeNull(); // 0ms instant in Uber-Eleet!
    expect(docLeet.life).toBeLessThan(10);

    // On a Slower ('Frein', speed = 0.4) server at BIOS v1, even Uber-Eleet gets a slight 250ms delay
    sysLeet.speed = 0.4;
    expect(sLeet.executeCliCommand(`dmgs ${docLeet.name}`).ok).toBe(true);
    expect(sLeet.activeCast?.durationMs).toBe(250);
  });
});
