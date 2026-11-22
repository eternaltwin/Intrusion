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
        cfg: 'alias d = dmgxl\nalias s = scan1',
        sfx: true,
        ambiant: true,
        beat: true,
        lang: 'fr',
      },
    };

    const session = new MissionSession(fr, init);
    const targetNode = Object.values(session.nodes).find((n) => n.isMissionTarget)!;
    expect(targetNode).toBeDefined();

    // Connect to target tutorial node
    const cRes = session.connectToNode(targetNode.id);
    expect(cRes.ok).toBe(true);
    session.tick(3000);
    expect(session.connectedNodeId).toBe(targetNode.id);

    // Autocomplete CLI alias 's' -> 's '
    const ac = session.autoCompleteCli('scan');
    expect(ac.completed).toBe('scan1 ');

    // Find core file anywhere in system, navigate to its folder, and destroy it via CLI alias
    const sys = session.currentSystem!;
    const core = Object.values(sys.files).find((f) => f.key === 'file.core')!;
    expect(core).toBeDefined();
    session.currentFolderId = core.parentId;
    session.selectFile(core.id);

    const exec = session.executeCliCommand(`d ${core.name}`);
    expect(exec.ok).toBe(true);
    session.tick(3000);

    expect(sys.crashed).toBe(true);
    expect(session.connectedNodeId).toBeNull();
    expect(session.evaluateMissionObjective()).toBe(true);

    const end = session.finishMission();
    expect(end.summary.success).toBe(true);
    expect(end.summary.score).toBeGreaterThan(1000);
  });

  it('triggers all N sysdef antiviruses on file.core destruction and respects furtivity', () => {
    const fr = loadBundleFromDisk('fr');
    const mission = generateMission(fr, 1, 4242, true);
    const makeInit = (): MissionInitParams => ({
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
          content: ['dmgxl', 'invis'],
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

    // 1) Without invisibility: 3 sysdef must deal 3 * 15 = 45 damage on guardian AND 45 damage on core
    const session = new MissionSession(fr, makeInit());
    const targetNode = Object.values(session.nodes).find((n) => n.isMissionTarget)!;
    session.connectToNode(targetNode.id);
    session.tick(3000);
    const sys = session.currentSystem!;

    // Inject 3 sysdef AV files into the system
    const docs = Object.values(sys.files).filter((f) => !f.isFolder && f.key === 'file.doc').slice(0, 3);
    expect(docs.length).toBe(3);
    for (const d of docs) {
      d.avKey = 'sysdef';
      d.key = 'file.antivir';
    }

    const guardian = Object.values(sys.files).find((f) => f.key === 'file.guardian')!;
    const core = Object.values(sys.files).find((f) => f.key === 'file.core')!;
    session.currentFolderId = guardian.parentId;

    const hpBeforeGuardian = session.life;
    guardian.life = 1;
    session.selectFile(guardian.id);
    session.useVirusById('dmgxl', guardian.id);
    session.tick(3000);
    expect(hpBeforeGuardian - session.life).toBe(45);

    const hpBeforeCore = session.life;
    core.life = 1;
    delete core.effects.E_CShield;
    session.selectFile(core.id);
    session.useVirusById('dmgxl', core.id);
    session.tick(3000);
    expect(sys.crashed).toBe(true);
    expect(hpBeforeCore - session.life).toBe(45);

    // 2) With invisibility active: 3 sysdef must deal 0 damage when destroying file.core
    const stealthSession = new MissionSession(fr, makeInit());
    const stealthTarget = Object.values(stealthSession.nodes).find((n) => n.isMissionTarget)!;
    stealthSession.connectToNode(stealthTarget.id);
    stealthSession.tick(3000);
    const stealthSys = stealthSession.currentSystem!;
    for (const d of Object.values(stealthSys.files).filter((f) => !f.isFolder && f.key === 'file.doc').slice(0, 3)) {
      d.avKey = 'sysdef';
      d.key = 'file.antivir';
    }
    const stealthCore = Object.values(stealthSys.files).find((f) => f.key === 'file.core')!;
    stealthCore.life = 1;
    delete stealthCore.effects.E_CShield;
    stealthSession.currentFolderId = stealthCore.parentId;
    stealthSession.useVirusById('invis');
    stealthSession.tick(3000);
    const hpStealthBefore = stealthSession.life;
    stealthSession.selectFile(stealthCore.id);
    stealthSession.useVirusById('dmgxl', stealthCore.id);
    stealthSession.tick(3000);
    expect(stealthSys.crashed).toBe(true);
    expect(stealthSession.life).toBe(hpStealthBefore);
  });
});
