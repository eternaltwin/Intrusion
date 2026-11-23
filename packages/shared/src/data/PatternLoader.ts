import { Rand } from '../rng/Rand.js';

export interface PatternContent {
  folders: string[];
  files: string[];
}

export type ParsedPatternMap = Map<string, string[]>;

export function parsePatternMap(raw: string): ParsedPatternMap {
  const patterns = new Map<string, string[]>();
  let currentKey: string | null = null;

  for (const rawLine of raw.split('\n')) {
    const cleaned = rawLine.replace(/\r/g, '');
    const trimmed = trimPatternLine(cleaned).toLowerCase();
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    if (cleaned.charAt(0) !== '\t') {
      currentKey = trimmed;
      if (!patterns.has(currentKey)) {
        patterns.set(currentKey, []);
      }
    } else {
      if (currentKey === null) {
        throw new Error(`[PatternLoader] unexpected indented entry '${trimmed}'`);
      }
      const entry = trimPatternLine(trimLeadingTabs(cleaned)).toLowerCase();
      if (entry) {
        patterns.get(currentKey)!.push(entry);
      }
    }
  }
  return patterns;
}

function trimLeadingTabs(str: string): string {
  let i = 0;
  while (i < str.length && str.charAt(i) === '\t') i++;
  return str.slice(i);
}

function trimPatternLine(str: string): string {
  let start = 0;
  while (start < str.length && str.charAt(start) === ' ') start++;
  let end = str.length;
  while (end > start && (str.charAt(end - 1) === ' ' || str.charAt(end - 1) === '\t')) end--;
  return str.slice(start, end);
}

export class PatternLoader {
  public rseed: Rand;
  private readonly patterns: ParsedPatternMap;

  constructor(seed: number, rawOrParsed: string | ParsedPatternMap) {
    this.rseed = Rand.fromSeed(seed);
    this.patterns =
      typeof rawOrParsed === 'string' ? parsePatternMap(rawOrParsed) : rawOrParsed;
  }

  public exists(key: string): boolean {
    return this.patterns.has(key.toLowerCase());
  }

  public getContent(key: string): PatternContent {
    const k = key.toLowerCase();
    const list = this.patterns.get(k);
    if (!list) {
      throw new Error(`[PatternLoader] invalid pattern key '${k}'`);
    }
    const folders: string[] = [];
    const files: string[] = [];
    for (const item of list) {
      if (item.includes('/')) {
        folders.push(item);
      } else {
        files.push(item);
      }
    }
    return { folders, files };
  }

  public static getCount(rseed: Rand, key: string): number {
    const parts = key.toLowerCase().split(':');
    if (parts.length === 1) return 1;
    const min = parseInt(parts[0], 10);
    const max = parseInt(parts[1], 10);
    if (min === max) return Math.max(0, min);
    const n = rseed.random(max - min + 1) + min;
    return n <= 0 ? 0 : n;
  }

  public static cleanUpKey(key: string): string {
    const cleaned = key.toLowerCase().replace(/\+/g, '').replace(/"/g, '');
    const colonIdx = cleaned.lastIndexOf(':');
    return colonIdx >= 0 ? cleaned.slice(colonIdx + 1) : cleaned;
  }
}
