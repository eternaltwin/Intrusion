import { Rand } from '../rng/Rand.js';
import type { GameDataBundle } from '../data/xmlLoaders.js';
import type { MissionData, MissionPattern, StolenCard, TutorialTrackId } from '../types/game.js';

export const XP_LEVELS = [0, 1, 2, 3, 10, 30, 90, 150, 250] as const;

export const TRIES_REDUC = [
  0.90, 0.85, 0.80, 0.75, 0.70,
  0.65, 0.60, 0.56, 0.53, 0.50,
] as const;

export const CORP_COLORS = [
  '#14341F',
  '#132335',
  '#261B34',
  '#371606',
  '#2F380C',
  '#2E0C17',
] as const;

export const ADD_DECK_COST = [0, 2500, 4500, 9500] as const;
export const ADD_SLOT_COST = [0, 0, 0, 2500, 4500, 8000, 14000, 24500, 75000] as const;

export function getMissionRefreshCost(level: number): number {
  return level <= 4 ? 2000 : 2000 + (level - 4) * 250;
}

export function getGameLevel(xp: number): number {
  let gl = 0;
  for (const lxp of XP_LEVELS) {
    if (xp >= lxp) gl++;
  }
  return Math.max(1, gl);
}

export function getXpForLevel(gl: number): number {
  if (gl <= 0) return 0;
  if (gl > XP_LEVELS.length) return 9999;
  return XP_LEVELS[gl - 1];
}

export function getPrimeByLevel(gl: number, rseed?: Rand): { total: number; prime: number; bonus: number } {
  let total = Math.floor(400 + Math.pow(gl, 1.45) * 400);
  if (rseed) {
    total = Math.round(0.7 * total + (rseed.random(30) / 100) * total);
  }
  return {
    total,
    prime: Math.floor((total * 0.6) / 10) * 10,
    bonus: Math.floor(total * 0.4),
  };
}

export function getAdjustedPrime(basePrime: number, tries: number): number {
  if (tries <= 0) return basePrime;
  if (tries >= TRIES_REDUC.length) return 0;
  return Math.ceil(basePrime * TRIES_REDUC[tries - 1]);
}

export function isTutorialMission(m: MissionData): boolean {
  return m.gl <= 3;
}

export function hasMissionTimer(m: MissionData): boolean {
  return !isTutorialMission(m);
}

export function getTutorialTrack(m: MissionData): TutorialTrackId | null {
  switch (m.type.kind) {
    case 'Tutorial':
      return 'first';
    case 'TutorialDelete':
      return 'second';
    case 'TutorialBypass':
      return 'third';
    default:
      return null;
  }
}

export function getMissionTimeMs(m: MissionData, leetMode: boolean): number {
  const MIN = 60 * 1000;
  const SEC = 1000;
  let t =
    999 +
    (m.type.kind === 'TutorialDelete'
      ? 24 * 60 * MIN
      : (2 + m.gl * 0.5) * MIN);

  if (m.gl === 4) t += 10 * MIN;
  if (m.gl === 5) t += 1 * MIN;
  if (leetMode) t += 40 * SEC;
  return t;
}

export function getMissionDifficultyLabel(missionLevel: number, playerLevel: number): 'easy' | 'medium' | 'hard' {
  if (missionLevel === playerLevel) return 'medium';
  return missionLevel < playerLevel ? 'easy' : 'hard';
}

function drawOne<T>(rseed: Rand, list: readonly T[]): T {
  return list[rseed.random(list.length)];
}

function patternTextKey(p: MissionPattern): string {
  switch (p.kind) {
    case 'Moderate': return 'MModerate';
    case 'Delete': return 'MDelete';
    case 'DeleteAll': return 'MDeleteAll';
    case 'Copy': return 'MCopy';
    case 'Steal': return 'MSteal';
    case 'CrashDB': return 'MCrashDB';
    case 'DeliverFile': return 'MDeliverFile';
    case 'CrashPrinter': return 'MCrashPrinter';
    case 'CrashTerminal': return 'MCrashTerminal';
    case 'CleanTerminal': return 'MCleanTerminal';
    case 'CopyMail': return 'MCopyMail';
    case 'FindMails': return 'MFindMails';
    case 'Passwords': return 'MPasswords';
    case 'CleanSecurity': return 'MCleanSecurity';
    case 'CamRec': return 'MCamRec';
    case 'CleanCriminal': return 'MCleanCriminal';
    case 'Spy': return 'MSpy';
    case 'CompromiseMail': return 'MCompromiseMail';
    case 'FalsifyCam': return 'MFalsifyCam';
    case 'SpyCam': return 'MSpyCam';
    case 'Arrest': return 'MArrest';
    case 'CorruptDisplay': return 'MCorruptDisplay';
    case 'OverwriteFiles': return 'MOverwriteFiles';
    case 'GameHack': return 'MGameHack';
    case 'InfectNet': return 'MInfectNet';
    case 'GetVirus': return 'MGetVirus';
    case 'Tutorial': return 'MTutorial';
    case 'TutorialDelete': return 'MTutorialDelete';
    case 'TutorialBypass': return 'MTutorialBypass';
    case 'TV': return 'MTV';
    case 'TVCrash': return 'MTVCrash';
    case 'TVTheft': return 'MTVTheft';
  }
}

export function generateMission(bundle: GameDataBundle, glevel: number, seed: number, adult = true): MissionData {
  const { texts, fsNames, names } = bundle.createTextEngines(0, adult);
  const rseed = Rand.fromSeed(seed);

  const list: MissionPattern[] = [];
  if (glevel === 1) {
    list.push({ kind: 'Tutorial' });
  }
  if (glevel === 2) {
    list.push({ kind: 'TutorialDelete', ext: 'mail', n: 5 });
  }
  if (glevel === 3) {
    list.push({ kind: 'TutorialBypass', f: fsNames.get('tutorial_doc', rseed) });
  }
  if (glevel >= 4 && glevel < 5) {
    list.push({
      kind: 'Delete',
      owner: names.get('musername', rseed),
      fname: fsNames.get('mission_doc', rseed),
    });
  }
  if (glevel >= 4 && glevel < 6) {
    list.push(
      { kind: 'CleanTerminal', owner: names.get('musername', rseed) },
      { kind: 'Copy', owner: names.get('musername', rseed), fname: fsNames.get('mission_doc', rseed) },
      { kind: 'Steal', owner: names.get('musername', rseed), fname: fsNames.get('mission_doc', rseed) }
    );
  }
  if (glevel >= 4 && glevel < 7) {
    list.push({
      kind: 'CopyMail',
      owner: names.get('musername', rseed),
      sender: names.get('musername', rseed),
    });
  }
  if (glevel >= 5) {
    const parentKey = drawOne(rseed, ['/doc', '/mail'] as const);
    list.push(
      { kind: 'Spy', name: names.get('musername', rseed) },
      {
        kind: 'DeliverFile',
        parentKey,
        parentName: fsNames.get(parentKey),
        file: fsNames.get('secret.doc', rseed),
        to: names.get('musername', rseed),
      }
    );
  }
  if (glevel >= 5 && glevel < 7) {
    list.push(
      {
        kind: 'GetVirus',
        v: names.get('virusname', rseed),
        ext: drawOne(rseed, ['lib', 'prog'] as const),
        n: rseed.random(5) + 5,
      },
      { kind: 'CrashPrinter', name: fsNames.get('/sys_printer', rseed) },
      { kind: 'CrashTerminal', owner: names.get('musername', rseed) }
    );
  }
  if (glevel >= 6) {
    list.push(
      { kind: 'CorruptDisplay', place: texts.get('place').toLowerCase() },
      { kind: 'Passwords', name: fsNames.get('/sys_db', rseed) },
      { kind: 'DeleteAll', owner: names.get('musername', rseed), ext: 'mail' }
    );
  }
  if (glevel >= 6 && glevel < 9) {
    list.push(
      { kind: 'DeleteAll', owner: names.get('musername', rseed), ext: 'doc' },
      { kind: 'Moderate', owner: names.get('musername', rseed) },
      { kind: 'OverwriteFiles', owner: names.get('musername', rseed), ext: 'doc' },
      { kind: 'OverwriteFiles', owner: names.get('musername', rseed), ext: 'mail' }
    );
  }
  if (glevel >= 7) {
    list.push(
      { kind: 'FindMails', owner: names.get('musername', rseed), n: rseed.random(3) + 2 },
      { kind: 'CompromiseMail', owner: names.get('musername', rseed) },
      { kind: 'TV', tvFrom: names.get('hotTv', rseed), tvTo: names.get('badTv', rseed) },
      { kind: 'TVTheft', tv: names.get('tv', rseed), program: names.get('tvProgTheft', rseed) },
      { kind: 'TVTheft', tv: names.get('hotTv', rseed), program: names.get('hotProgTheft', rseed) },
      { kind: 'TVCrash', tv: names.get('tv', rseed) },
      { kind: 'CrashDB', fname: fsNames.get('/sys_db', rseed) }
    );
  }
  if (glevel >= 8) {
    list.push(
      { kind: 'SpyCam' },
      { kind: 'CleanSecurity' },
      { kind: 'CamRec', fname: fsNames.get('archive.video', rseed) },
      {
        kind: 'GameHack',
        game: names.get('gameName', rseed),
        serv: names.get('gameServer', rseed),
        char: names.get('gameChar', rseed),
      }
    );
  }
  if (glevel >= 9) {
    list.push(
      { kind: 'CleanCriminal', name: names.get('musername', rseed) },
      { kind: 'FalsifyCam', sector: fsNames.get('roomMission', rseed) },
      { kind: 'Arrest', name: names.get('musername', rseed) }
    );
  }

  const mtype = list[rseed.random(list.length)];
  const mprime = getPrimeByLevel(glevel, rseed);

  if (mtype.kind === 'Tutorial') {
    mprime.prime = 500;
    mprime.bonus = 0;
  } else if (mtype.kind === 'TutorialDelete') {
    mprime.prime = 700;
    mprime.bonus = 0;
  } else if (mtype.kind === 'TutorialBypass') {
    mprime.prime = 800;
    mprime.bonus = 0;
  }

  const colorHex = CORP_COLORS[rseed.random(CORP_COLORS.length)];
  const color = parseInt(colorHex.slice(1), 16);
  const corp = names.get('corp', rseed);

  const m: MissionData = {
    seed,
    corp,
    color,
    colorHex,
    short: '',
    details: '',
    prime: mprime.prime,
    bonus: mprime.bonus,
    type: mtype,
    xp: 1,
    gl: glevel,
    cards: [],
  };

  texts.resetVars();
  const p = m.type;
  switch (p.kind) {
    case 'Moderate':
      texts.set('owner', p.owner, true);
      break;
    case 'Delete':
    case 'Copy':
    case 'Steal':
      texts.set('owner', p.owner, true);
      texts.set('file', p.fname);
      break;
    case 'DeleteAll':
      texts.set('owner', p.owner, true);
      texts.set('ext', p.ext);
      break;
    case 'CrashPrinter':
      texts.set('target', p.name);
      break;
    case 'CrashTerminal':
    case 'CleanTerminal':
    case 'FindMails':
      texts.set('owner', p.owner, true);
      break;
    case 'CrashDB':
      texts.set('target', p.fname);
      break;
    case 'CopyMail':
      texts.set('owner', p.owner, true);
      texts.set('sender', p.sender, true);
      break;
    case 'Passwords':
      texts.set('target', p.name);
      break;
    case 'CamRec':
      texts.set('file', p.fname);
      break;
    case 'CleanCriminal':
    case 'Spy':
      texts.set('name', p.name, true);
      break;
    case 'CompromiseMail':
      texts.set('name', p.owner, true);
      break;
    case 'FalsifyCam':
      texts.set('sector', p.sector, true);
      break;
    case 'Arrest':
      texts.set('name', p.name);
      break;
    case 'CorruptDisplay':
      texts.set('place', p.place);
      break;
    case 'DeliverFile':
      texts.set('folder', p.parentName);
      texts.set('file', p.file);
      texts.set('name', p.to);
      break;
    case 'OverwriteFiles':
      texts.set('name', p.owner);
      texts.set('ext', p.ext.toUpperCase());
      break;
    case 'GameHack':
      texts.set('game', p.game);
      texts.set('server', p.serv);
      texts.set('char', p.char);
      break;
    case 'InfectNet':
      texts.set('vname', p.v);
      break;
    case 'GetVirus':
      texts.set('vname', p.v);
      texts.set('ext', p.ext.toUpperCase());
      break;
    case 'TutorialDelete':
      texts.set('ext', p.ext.toUpperCase());
      texts.set('n', String(p.n));
      break;
    case 'TutorialBypass':
      texts.set('file', p.f);
      break;
    case 'TV':
      texts.set('tvFrom', p.tvFrom);
      texts.set('tvTo', p.tvTo);
      break;
    case 'TVTheft':
      texts.set('tv', p.tv);
      texts.set('program', p.program);
      break;
    case 'TVCrash':
      texts.set('tv', p.tv);
      break;
    default:
      break;
  }
  texts.set('corp', m.corp);

  const tkey = patternTextKey(m.type);
  m.short = texts.get(tkey);
  const details = texts.get(`${tkey}_details`);
  if (m.type.kind === 'TutorialDelete') {
    m.details = details;
  } else {
    texts.set('briefing', details);
    m.details = isTutorialMission(m) ? texts.get('briefing') : texts.get('missionDetails');
  }

  // Restored Stolen Credit Cards feature (uses isolated sub-RNG so original rseed stays untouched)
  if (!isTutorialMission(m)) {
    const cardRng = Rand.fromSeed(seed ^ 0x5a3c19);
    if (cardRng.random(100) < 35 + glevel * 4) {
      const count = cardRng.random(2) + 1;
      for (let i = 0; i < count; i++) {
        const holder = names.get('musername', cardRng).replace(/_/g, ' ');
        const blocks = [0, 1, 2, 3].map(() => String(1000 + cardRng.random(9000))).join('-');
        const amount = (cardRng.random(12) + 3) * 25 * Math.max(1, glevel - 2);
        m.cards.push({
          id: `cc_${seed}_${i}`,
          holder,
          number: blocks,
          amount,
        });
      }
    }
  }

  return m;
}
