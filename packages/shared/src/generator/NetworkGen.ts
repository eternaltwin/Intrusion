import { Rand, shuffleWithSeed, spreadValues } from '../rng/Rand.js';
import { PatternLoader } from '../data/PatternLoader.js';
import { formatLang, type GameDataBundle } from '../data/xmlLoaders.js';
import { buildMissionCards, isTutorialMission } from './MissionGen.js';
import type {
  AntivirusDef,
  FileEffectType,
  FileNodeState,
  MissionData,
  NetNodeState,
  NodeType,
  StolenCard,
  SystemState,
} from '../types/game.js';

export const AV_LIFE = 15;
export const CORE_LIFE = 30;
export const GUARDIAN_LIFE = 10;
export const SHIELD_ABSORB = 4;
export const CSHIELD_ABSORB = 5;
export const BOMB_LIMIT = 10;

export function getGameDiff(gl: number): number {
  switch (gl) {
    case 1:
    case 2:
    case 3:
      return 10;
    case 4:
      return 20;
    case 5:
      return 30;
    case 6:
      return 40;
    case 7:
      return 55;
    case 8:
      return 70;
    case 9:
      return 90;
    default:
      return gl * gl;
  }
}

function getPatternForNodeType(nt: NodeType, gl: number, rseed: Rand): string | null {
  switch (nt) {
    case 'Terminal': {
      const minLevel = 4;
      const sub = gl <= minLevel ? 1 : rseed.random(Math.min(gl - minLevel + 1, 5)) + 1;
      return `/sys_terminal_${sub}`;
    }
    case 'TerminalMul':
      return '/sys_multi_users';
    case 'Printer':
      return '/sys_printer';
    case 'Gateway':
      return '/sys_gate';
    case 'Slower':
      return '/sys_slower';
    case 'Database':
      return '/sys_db';
    case 'Keypad':
      return '/sys_keypad';
    case 'Camera':
      return '/sys_camera';
    case 'CrimeDatabase':
      return '/sys_crime_db';
    case 'LockServer':
      return '/sys_lock';
    case 'LockServerLight':
      return '/sys_lock_light';
    case 'Alarm':
      return '/sys_alarm';
    case 'BigDisplay':
      return '/sys_display';
    case 'GameServer':
      return '/sys_game';
    case 'Ftp':
      return '/sys_ftp';
    case 'Tv':
      return '/sys_tv';
    case 'TutoTerm':
      return '/sys_tuto';
    case 'TutoFirewall':
      return '/sys_tuto_firewall';
    case 'Treasure':
      return '/sys_treasure';
    default:
      return null;
  }
}

function extractExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function computeFileSize(isFolder: boolean, key: string, ext: string): number {
  if (isFolder) return 2;
  if (ext === 'video') return 5;
  if (ext === 'mp3') return 2;
  if (ext === 'pack') return 3;
  if (key === 'file.guardian') return 1;
  if (key === 'file.core') return 2;
  if (key === 'file.control') return 1;
  return 1;
}

function divideInBills(total: number, piles: number, rawBills: number[]): number[] {
  if (piles <= 0 || rawBills.length === 0) return [];
  const bills = [...rawBills].sort((a, b) => a - b);
  let rem = Math.floor(total / bills[0]) * bills[0];
  let list: number[] = [];
  let i = bills.length - 1;
  while (i >= 0 && rem > 0) {
    if (bills[i] <= rem) {
      rem -= bills[i];
      list.push(bills[i]);
    } else {
      i--;
    }
  }
  list.sort((a, b) => a - b);
  if (piles > list.length && list.length > 0) {
    const highest = list[list.length - 1];
    const smaller = bills.filter((b) => b < highest);
    if (smaller.length > 0) {
      const broken = divideInBills(highest, piles - list.length + 1, smaller);
      if (broken.length > 0) {
        list.pop();
        list = broken.concat(list).sort((a, b) => a - b);
      }
    }
  }
  return list;
}

interface InternalFile extends FileNodeState {
  sortIndex: number;
  seed: number;
  owner: string;
}

interface InternalNode {
  id: number;
  ip: string;
  type: NodeType;
  x: number;
  y: number;
  links: number[];
  users: string[];
  dist: number;
  path: number[];
  siblingId: number | null;
  isTarget: boolean;
  system: SystemState | null;
}

const PROTECTED_FILE_KEYS = new Set<string>([
  'pass.mail',
  'file.pass',
  'global.pass',
  'file.core',
  'file.guardian',
  'file.control',
  'file.pack',
  'file.log',
  'file.route',
  'antivir.index',
]);

function isProtectedFile(f: FileNodeState): boolean {
  return (
    f.isFolder ||
    f.avKey !== null ||
    PROTECTED_FILE_KEYS.has(f.key) ||
    f.ext === 'pack' ||
    f.ext === 'log'
  );
}

export interface GeneratedNetwork {
  seed: number;
  entranceId: number;
  nodes: Record<number, NetNodeState>;
  extraMissionCount: number;
}

export function generateNetwork(
  bundle: GameDataBundle,
  mdata: MissionData,
  adult = true,
  hackerName = 'Haxxor',
  cardNumbers?: string[]
): GeneratedNetwork {
  const wid = 11;
  const gl = mdata.gl;
  const baseDiff = getGameDiff(gl);
  const { texts, fsNames, names, patterns } = bundle.createTextEngines(mdata.seed, adult);
  names.set('corp', mdata.corp);
  texts.set('corp', mdata.corp);
  texts.set('hacker', hackerName);
  texts.set('file', fsNames.get('file.lib'));
  const baseIp = texts.get('baseIp');

  let workSeed = mdata.seed;
  let tries = 0;

  while (tries <= 200) {
    try {
      let rseed = Rand.fromSeed(workSeed);
      let useful =
        gl === 1 ? 1 : gl === 2 ? 3 : gl === 3 ? 3 : gl === 4 ? 4 : gl === 5 ? 5 : gl === 6 ? 6 : gl === 7 ? 7 : gl === 8 ? 7 : 8 + (gl - 8);
      if (gl >= 3) useful += rseed.random(2);
      if (gl >= 8) useful += rseed.random(2);
      let genEmpty = rseed.random(100) < 66 ? rseed.random(5) : rseed.random(8) + 4;

      if (mdata.type.kind === 'Tutorial') {
        useful = 1;
        genEmpty = 1;
      } else if (mdata.type.kind === 'TutorialDelete') {
        useful = 3;
        genEmpty = 2;
      } else if (mdata.type.kind === 'TutorialBypass') {
        useful = 1;
        genEmpty = 2;
      }

      rseed = Rand.fromSeed(workSeed);
      const grid: (InternalNode | null)[][] = Array.from({ length: wid }, () => Array(wid).fill(null));
      const nodeList: InternalNode[] = [];
      let uniq = 0;

      const generateNodeRec = (x: number, y: number, remain: number, dist = 0): number => {
        const node: InternalNode = {
          id: uniq,
          ip: baseIp + uniq,
          type: uniq === 0 ? 'Entrance' : 'Terminal',
          x,
          y,
          links: [],
          users: [],
          dist: -1,
          path: [],
          siblingId: null,
          isTarget: false,
          system: null,
        };
        uniq++;
        if (node.type === 'Terminal') {
          if (dist < 5 && genEmpty > 0 && rseed.random(100) < 80) {
            node.type = 'Empty';
            genEmpty--;
          } else {
            remain--;
          }
        }
        grid[x][y] = node;
        nodeList.push(node);

        while (remain > 0) {
          const candidates: { x: number; y: number }[] = [];
          if (y > 0 && grid[x][y - 1] === null) candidates.push({ x, y: y - 1 });
          if (y < wid - 1 && grid[x][y + 1] === null) candidates.push({ x, y: y + 1 });
          if (x > 0 && grid[x - 1][y] === null) candidates.push({ x: x - 1, y });
          if (x < wid - 1 && grid[x + 1][y] === null) candidates.push({ x: x + 1, y });
          if (candidates.length === 0) break;

          const next = candidates[rseed.random(candidates.length)];
          let branch = Math.round((rseed.random(100) / 100) * remain);
          if (branch > 0) {
            if (node.type === 'Entrance' || candidates.length === 1) branch = remain;
            remain -= branch;
            const notAdded = generateNodeRec(next.x, next.y, branch, dist + 1);
            if (notAdded !== branch && grid[next.x][next.y]) {
              node.links.push(grid[next.x][next.y]!.id);
            }
            if (notAdded > 0 && node.type === 'Entrance') return 1;
            remain += notAdded;
          }
        }
        return remain;
      };

      const startX = Math.floor(wid * 0.5);
      const startY = Math.floor(wid * 0.5);
      const leftOver = generateNodeRec(startX, startY, useful, 0);
      if (leftOver > 0) throw new Error('tree failed');

      const byId = new Map<number, InternalNode>(nodeList.map((n) => [n.id, n]));
      for (const n of nodeList) {
        for (const lid of n.links) {
          const peer = byId.get(lid)!;
          if (!peer.links.includes(n.id)) peer.links.push(n.id);
        }
      }

      const entrance = nodeList.find((n) => n.type === 'Entrance')!;

      const computeDist = () => {
        for (const n of nodeList) n.dist = -1;
        const rec = (node: InternalNode, dist: number) => {
          if (node.dist !== -1) return;
          node.dist = dist;
          const step = node.type === 'Empty' ? 0 : node.type === 'Gateway' ? 4 : node.type === 'Slower' ? 2 : 1;
          for (const lid of node.links) {
            rec(byId.get(lid)!, dist + step);
          }
        };
        rec(entrance, 0);
      };

      const getNonEmptyNeighbours = (node: InternalNode): InternalNode[] => {
        const visited = new Set<number>([node.id]);
        const out: InternalNode[] = [];
        const walk = (cur: InternalNode) => {
          for (const lid of cur.links) {
            if (visited.has(lid)) continue;
            visited.add(lid);
            const peer = byId.get(lid)!;
            if (peer.type === 'Empty') walk(peer);
            else out.push(peer);
          }
        };
        walk(node);
        return out;
      };

      const isNeighbour = (a: InternalNode, b: InternalNode) =>
        getNonEmptyNeighbours(a).some((x) => x.id === b.id);

      const countType = (t: NodeType) => nodeList.filter((n) => n.type === t).length;

      // Gateways
      let gw = gl <= 4 ? 0 : gl === 5 ? 1 : gl === 6 ? 1 + rseed.random(2) : gl === 7 ? 2 : 3;
      if (mdata.type.kind === 'TutorialBypass') gw = 1;
      if (gw > 0) {
        const emptyPool = nodeList.filter((n) => n.type === 'Empty');
        if (gw > emptyPool.length) throw new Error('no room for gateways');
        for (let i = 0; i < gw; i++) {
          const idx = rseed.random(emptyPool.length);
          emptyPool[idx].type = 'Gateway';
          emptyPool.splice(idx, 1);
        }
      }
      computeDist();

      const addReactiveNodes = (nt: NodeType, count: number, minNeighbours = 2) => {
        if (count <= 0) return;
        const pool = nodeList.filter((n) => n.type === 'Terminal');
        if (count > pool.length) throw new Error('no room for reactive nodes');
        let c = count;
        while (c > 0 && pool.length > 0) {
          const node = pool.splice(rseed.random(pool.length), 1)[0];
          const neig = nodeList.filter(
            (n) => n.dist === node.dist && n.type !== 'Empty' && n.id !== node.id && isNeighbour(n, node)
          );
          if (neig.length >= minNeighbours) {
            node.type = nt;
            for (const n2 of neig) {
              const idx = pool.findIndex((p) => p.id === n2.id);
              if (idx >= 0) pool.splice(idx, 1);
            }
            c--;
          }
        }
        if (c > 0) throw new Error('addReactiveNodes failed');
      };

      const transformNodes = (
        nCount: number,
        from: NodeType,
        to: NodeType,
        minDist = 0,
        maxDist = 999,
        minLinks = 1,
        maxLinks = 999
      ): InternalNode[] => {
        const candidates = nodeList.filter(
          (n) =>
            n.type === from &&
            n.dist >= minDist &&
            n.dist <= maxDist &&
            n.links.length >= minLinks &&
            n.links.length <= maxLinks
        );
        if (candidates.length < nCount) throw new Error('transform failed');
        const changed: InternalNode[] = [];
        for (let i = 0; i < nCount; i++) {
          const idx = rseed.random(candidates.length);
          candidates[idx].type = to;
          changed.push(candidates[idx]);
          candidates.splice(idx, 1);
        }
        return changed;
      };

      // Locks
      if (gl >= 5 && countType('Terminal') >= 3 && rseed.random(100) < 60) {
        if (gl >= 7 && rseed.random(100) < 75) addReactiveNodes('LockServer', 1, 2);
        else addReactiveNodes('LockServerLight', 1, 2);
      }
      computeDist();

      // Alarms
      if (gl >= 5 && countType('Terminal') >= 3) {
        const na = gl === 5 ? rseed.random(2) : gl === 6 ? 1 : gl <= 8 ? rseed.random(2) + 1 : rseed.random(2) + 2;
        addReactiveNodes('Alarm', na, 1);
      }
      computeDist();

      // Treasure
      if (gl >= 7 && countType('Terminal') >= 2 && rseed.random(100) < 60) {
        transformNodes(1, 'Terminal', 'Treasure', 0, 5);
      }
      computeDist();

      // Printer & Database
      if (!isTutorialMission(mdata)) {
        if (countType('Terminal') >= 3 && rseed.random(100) < 50) {
          transformNodes(1, 'Terminal', 'Printer', 0, 999, 1, 1);
        }
        if (countType('Terminal') >= 3 && rseed.random(100) < 50) {
          transformNodes(1, 'Terminal', 'Database', 0, 999, 1, 1);
        }
      }
      computeDist();

      // Hard target node
      const getHardNode = (nt: NodeType, minDist: number): InternalNode | null => {
        for (let d = minDist; d >= 0; d--) {
          const pool = nodeList.filter((n) => n.type === nt && n.dist >= d);
          if (pool.length > 0) return pool[rseed.random(pool.length)];
        }
        return null;
      };

      const tn = getHardNode('Terminal', 3);
      if (!tn) throw new Error('no target node');
      tn.type = 'TargetEmpty';
      if (tn.dist <= 1 && gl >= 5) throw new Error('too easy');
      if (tn.dist > 5 && gl <= 5) throw new Error('too hard');
      if (tn.dist > 2 && gl === 4) throw new Error('too hard gl4');
      if (mdata.type.kind === 'TutorialDelete' && nodeList.some((n) => n.dist > 1)) {
        throw new Error('too hard for tutorial');
      }

      // Dispatch users
      rseed = Rand.fromSeed(workSeed);
      const nonEmptyCount = nodeList.filter((n) => n.type !== 'Empty' && n.type !== 'Entrance').length;
      const userPoolSet = new Set<string>();
      const rawUsers: string[] = [];
      let safety = 0;
      while (rawUsers.length < Math.max(5, nonEmptyCount * 4) && safety++ < 2000) {
        const u = names.get('username', rseed);
        if (!userPoolSet.has(u)) {
          userPoolSet.add(u);
          rawUsers.push(u);
        }
      }
      const userPool = shuffleWithSeed(workSeed, rawUsers);
      for (const n of nodeList) {
        if (n.type === 'Terminal' && userPool.length > 0) {
          n.users = [userPool.shift()!];
        }
      }

      // Create mission node(s)
      rseed = Rand.fromSeed(workSeed);
      const targetNode = nodeList.find((n) => n.type === 'TargetEmpty')!;
      targetNode.isTarget = true;
      const mp = mdata.type;
      switch (mp.kind) {
        case 'Moderate':
          targetNode.type = 'TerminalMul';
          break;
        case 'Delete':
        case 'DeleteAll':
        case 'Copy':
        case 'Steal':
        case 'CrashTerminal':
        case 'CleanTerminal':
        case 'CopyMail':
        case 'FindMails':
        case 'CompromiseMail':
        case 'OverwriteFiles':
          targetNode.type = 'Terminal';
          targetNode.users[0] = mp.owner;
          if (mp.kind === 'OverwriteFiles') {
            for (const p of nodeList.filter((x) => x.type === 'Printer')) p.isTarget = true;
          }
          break;
        case 'Spy':
          targetNode.type = 'Terminal';
          targetNode.users[0] = mp.name;
          break;
        case 'DeliverFile':
          targetNode.type = 'Terminal';
          targetNode.users[0] = mp.to;
          break;
        case 'CrashPrinter':
          targetNode.type = 'Printer';
          break;
        case 'CrashDB':
        case 'Passwords':
          targetNode.type = 'Database';
          break;
        case 'CleanSecurity': {
          const sDevices: NodeType[] = ['Camera', 'Keypad'];
          const n = Math.min(countType('Terminal'), rseed.random(2) + 1);
          for (let i = 0; i < n; i++) {
            const dev = sDevices[rseed.random(sDevices.length)];
            const changed = transformNodes(1, 'Terminal', dev);
            for (const cn of changed) cn.isTarget = true;
          }
          targetNode.type = sDevices[rseed.random(sDevices.length)];
          break;
        }
        case 'CamRec': {
          const n = Math.min(countType('Terminal'), rseed.random(3) + 1);
          const cams = n > 0 ? transformNodes(n, 'Terminal', 'Camera') : [];
          targetNode.type = 'Camera';
          cams.push(targetNode);
          for (const c of cams) c.isTarget = false;
          cams[rseed.random(cams.length)].isTarget = true;
          break;
        }
        case 'CleanCriminal':
        case 'Arrest':
          targetNode.type = 'CrimeDatabase';
          break;
        case 'FalsifyCam':
          targetNode.type = 'Camera';
          break;
        case 'SpyCam': {
          const n = Math.min(countType('Terminal'), rseed.random(2) + 1);
          for (let i = 0; i < n; i++) {
            const changed = transformNodes(1, 'Terminal', 'Camera');
            for (const c of changed) c.isTarget = true;
          }
          targetNode.type = 'Camera';
          break;
        }
        case 'CorruptDisplay':
          targetNode.type = 'BigDisplay';
          break;
        case 'GameHack':
          for (const t of nodeList.filter((x) => x.type === 'Terminal')) t.type = 'GameServer';
          targetNode.type = 'GameServer';
          break;
        case 'InfectNet':
          for (const t of nodeList.filter((x) => x.type === 'Terminal')) t.isTarget = true;
          targetNode.type = 'Terminal';
          targetNode.users[0] = names.get('username', rseed);
          break;
        case 'GetVirus': {
          targetNode.type = 'Terminal';
          targetNode.users[0] = names.get('username', rseed);
          targetNode.isTarget = false;
          const terms = nodeList.filter((x) => x.type === 'Terminal');
          terms[rseed.random(terms.length)].isTarget = true;
          break;
        }
        case 'Tutorial':
          targetNode.type = 'TutoTerm';
          targetNode.isTarget = true;
          break;
        case 'TutorialDelete':
          for (const t of nodeList.filter((x) => x.type === 'Terminal')) t.isTarget = true;
          targetNode.type = 'Terminal';
          targetNode.users[0] = names.get('username', rseed);
          break;
        case 'TutorialBypass': {
          const fw = nodeList.find((x) => x.type === 'Gateway');
          if (fw) fw.type = 'TutoFirewall';
          targetNode.type = 'TutoTerm';
          targetNode.isTarget = true;
          break;
        }
        case 'TV':
        case 'TVTheft':
        case 'TVCrash': {
          targetNode.type = 'Tv';
          const terms = nodeList.filter((x) => x.type === 'Terminal');
          let max = Math.min(3, terms.length);
          while (max > 0) {
            const picked = terms.splice(rseed.random(terms.length), 1)[0];
            picked.type = 'Tv';
            max--;
          }
          break;
        }
      }

      // Compute tree paths from Entrance
      const computePaths = (cur: InternalNode, acc: number[]) => {
        const nextPath = [...acc, cur.id];
        cur.path = nextPath;
        for (const lid of cur.links) {
          const peer = byId.get(lid)!;
          if (peer.path.length === 0) computePaths(peer, nextPath);
        }
      };
      computePaths(entrance, []);

      // Generate Filesystem for every connectable node
      for (const n of nodeList) {
        n.system = generateSystemForNode(bundle, patterns, mdata, n, workSeed + n.id, baseDiff, adult, hackerName);
      }

      // LockServerLight sibling assignment
      for (const lock of nodeList.filter((n) => n.type === 'LockServerLight')) {
        const candidates = nodeList.filter(
          (n) =>
            n.id !== lock.id &&
            n.type !== 'Empty' &&
            n.type !== 'Entrance' &&
            n.type !== 'LockServer' &&
            n.type !== 'LockServerLight' &&
            n.dist === lock.dist &&
            isNeighbour(n, lock)
        );
        if (candidates.length > 0) {
          lock.siblingId = candidates[rseed.random(candidates.length)].id;
        }
      }

      // Update mission systems
      let extraMissionCount = 0;
      rseed = Rand.fromSeed(workSeed);
      const targetNodes = nodeList.filter((n) => n.isTarget && n.system !== null);
      const fn = targetNodes[0];
      if (fn && fn.system) {
        extraMissionCount = applyMissionSystemCustomizations(
          bundle,
          patterns,
          mdata,
          nodeList,
          targetNodes,
          fn,
          rseed,
          adult,
          hackerName
        );
      }

      // Fill .route files (lists all downstream non-Empty nodes behind n, matching GNetwork.getNeighbours)
      for (const n of nodeList) {
        if (!n.system) continue;
        const routeFiles = Object.values(n.system.files).filter((f) => f.key === 'file.route');
        if (routeFiles.length === 0) continue;
        const neigs = nodeList.filter(
          (peer) =>
            peer.type !== 'Empty' &&
            peer.type !== 'Entrance' &&
            peer.id !== n.id &&
            peer.path.includes(n.id)
        );
        const sysEngines = bundle.createTextEngines(workSeed + n.id, adult);
        if (neigs.length === 0) {
          const noRoute = sysEngines.texts.get('noRoute');
          for (const rf of routeFiles) rf.content = noRoute;
        } else {
          const entries = neigs.map((peer) => {
            sysEngines.texts.set('ip', peer.ip);
            sysEngines.texts.set('sysName', peer.system?.name ?? peer.ip);
            return sysEngines.texts.get('routeEntry');
          });
          sysEngines.texts.set('route', entries.join('||'));
          const routeBody = sysEngines.texts.get('route');
          for (const rf of routeFiles) rf.content = routeBody;
        }
      }

      // Store master passwords into global.pass
      const masterEntries = nodeList
        .filter((n) => n.system !== null)
        .map((n) => `${n.system!.owner || n.system!.name} : ${n.system!.mpass}`)
        .join('\n');
      if (masterEntries) {
        for (const n of nodeList) {
          if (!n.system) continue;
          const gpFiles = Object.values(n.system.files).filter((f) => f.key === 'global.pass');
          if (gpFiles.length > 0) {
            const header = texts.get('globalPassHeader');
            const footer = texts.get('globalPassFooter');
            for (const f of gpFiles) f.content = `${header}\n${masterEntries}\n${footer}`;
          }
        }
      }

      // Dispatch bonus money into .pack files
      const packNodes = nodeList.filter(
        (n) =>
          n.system !== null &&
          n.type !== 'Treasure' &&
          Object.values(n.system.files).some((f) => f.ext === 'pack' && !f.content)
      );
      let emptyDrop = packNodes.length >= 6 ? rseed.random(3) + 1 : packNodes.length >= 4 ? rseed.random(2) + 1 : 0;
      while (emptyDrop > 0 && packNodes.length > 1) {
        packNodes.splice(rseed.random(packNodes.length), 1);
        emptyDrop--;
      }
      if (packNodes.length > 0 && mdata.bonus > 0) {
        const billDenoms = Array.from(bundle.valuables.values()).map((v) => v.price);
        const amounts = spreadValues(workSeed, mdata.bonus, packNodes.length, 5, 20, 25);
        for (const pn of packNodes) {
          const amt = amounts.pop() ?? 0;
          if (amt <= 0 || !pn.system) continue;
          const emptyPacks = Object.values(pn.system.files).filter((f) => f.ext === 'pack' && !f.content);
          const bills = divideInBills(amt, emptyPacks.length, billDenoms);
          while (bills.length > emptyPacks.length) bills.shift();
          for (const f of emptyPacks) {
            if (bills.length === 0) break;
            f.effects.E_PackMoney = 1;
            f.content = String(bills.pop()!);
          }
        }
      }
      // Clean up leftover empty .pack files
      for (const n of nodeList) {
        if (!n.system) continue;
        for (const f of Object.values(n.system.files)) {
          if (f.key === 'file.pack' && !f.content) {
            delete n.system.files[f.id];
            if (f.parentId !== null && n.system.files[f.parentId]) {
              n.system.files[f.parentId].childrenIds = n.system.files[f.parentId].childrenIds.filter(
                (cid) => cid !== f.id
              );
            }
          }
        }
      }

      // Dispatch Stolen Credit Cards
      let effectiveCards: StolenCard[] = mdata.cards;
      if (cardNumbers !== undefined) {
        if (cardNumbers.length === 0) {
          effectiveCards = [];
        } else {
          const canonical = buildMissionCards(mdata.seed, mdata.gl, mdata.corp);
          effectiveCards = cardNumbers.map((num, idx) => {
            const base = canonical[idx] ?? mdata.cards[idx];
            if (base) {
              return { ...base, number: num };
            }
            return {
              id: `cc_${mdata.seed}_${idx}`,
              holder: mdata.corp,
              number: num,
              amount: 500,
            };
          });
        }
      }
      dispatchStolenCards(bundle, mdata.corp, hackerName, effectiveCards, nodeList, workSeed, adult);

      // Compute initial visibility
      const nodesOut: Record<number, NetNodeState> = {};
      for (const n of nodeList) {
        const canReachInit = n.path.every((pid) => {
          if (pid === n.id) return true;
          const p = byId.get(pid)!;
          return p.type === 'Entrance' || p.type === 'Empty';
        });
        nodesOut[n.id] = {
          id: n.id,
          x: n.x,
          y: n.y,
          type: n.type,
          dist: n.dist,
          links: n.links,
          pathFromEntrance: n.path,
          visible: n.dist <= 1 || canReachInit,
          isMissionTarget: n.isTarget,
          siblingLockTargetId: n.siblingId,
          system: n.system,
        };
      }

      return {
        seed: workSeed,
        entranceId: entrance.id,
        nodes: nodesOut,
        extraMissionCount,
      };
    } catch {
      tries++;
      workSeed++;
    }
  }

  throw new Error(`Failed to generate valid network for seed=${mdata.seed} gl=${mdata.gl}`);
}

function ensureUniqueNameInFolder(
  filesRecord: Record<number, FileNodeState>,
  parentId: number | null,
  rawName: string,
  isFolder: boolean,
  excludeId?: number
): string {
  if (parentId === null || !filesRecord[parentId]) return rawName;
  const parent = filesRecord[parentId];
  const seen = new Set<string>();
  for (const cid of parent.childrenIds) {
    if (cid === excludeId) continue;
    const sib = filesRecord[cid];
    if (sib && !sib.deleted) seen.add(sib.name.toLowerCase());
  }
  let candidate = rawName;
  let attempt = 1;
  while (seen.has(candidate.toLowerCase())) {
    attempt++;
    const dot = isFolder ? -1 : rawName.lastIndexOf('.');
    candidate =
      dot > 0
        ? `${rawName.slice(0, dot)}_${attempt}${rawName.slice(dot)}`
        : `${rawName}_${attempt}`;
  }
  return candidate;
}

function generateSystemForNode(
  bundle: GameDataBundle,
  patterns: PatternLoader,
  mdata: MissionData,
  node: InternalNode,
  seed: number,
  baseDiff: number,
  adult: boolean,
  hackerName = 'Haxxor'
): SystemState | null {
  let rseed = Rand.fromSeed(seed);
  const patternName = getPatternForNodeType(node.type, mdata.gl, rseed);
  if (!patternName) return null;

  const { texts, fsNames, names } = bundle.createTextEngines(seed, adult);
  const sysOwner = node.users[0] ?? '';
  const textOwner = sysOwner || names.get('username', rseed);
  names.set('corp', mdata.corp);
  texts.set('corp', mdata.corp);
  texts.set('hacker', hackerName);
  fsNames.set('owner', textOwner);
  texts.set('owner', textOwner);
  texts.set('user', textOwner);
  texts.set('file', fsNames.get('file.lib'));
  const mpass = texts.get('password', rseed).toLowerCase();
  texts.set('pass', mpass);
  texts.set('content', mpass);

  rseed = Rand.fromSeed(seed);
  const rawTree: InternalFile[] = [];
  let uniq = 0;

  const createFile = (parentId: number | null, key: string, isFolder: boolean): InternalFile => {
    const id = uniq++;
    const fileOwner = key === 'crime.data' ? names.get('username', rseed) : textOwner;
    fsNames.set('owner', fileOwner);
    const avSlot = key.includes('.antivir') ? 'avslot' : null;
    const name =
      key === 'crime.data'
        ? `${fileOwner}.data`
        : avSlot
          ? `avslot${fsNames.get('ver')}.${fsNames.get('antivirExt')}`
          : fsNames.get(key);
    const ext = isFolder ? '' : extractExt(name);
    const life =
      avSlot !== null
        ? AV_LIFE
        : key === 'file.guardian'
          ? GUARDIAN_LIFE
          : key === 'file.core'
            ? isTutorialMission(mdata)
              ? AV_LIFE
              : CORE_LIFE
            : key === 'file.control'
              ? AV_LIFE
              : 1;

    const f: InternalFile = {
      id,
      key,
      name,
      ext,
      isFolder,
      parentId,
      childrenIds: [],
      size: computeFileSize(isFolder, key, ext),
      life,
      lifeTotal: life,
      deleted: false,
      password: null,
      avKey: avSlot,
      content: '',
      embed: null,
      cardData: null,
      isMissionTarget: false,
      infectedByVirus: null,
      effects: {},
      sortIndex: isFolder ? rseed.random(500) : 1000 + rseed.random(500),
      seed: id + seed,
      owner: fileOwner,
    };
    rawTree.push(f);
    return f;
  };

  const genFolder = (parentId: number | null, pname: string): void => {
    if (pname === '/programs' && isTutorialMission(mdata)) return;
    const folder = createFile(parentId, pname, true);
    const content = patterns.getContent(pname);
    for (const fKey of content.folders) {
      const c = PatternLoader.getCount(rseed, fKey);
      for (let i = 0; i < c; i++) genFolder(folder.id, PatternLoader.cleanUpKey(fKey));
    }
    for (const fileKey of content.files) {
      const c = PatternLoader.getCount(rseed, fileKey);
      for (let i = 0; i < c; i++) createFile(folder.id, PatternLoader.cleanUpKey(fileKey), false);
    }
  };

  genFolder(null, patternName);

  // AV generation
  rseed = Rand.fromSeed(seed);
  let diffBudget = node.type === 'Terminal' ? Math.min(15, baseDiff) : baseDiff;
  const avSlots = rawTree.filter((f) => f.avKey === 'avslot');
  const eligibleAvs: AntivirusDef[] = Array.from(bundle.antiviruses.values()).filter(
    (av) => av.minLevel <= mdata.gl && av.diff < 9999
  );
  while (diffBudget > 0 && avSlots.length > 0 && eligibleAvs.length > 0) {
    let picked: AntivirusDef | null = null;
    let t = 0;
    do {
      picked = eligibleAvs[rseed.random(eligibleAvs.length)];
      t++;
    } while (picked.diff > diffBudget && t < 200);
    if (!picked || t >= 200) break;
    const idx = rseed.random(avSlots.length);
    const slot = avSlots.splice(idx, 1)[0];
    slot.avKey = picked.key;
    slot.name = `${picked.key}${fsNames.get('ver')}.${fsNames.get('antivirExt')}`;
    slot.ext = extractExt(slot.name);
    diffBudget -= picked.diff;
  }

  // Strip unfilled avslots & high-level special files
  let filtered = rawTree.filter((f) => f.avKey !== 'avslot');
  if (mdata.gl < 2) filtered = filtered.filter((f) => !f.key.includes('.index'));
  if (mdata.gl < 3) filtered = filtered.filter((f) => !f.key.includes('.log'));
  if (mdata.gl < 4) filtered = filtered.filter((f) => !f.key.includes('.route'));

  // Folder passwords (gl >= 5, matching legacy GFileSystem.hidePasswords)
  if (mdata.gl >= 5 && !isTutorialMission(mdata)) {
    const folders = filtered.filter((f) => f.isFolder && f.parentId !== null && f.key !== '/program');
    const lockCount = rseed.random(10);
    if (!(folders.length <= 3 && rseed.random(100) < 60)) {
      for (let i = 0; i < lockCount && folders.length > 0; i++) {
        folders[rseed.random(folders.length)].password = mpass;
      }
    }

    const lockedList = filtered.filter((f) => f.password !== null || f.avKey === 'passwd');
    if (lockedList.length > 0) {
      const rebuildLookup = () => {
        const byIdTmp = new Map(filtered.map((f) => [f.id, f]));
        const folderHasPasswdAv = (fid: number): boolean =>
          filtered.some((x) => x.parentId === fid && x.avKey === 'passwd');
        return (f: InternalFile): boolean => {
          if (f.isMissionTarget) return false;
          let cur = f.parentId !== null ? byIdTmp.get(f.parentId) : undefined;
          while (cur) {
            if (cur.password !== null || folderHasPasswdAv(cur.id)) return false;
            cur = cur.parentId !== null ? byIdTmp.get(cur.parentId) : undefined;
          }
          return true;
        };
      };

      const hidePasswordInHost = (host: InternalFile) => {
        texts.set('pass', mpass);
        texts.set('user', textOwner);
        if (host.ext === 'mail') {
          const adminSender = texts.get('SysAdmin');
          host.owner = adminSender;
          fsNames.set('owner', adminSender);
          host.name = fsNames.get('file.mail');
          host.ext = extractExt(host.name);
          host.key = 'pass.mail';
          texts.set('from', adminSender);
          texts.set('mcontent', texts.get('passwordMail'));
          host.content = texts.get('forcedMail');
        } else {
          host.key = 'file.pass';
          host.name = fsNames.get('file.pass');
          host.ext = extractExt(host.name);
          host.content = texts.get('passwordDoc');
        }
      };

      let isUnlocked = rebuildLookup();
      const possibleKeys =
        node.type === 'TerminalMul' || mdata.gl <= 4
          ? ['file.pass', 'file.data']
          : ['file.doc', 'file.mail', 'file.pass', 'file.data'];
      let done = false;
      while (!done && possibleKeys.length > 0) {
        const pickedKey = possibleKeys.splice(rseed.random(possibleKeys.length), 1)[0];
        const pool = filtered.filter(
          (f) => !f.isFolder && !f.avKey && f.key === pickedKey && isUnlocked(f)
        );
        if (pool.length > 0) {
          hidePasswordInHost(pool[rseed.random(pool.length)]);
          done = true;
        }
      }

      if (!done) {
        // Fallback: generate a full /pass folder in root and hide password in its file.pass
        const root = filtered.find((f) => f.parentId === null)!;
        const prevRawLen = rawTree.length;
        genFolder(root.id, '/pass');
        for (let idx = prevRawLen; idx < rawTree.length; idx++) {
          const nf = rawTree[idx];
          if (nf.avKey !== 'avslot') filtered.push(nf);
        }
        isUnlocked = rebuildLookup();
        const passPool = filtered.filter(
          (f) => !f.isFolder && !f.avKey && f.key === 'file.pass' && isUnlocked(f)
        );
        if (passPool.length > 0) {
          hidePasswordInHost(passPool[rseed.random(passPool.length)]);
        }
      }
    }
  }

  // Remove empty file.pass
  filtered = filtered.filter((f) => !(f.key === 'file.pass' && !f.content));

  // Mana packs
  rseed = Rand.fromSeed(seed);
  if (node.type === 'Treasure' || (rseed.random(100) < 75 && !isTutorialMission(mdata))) {
    const emptyPacks = filtered.filter((f) => f.ext === 'pack' && !f.content);
    const totalMana = rseed.random(30) + 20 * mdata.gl;
    if (emptyPacks.length > 0 && totalMana > 0) {
      let n = Math.min(3, rseed.random(emptyPacks.length) + 2, emptyPacks.length);
      if (totalMana < 50 && n > 1) n = 1;
      if (totalMana < 60 && n > 2) n = 2;
      const spread = spreadValues(seed, totalMana, n, 5, 10, 25);
      while (spread.length > 0 && emptyPacks.length > 0) {
        const sum = spread.shift()!;
        const pack = emptyPacks.splice(rseed.random(emptyPacks.length), 1)[0];
        pack.effects.E_PackMana = 1;
        pack.content = String(sum);
      }
    }
  }

  // Encryption (gl >= 5, fixed money.game!)
  if (mdata.gl > 4) {
    rseed = Rand.fromSeed(seed);
    const encodeByKey = (k: string, lvl: number) => {
      if (lvl <= 0) return;
      for (const f of filtered) {
        if (f.key === k) f.effects.E_Encoded = lvl;
      }
    };
    encodeByKey('global.pass', rseed.random(2) + 1);
    encodeByKey('file.pass', mdata.gl >= 6 ? rseed.random(3) + 1 : rseed.random(2));
    encodeByKey('antivir.index', 1 + rseed.random(2));
    encodeByKey('file.route', rseed.random(2));
    encodeByKey('file.control', mdata.gl >= 6 ? rseed.random(3) : rseed.random(2));
    const genc = rseed.random(3);
    encodeByKey('inv.game', genc);
    encodeByKey('stats.game', genc);
    encodeByKey('money.game', genc);
  }

  // Build parent -> children map & ensure unique names per folder
  const filesRecord: Record<number, FileNodeState> = {};
  filtered.sort((a, b) => a.sortIndex - b.sortIndex);
  for (const f of filtered) {
    f.childrenIds = [];
    filesRecord[f.id] = f;
  }

  for (const f of filtered) {
    if (f.parentId !== null && filesRecord[f.parentId]) {
      filesRecord[f.parentId].childrenIds.push(f.id);
    }
  }

  // Ensure sibling name uniqueness (regenerate fresh DSL name like legacy GFileSystem.applyNameUnicity)
  const regenerateFreshName = (child: InternalFile): string | null => {
    if (child.avKey) {
      return `${child.avKey}${fsNames.get('ver')}.${fsNames.get('antivirExt')}`;
    }
    if (child.key === 'crime.data') {
      const newOwner = names.get('username', rseed);
      child.owner = newOwner;
      return `${newOwner}.data`;
    }
    fsNames.set('owner', child.owner || textOwner);
    const gen = fsNames.get(child.key);
    return gen && gen !== child.key ? gen : null;
  };

  for (const folder of filtered.filter((x) => x.isFolder)) {
    const seen = new Set<string>();
    for (const cid of folder.childrenIds) {
      const child = filesRecord[cid] as InternalFile;
      let candidate = child.name;
      let regenTries = 0;
      while (seen.has(candidate.toLowerCase()) && regenTries < 25) {
        regenTries++;
        const fresh = regenerateFreshName(child);
        if (!fresh) break;
        candidate = fresh;
      }
      let suffixAttempt = 1;
      while (seen.has(candidate.toLowerCase())) {
        suffixAttempt++;
        const dot = child.isFolder ? -1 : child.name.lastIndexOf('.');
        candidate =
          dot > 0
            ? `${child.name.slice(0, dot)}_${suffixAttempt}${child.name.slice(dot)}`
            : `${child.name}_${suffixAttempt}`;
      }
      child.name = candidate;
      if (!child.isFolder) child.ext = extractExt(child.name);
      seen.add(candidate.toLowerCase());
    }
  }

  // Populate lazy file contents (doc, mail, log, control, game, rar, media, antivir.index, passwd)
  const getPathStr = (f: FileNodeState): string => {
    const parts: string[] = [];
    let cur = f.isFolder ? f : f.parentId !== null ? filesRecord[f.parentId] : null;
    while (cur && cur.parentId !== null) {
      parts.unshift(cur.name);
      cur = filesRecord[cur.parentId] ?? null;
    }
    return '/' + (parts.length > 0 ? parts.join('/') + '/' : '');
  };

  for (const f of filtered) {
    if (f.isFolder || f.content || f.ext === 'pack') continue;
    const fRng = Rand.fromSeed(f.seed);
    texts.rseed = fRng;
    texts.set('owner', f.owner || textOwner);
    if (f.avKey === 'passwd') {
      texts.set('content', mpass);
      texts.set('user', textOwner);
      f.content = texts.get('fileSettings');
    } else if (f.key === 'antivir.index') {
      const avEntries = filtered
        .filter((x) => x.avKey !== null)
        .map((x) => {
          texts.set('path', getPathStr(x));
          texts.set('name', x.name.toLowerCase());
          return texts.get('indexEntry');
        });
      f.content = avEntries.join('\n') || '--EMPTY--';
    } else if (f.ext === 'log') {
      texts.set('pass', mpass);
      texts.set('time', `${10 + fRng.random(12)}:${10 + fRng.random(49)}`);
      f.content = texts.get('log');
    } else if (f.ext === 'doc') {
      f.content = texts.get('document');
    } else if (f.ext === 'mail') {
      f.content = texts.get('mail');
    } else if (f.key === 'crime.data') {
      f.content = texts.get('crimeLog');
    } else if (f.key === 'inv.game') {
      f.content = texts.get('inventory');
    } else if (f.key === 'money.game') {
      f.content = texts.get('gold');
    } else if (f.key === 'stats.game') {
      f.content = texts.get('stats');
    } else if (f.key === 'file.control') {
      f.content = texts.get('controlFile');
    } else if (f.key === 'file.video' || f.ext === 'video') {
      f.content = texts.get('videoFile');
      f.embed = `video:${f.name}`;
    } else if (f.key === 'file.music' || f.ext === 'mp3') {
      f.content = texts.exists('musicFile') ? texts.get('musicFile') : texts.get('rarFile');
      f.embed = `audio:${f.name}`;
    } else if (f.key === 'file.image') {
      f.content = texts.get('imageFile');
      f.embed = `image:${f.name}`;
    } else if (f.key === 'file.rar' || f.ext === 'rar') {
      f.content = texts.get('rarFile');
    }
  }

  // Apply initial AV & Guardian passive effects
  const addEffectRec = (folderId: number, eff: FileEffectType) => {
    const folder = filesRecord[folderId];
    if (!folder) return;
    for (const cid of folder.childrenIds) {
      const ch = filesRecord[cid];
      if (!ch) continue;
      ch.effects[eff] = (ch.effects[eff] ?? 0) + 1;
      if (ch.isFolder) addEffectRec(ch.id, eff);
    }
  };

  const activeAvs = filtered.filter((f) => f.avKey !== null);
  for (const avFile of activeAvs) {
    if (avFile.avKey === 'mask' && avFile.parentId !== null) {
      addEffectRec(avFile.parentId, 'E_Masked');
    }
  }

  const shieldCount = activeAvs.filter((f) => f.avKey === 'shield').length;
  if (shieldCount > 0) {
    for (const f of filtered) {
      if (!f.isFolder && (f.avKey !== null || f.key === 'file.core' || f.key === 'file.guardian')) {
        f.effects.E_Shield = shieldCount;
      }
    }
  }

  if (activeAvs.some((f) => f.avKey === 'paladin')) {
    for (const f of filtered) {
      if (!f.isFolder && f.avKey === null) {
        f.effects.E_Immune = 1;
      }
    }
  }

  const guardianCount = filtered.filter((f) => f.key === 'file.guardian').length;
  if (guardianCount > 0) {
    for (const f of filtered.filter((x) => x.key === 'file.core')) {
      f.effects.E_CShield = guardianCount;
    }
  }

  const avDanger = activeAvs.reduce((acc, f) => {
    const def = bundle.antiviruses.get(f.avKey!);
    return acc + (def ? def.diff : 0);
  }, 0);

  const root = filtered.find((f) => f.parentId === null)!;
  return {
    nodeId: node.id,
    name: root.name,
    owner: sysOwner,
    ip: node.ip,
    patternName,
    mpass,
    crashed: false,
    corrupted: node.type === 'Entrance',
    speed: 1.0,
    avDanger,
    rootFolderId: root.id,
    files: filesRecord,
  };
}

function applyMissionSystemCustomizations(
  bundle: GameDataBundle,
  patterns: PatternLoader,
  mdata: MissionData,
  allNodes: InternalNode[],
  targetNodes: InternalNode[],
  fn: InternalNode,
  rseed: Rand,
  adult: boolean,
  hackerName = 'Haxxor'
): number {
  const sys = fn.system!;
  const { texts, fsNames, names } = bundle.createTextEngines(mdata.seed, adult);
  const effectiveOwner = sys.owner || names.get('username', rseed);
  names.set('corp', mdata.corp);
  texts.set('corp', mdata.corp);
  texts.set('hacker', hackerName);
  fsNames.set('owner', effectiveOwner);
  texts.set('owner', effectiveOwner);
  texts.set('user', effectiveOwner);
  texts.set('pass', sys.mpass);
  texts.set('file', fsNames.get('file.lib'));
  const allFiles = () => Object.values(sys.files);
  const setRootName = (s: SystemState, newName: string) => {
    s.name = newName;
    if (s.files[s.rootFolderId]) s.files[s.rootFolderId].name = newName;
  };
  const replaceDocOrAny = (s: SystemState, newName: string, markTarget = true): FileNodeState => {
    const docs = Object.values(s.files).filter((f) => !isProtectedFile(f) && f.ext === 'doc');
    const pool = docs.length > 0 ? docs : Object.values(s.files).filter((f) => !isProtectedFile(f));
    if (pool.length === 0) throw new Error('no replaceable file');
    const picked = pool[rseed.random(pool.length)];
    const uniqueName = ensureUniqueNameInFolder(s.files, picked.parentId, newName, false, picked.id);
    picked.name = uniqueName;
    picked.ext = extractExt(uniqueName);
    picked.size = computeFileSize(false, picked.key, picked.ext);
    if (markTarget) picked.isMissionTarget = true;
    return picked;
  };

  let extraMissionCount = 0;
  const mp = mdata.type;

  switch (mp.kind) {
    case 'Moderate': {
      const userDirs = allFiles().filter((f) => f.isFolder && f.key === '/user');
      const userDir =
        userDirs.length > 0 ? userDirs[rseed.random(userDirs.length)] : sys.files[sys.rootFolderId];
      userDir.name = ensureUniqueNameInFolder(sys.files, userDir.parentId, mp.owner, true, userDir.id);

      let nextId = Math.max(0, ...Object.keys(sys.files).map(Number)) + 1;
      const hasPaladin = Object.values(sys.files).some((x) => !x.deleted && x.avKey === 'paladin');
      const getAncestorMaskStacks = (folderId: number): number => {
        let stacks = 0;
        let cur: FileNodeState | undefined = sys.files[folderId];
        while (cur) {
          stacks += cur.childrenIds.filter((cid) => sys.files[cid]?.avKey === 'mask').length;
          cur = cur.parentId !== null ? sys.files[cur.parentId] : undefined;
        }
        return stacks;
      };

      const spawnMissionNode = (parentId: number, key: string, isFolder: boolean): FileNodeState => {
        const id = nextId++;
        fsNames.set('owner', mp.owner);
        const rawName = fsNames.get(key, rseed);
        const name = ensureUniqueNameInFolder(sys.files, parentId, rawName, isFolder);
        const ext = isFolder ? '' : extractExt(name);
        const effects: Partial<Record<FileEffectType, number>> = {};
        const maskStacks = getAncestorMaskStacks(parentId);
        if (maskStacks > 0) effects.E_Masked = maskStacks;
        if (!isFolder && hasPaladin) effects.E_Immune = 1;

        let content = '';
        let embed: string | null = null;
        if (!isFolder) {
          texts.rseed = Rand.fromSeed(mdata.seed + id);
          texts.set('owner', mp.owner);
          if (key === 'file.video' || ext === 'video') {
            content = texts.get('videoFile');
            embed = `video:${name}`;
          } else if (key === 'file.music' || ext === 'mp3') {
            content = texts.exists('musicFile') ? texts.get('musicFile') : texts.get('rarFile');
            embed = `audio:${name}`;
          } else if (key === 'file.image') {
            content = texts.get('imageFile');
            embed = `image:${name}`;
          } else if (ext === 'doc') {
            content = texts.get('document');
          } else if (ext === 'mail') {
            content = texts.get('mail');
          }
        }

        const nodeState: FileNodeState = {
          id,
          key,
          name,
          ext,
          isFolder,
          parentId,
          childrenIds: [],
          size: computeFileSize(isFolder, key, ext),
          life: 1,
          lifeTotal: 1,
          deleted: false,
          password: null,
          avKey: null,
          content,
          embed,
          cardData: null,
          isMissionTarget: !isFolder && (ext === 'mp3' || ext === 'video'),
          infectedByVirus: null,
          effects,
        };
        sys.files[id] = nodeState;
        sys.files[parentId].childrenIds.push(id);
        return nodeState;
      };

      const subKey = rseed.random(2) === 0 ? '/junk' : '/music';
      const subDir = spawnMissionNode(userDir.id, subKey, true);
      if (patterns.exists(subKey)) {
        const subContent = patterns.getContent(subKey);
        for (const fileSpec of subContent.files) {
          const cleanKey = PatternLoader.cleanUpKey(fileSpec);
          if (cleanKey === 'file.pack' || cleanKey.includes('.antivir')) continue;
          const cnt = PatternLoader.getCount(rseed, fileSpec);
          for (let i = 0; i < cnt; i++) {
            spawnMissionNode(subDir.id, cleanKey, false);
          }
        }
      }

      const directVideos = rseed.random(2);
      const directMusic = 1 + rseed.random(6);
      for (let i = 0; i < directVideos; i++) {
        spawnMissionNode(userDir.id, 'file.video', false);
      }
      for (let i = 0; i < directMusic; i++) {
        spawnMissionNode(userDir.id, 'file.music', false);
      }
      break;
    }
    case 'Delete': {
      const f = replaceDocOrAny(sys, mp.fname, true);
      f.effects.E_Encoded = rseed.random(4) + 6;
      break;
    }
    case 'Copy': {
      const printer = allNodes.find((n) => n.type === 'Printer' && n.system !== null);
      if (printer && printer.system && rseed.random(100) < 40 && mdata.gl >= 5) {
        fn.isTarget = false;
        printer.isTarget = true;
        replaceDocOrAny(printer.system, mp.fname, true);
      } else {
        replaceDocOrAny(sys, mp.fname, true);
      }
      break;
    }
    case 'Steal':
      replaceDocOrAny(sys, mp.fname, true);
      break;
    case 'CrashPrinter':
      setRootName(sys, mp.name);
      break;
    case 'CrashDB':
      setRootName(sys, mp.fname);
      break;
    case 'CleanTerminal':
      setRootName(sys, mp.owner);
      break;
    case 'CopyMail': {
      const mails = allFiles().filter((f) => !isProtectedFile(f) && f.ext === 'mail');
      if (mails.length === 0) throw new Error('no mail for CopyMail');
      const mail = mails[rseed.random(mails.length)];
      mail.isMissionTarget = true;
      texts.set('from', mp.sender);
      texts.set('mcontent', texts.get('dangerousMail'));
      mail.content = texts.get('forcedMail');
      break;
    }
    case 'FindMails': {
      const mails = allFiles().filter((f) => !isProtectedFile(f) && f.ext === 'mail');
      if (mails.length < mp.n) throw new Error('not enough mails for FindMails');
      for (let i = 0; i < mp.n; i++) {
        const mail = mails.splice(rseed.random(mails.length), 1)[0];
        texts.set('from', texts.get('unknownSender'));
        texts.set('mcontent', texts.get('dangerousMail'));
        mail.content = texts.get('forcedMail');
        mail.isMissionTarget = true;
      }
      break;
    }
    case 'Passwords':
      setRootName(sys, mp.name);
      for (const f of allFiles().filter((x) => x.key === 'global.pass')) f.isMissionTarget = true;
      break;
    case 'CamRec': {
      const vids = allFiles().filter((f) => f.key === 'archive.video' || f.ext === 'video');
      if (vids.length === 0) throw new Error('no video for CamRec');
      const v = vids[rseed.random(vids.length)];
      v.name = ensureUniqueNameInFolder(sys.files, v.parentId, mp.fname, false, v.id);
      v.isMissionTarget = true;
      break;
    }
    case 'CleanCriminal': {
      const list = allFiles().filter((f) => f.key === 'crime.data');
      if (list.length === 0) throw new Error('no crime.data for CleanCriminal');
      const f = list[rseed.random(list.length)];
      f.name = ensureUniqueNameInFolder(sys.files, f.parentId, `${mp.name}.data`, false, f.id);
      texts.set('owner', mp.name);
      f.content = texts.get('crimeLog');
      f.isMissionTarget = true;
      break;
    }
    case 'FalsifyCam': {
      setRootName(sys, `${fsNames.get('camName')} ${mp.sector}`);
      const vids = allFiles().filter((x) => x.key === 'archive.video' || x.ext === 'video');
      if (vids.length === 0) throw new Error('no video for FalsifyCam');
      for (const f of vids) {
        f.isMissionTarget = true;
      }
      break;
    }
    case 'DeliverFile': {
      const dirs = allFiles().filter((f) => f.isFolder && f.key === mp.parentKey);
      const dir = dirs.length > 0 ? dirs[rseed.random(dirs.length)] : undefined;
      if (dir) dir.name = ensureUniqueNameInFolder(sys.files, dir.parentId, mp.parentName, true, dir.id);
      break;
    }
    case 'OverwriteFiles': {
      let totalTargets = 0;
      for (const tn of targetNodes) {
        if (!tn.system) continue;
        for (const f of Object.values(tn.system.files)) {
          if (!f.isFolder && f.ext === mp.ext) {
            f.isMissionTarget = true;
            totalTargets++;
          }
        }
      }
      if (totalTargets === 0) throw new Error('no files for OverwriteFiles');
      break;
    }
    case 'GameHack': {
      setRootName(sys, mp.serv);
      const charDirs = allFiles().filter((f) => f.isFolder && f.key === '/char');
      const dir = charDirs.length > 0 ? charDirs[rseed.random(charDirs.length)] : undefined;
      if (dir) {
        dir.name = ensureUniqueNameInFolder(sys.files, dir.parentId, mp.char, true, dir.id);
        for (const cid of dir.childrenIds) {
          const cf = sys.files[cid];
          if (cf && !cf.isFolder && cf.key.endsWith('.game')) cf.isMissionTarget = true;
        }
      }
      break;
    }
    case 'InfectNet':
      for (const tn of targetNodes) {
        if (!tn.system) continue;
        for (const f of Object.values(tn.system.files)) {
          if (f.key === 'file.control') f.isMissionTarget = true;
        }
      }
      break;
    case 'GetVirus':
      for (const tn of targetNodes) {
        if (!tn.system) continue;
        const list = Object.values(tn.system.files).filter((f) => !f.isFolder && f.ext === mp.ext);
        for (const f of list) {
          f.isMissionTarget = true;
          f.infectedByVirus = mp.v;
          f.effects.E_Target = 1;
        }
        if (list.length < mp.n) extraMissionCount = mp.n - list.length;
      }
      break;
    case 'TutorialDelete':
      for (const tn of targetNodes) {
        if (!tn.system) continue;
        for (const f of Object.values(tn.system.files)) {
          if (!f.isFolder && f.ext === mp.ext) f.isMissionTarget = true;
        }
      }
      break;
    case 'TutorialBypass': {
      const docs = allFiles().filter((f) => !isProtectedFile(f) && f.key === 'file.doc');
      const fallback = docs.length > 0 ? docs : allFiles().filter((f) => !isProtectedFile(f));
      const doc = fallback.length > 0 ? fallback[rseed.random(fallback.length)] : undefined;
      if (doc) {
        doc.name = ensureUniqueNameInFolder(sys.files, doc.parentId, mp.f, false, doc.id);
        doc.ext = extractExt(doc.name);
        doc.isMissionTarget = true;
      }
      break;
    }
    case 'TV': {
      setRootName(sys, mp.tvTo);
      const otherTvs = allNodes.filter((n) => n.type === 'Tv' && !n.isTarget && n.system !== null);
      if (otherTvs.length === 0) throw new Error('no other tv for TV mission');
      const src = otherTvs[rseed.random(otherTvs.length)];
      setRootName(src.system!, mp.tvFrom);
      for (const f of Object.values(src.system!.files).filter((x) => x.key === 'tvprog.data')) {
        const rawProg = names.get('hotProg');
        const progWithExt = rawProg.toLowerCase().endsWith('.data') ? rawProg : `${rawProg}.data`;
        f.name = ensureUniqueNameInFolder(
          src.system!.files,
          f.parentId,
          progWithExt,
          false,
          f.id
        );
        f.ext = extractExt(f.name);
        f.isMissionTarget = true;
      }
      break;
    }
    case 'TVTheft': {
      for (const ntv of allNodes.filter((n) => n.type === 'Tv' && n.system !== null)) {
        setRootName(ntv.system!, `${mp.tv} ${texts.get('roman')}-${rseed.random(9) + 1}`);
      }
      const progs = allFiles().filter((f) => f.key === 'tvprog.data');
      const prog = progs.length > 0 ? progs[rseed.random(progs.length)] : undefined;
      if (prog) {
        const progWithExt = mp.program.toLowerCase().endsWith('.data') ? mp.program : `${mp.program}.data`;
        prog.name = ensureUniqueNameInFolder(sys.files, prog.parentId, progWithExt, false, prog.id);
        prog.ext = extractExt(prog.name);
        prog.isMissionTarget = true;
        const enc = rseed.random(4);
        if (enc > 0 && mdata.gl > 4) prog.effects.E_Encoded = enc;
      }
      break;
    }
    case 'TVCrash':
      setRootName(sys, mp.tv);
      break;
    default:
      break;
  }
  return extraMissionCount;
}

function dispatchStolenCards(
  bundle: GameDataBundle,
  corp: string,
  hackerName: string,
  cards: StolenCard[],
  nodes: InternalNode[],
  seed: number,
  adult: boolean
): void {
  if (cards.length === 0) return;
  const rng = Rand.fromSeed(seed ^ 0x19a4f1);
  const { texts, fsNames, names } = bundle.createTextEngines(seed ^ 0x19a4f1, adult);
  names.set('corp', corp);
  texts.set('corp', corp);
  texts.set('hacker', hackerName);

  const getEligibleFiles = (sys: SystemState): FileNodeState[] =>
    Object.values(sys.files).filter(
      (f) =>
        !isProtectedFile(f) &&
        !f.isMissionTarget &&
        f.cardData === null &&
        (f.ext === 'mail' || f.ext === 'doc')
    );

  for (const card of cards) {
    const pool = nodes.filter((n) => n.system !== null && getEligibleFiles(n.system).length > 0);
    if (pool.length === 0) break;
    const node = pool[rng.random(pool.length)];
    const candidates = getEligibleFiles(node.system!);
    if (candidates.length === 0) continue;
    const f = candidates[rng.random(candidates.length)];
    f.cardData = card;
    const cardDisplay = `${card.holder} — [${card.number}] (${card.amount} CR)`;
    texts.set('card', cardDisplay);
    if (f.ext === 'mail') {
      texts.set('from', texts.get('sellerMail'));
      texts.set('mcontent', texts.get('creditCardMail'));
      f.content = texts.get('forcedMailNoSubject');
    } else {
      f.content = texts.get('creditCardDoc');
      const rawCardName = fsNames.get('creditCard.doc', rng);
      f.name = ensureUniqueNameInFolder(node.system!.files, f.parentId, rawCardName, false, f.id);
      f.ext = extractExt(f.name);
    }
  }
}
