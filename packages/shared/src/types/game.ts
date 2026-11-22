export type LangCode = 'fr' | 'en';

export type VirusTarget = '_file' | '_folder' | '_none' | '_net';
export type VirusCategory = 'hidden' | 'specials' | 'damage' | 'debuff' | 'utils' | 'combo';

export interface VirusDef {
  id: string;
  name: string;
  desc: string;
  target: VirusTarget;
  size: number;
  power: number;
  info: number;
  cc: number;
  uses: number | null;
  price: number;
  cat: VirusCategory;
  catName: string;
  date: string | null;
  level: number;
  recom: boolean;
  start: boolean;
}

export interface AntivirusDef {
  key: string;
  diff: number;
  minLevel: number;
  max: number;
  desc: string;
  power: number;
}

export interface ChipsetDef {
  id: string;
  price: number;
  name: string;
  desc: string;
  level: number;
}

export interface ValuableDef {
  id: string;
  price: number;
  name: string;
  rare: boolean;
}

export interface TutorialStepDef {
  id: string;
  auto: boolean;
  y: number;
  text: string;
}

export type TutorialTrackId = 'first' | 'second' | 'third';

export type NodeType =
  | 'Empty'
  | 'Unused'
  | 'TargetEmpty'
  | 'Entrance'
  | 'Terminal'
  | 'Gateway'
  | 'Printer'
  | 'Slower'
  | 'TerminalMul'
  | 'Database'
  | 'Keypad'
  | 'Camera'
  | 'CrimeDatabase'
  | 'LockServer'
  | 'BigDisplay'
  | 'GameServer'
  | 'Ftp'
  | 'Tv'
  | 'TutoTerm'
  | 'TutoFirewall'
  | 'LockServerLight'
  | 'Alarm'
  | 'Treasure';

export type MissionPattern =
  | { kind: 'Moderate'; owner: string }
  | { kind: 'Delete'; owner: string; fname: string }
  | { kind: 'DeleteAll'; owner: string; ext: string }
  | { kind: 'Copy'; owner: string; fname: string }
  | { kind: 'Steal'; owner: string; fname: string }
  | { kind: 'CrashDB'; fname: string }
  | { kind: 'DeliverFile'; parentKey: string; parentName: string; file: string; to: string }
  | { kind: 'CrashPrinter'; name: string }
  | { kind: 'CrashTerminal'; owner: string }
  | { kind: 'CleanTerminal'; owner: string }
  | { kind: 'CopyMail'; owner: string; sender: string }
  | { kind: 'FindMails'; owner: string; n: number }
  | { kind: 'Passwords'; name: string }
  | { kind: 'CleanSecurity' }
  | { kind: 'CamRec'; fname: string }
  | { kind: 'CleanCriminal'; name: string }
  | { kind: 'Spy'; name: string }
  | { kind: 'CompromiseMail'; owner: string }
  | { kind: 'FalsifyCam'; sector: string }
  | { kind: 'SpyCam' }
  | { kind: 'Arrest'; name: string }
  | { kind: 'CorruptDisplay'; place: string }
  | { kind: 'OverwriteFiles'; owner: string; ext: string }
  | { kind: 'GameHack'; game: string; serv: string; char: string }
  | { kind: 'InfectNet'; v: string }
  | { kind: 'GetVirus'; v: string; ext: string; n: number }
  | { kind: 'Tutorial' }
  | { kind: 'TutorialDelete'; ext: string; n: number }
  | { kind: 'TutorialBypass'; f: string }
  | { kind: 'TV'; tvFrom: string; tvTo: string }
  | { kind: 'TVCrash'; tv: string }
  | { kind: 'TVTheft'; tv: string; program: string };

export interface StolenCard {
  id: string;
  holder: string;
  number: string;
  amount: number;
}

export interface MissionData {
  seed: number;
  corp: string;
  color: number;
  colorHex: string;
  short: string;
  details: string;
  prime: number;
  bonus: number;
  type: MissionPattern;
  xp: number;
  gl: number;
  cards: StolenCard[];
}

export type FileEffectType =
  | 'E_SkipAction'
  | 'E_Shield'
  | 'E_CShield'
  | 'E_Gathered'
  | 'E_Disabled'
  | 'E_Immune'
  | 'E_Counter'
  | 'E_PackMoney'
  | 'E_PackMana'
  | 'E_PackLife'
  | 'E_Revenge'
  | 'E_Weaken'
  | 'E_Encoded'
  | 'E_Exploit'
  | 'E_Copy'
  | 'E_Corrupt'
  | 'E_Dot'
  | 'E_DotLength'
  | 'E_Splash'
  | 'E_Tag'
  | 'E_Masked'
  | 'E_Target'
  | 'E_CustomInfected';

export type UserEffectType =
  | 'UE_Shield'
  | 'UE_Combo'
  | 'UE_Furtivity'
  | 'UE_MoveFurtivity'
  | 'UE_Charge'
  | 'UE_DamageBurst'
  | 'UE_SilentDeath';

export interface FileNodeState {
  id: number;
  key: string; // e.g. 'file.core', 'file.control', 'file.antivir', 'folder', etc.
  name: string;
  ext: string;
  isFolder: boolean;
  parentId: number | null;
  childrenIds: number[];
  size: number;
  life: number;
  lifeTotal: number;
  deleted: boolean;
  password: string | null;
  avKey: string | null;
  content: string;
  embed: string | null;
  cardData: StolenCard | null;
  isMissionTarget: boolean;
  infectedByVirus: string | null;
  effects: Partial<Record<FileEffectType, number>>;
}

export interface SystemState {
  nodeId: number;
  name: string;
  owner: string;
  ip: string;
  patternName: string;
  mpass: string;
  crashed: boolean;
  corrupted: boolean; // fl_auth
  speed: number;
  avDanger: number;
  rootFolderId: number;
  files: Record<number, FileNodeState>;
}

export interface NetNodeState {
  id: number;
  x: number;
  y: number;
  type: NodeType;
  dist: number;
  links: number[];
  pathFromEntrance: number[];
  visible: boolean;
  isMissionTarget: boolean;
  siblingLockTargetId: number | null;
  system: SystemState | null;
}

export interface DeckLoadout {
  id: string;
  name: string;
  capacity: number;
  isFavorite: boolean;
  content: string[];
}

export interface SimpleFile {
  id?: string;
  name: string;
  content: string;
  embed: string | null;
  copiedAt?: string;
}

export interface MissionInitParams {
  missionKey: string;
  seed: number;
  gl: number;
  mission: MissionData;
  cards?: string[];
  ownedViruses?: Record<string, number>;
  decks: DeckLoadout[];
  chipset: string | null;
  isChallenge: boolean;
  biosLevel: number;
  tries: number;
  profile: {
    username: string;
    level: number;
    leet: boolean;
    adult: boolean;
    cfg: string;
    sfx: boolean;
    ambiant: boolean;
    beat: boolean;
    lang: LangCode;
  };
}

export type GoalId =
  | 'missions_fulfilled'
  | 'firsttry'
  | 'av'
  | 'crash'
  | 'corrup'
  | 'log'
  | 'passwd'
  | 'eextra'
  | 'mextra'
  | 'cards_redeemed';

export interface MissionEndSummary {
  missionKey: string;
  seed: number;
  gl: number;
  isChallenge: boolean;
  scoutRun: boolean;
  success: boolean;
  kills: number;
  remainingSec: number;
  valuables: string[];
  copiedFiles: SimpleFile[];
  stolenCards: StolenCard[];
  goals: Partial<Record<GoalId, number>>;
  score: number;
}
