import { Rand } from '../rng/Rand.js';
import type { LangCode } from '../types/game.js';

const GROUP_SEP = '/\\';
const EXTERNAL_SEP = ':';
const VAR_SEP = '::';
const VOYEL_LOWERS = 'àâäéèëêîïìôöòûüùÿ';
const VOYEL_UPPERS = 'ÀÂÄÉÈËÊÎÏÌÔÖÒÛÜÙŸ';
const CONS_LOWERS = 'çñ';
const CONS_UPPERS = 'ÇÑ';
const SPECIAL_LETTERS = VOYEL_LOWERS + VOYEL_UPPERS + CONS_LOWERS + CONS_UPPERS;

export type ParsedTextMap = Map<string, string[]>;

export function parseTextDsl(raw: string, xmlName: string, adult = true): ParsedTextMap {
  if (!raw) {
    throw new Error(`No data for ${xmlName}`);
  }
  const texts = new Map<string, string[]>();
  let currentKey: string | null = null;

  for (const rawLine of raw.split('\n')) {
    const noCr = rawLine.replace(/\r/g, '');
    const trimmed = trimTextDsl(noCr);
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    if (noCr.charAt(0) === ' ') {
      throw new Error(`[${xmlName}] unexpected leading space around key ${currentKey}`);
    }

    if (noCr.charAt(0) !== '\t') {
      currentKey = trimmed.toLowerCase();
    } else {
      if (currentKey === null) {
        throw new Error(`[${xmlName}] unexpected indented entry: ${noCr}`);
      }
      let list = texts.get(currentKey);
      if (!list) {
        list = [];
        texts.set(currentKey, list);
      }
      let entry = trimmed;
      if (entry.includes('__adult__')) {
        if (!adult) continue;
        entry = entry.replace(/__adult__/g, '');
      }
      list.push(entry);
    }
  }
  return texts;
}

function trimTextDsl(str: string): string {
  let s = str.replace(/\r/g, '').replace(/\n/g, '');
  let start = 0;
  while (start < s.length && (s.charAt(start) === ' ' || s.charAt(start) === '\t')) start++;
  let end = s.length;
  while (end > start && (s.charAt(end - 1) === ' ' || s.charAt(end - 1) === '\t')) end--;
  s = s.slice(start, end);
  while (s.includes('  ')) {
    s = s.split('  ').join(' ');
  }
  return s.split(' ,').join(',');
}

export class TextEngine {
  public readonly xmlName: string;
  public rseed: Rand;
  public autoCaps = false;
  public underscoreRep = false;
  public lang: LangCode = 'fr';

  private readonly texts: ParsedTextMap;
  private tvars = new Map<string, string>();
  private readonly otherEngines: TextEngine[] = [];

  constructor(
    seed: number,
    rawOrParsed: string | ParsedTextMap,
    xmlName: string,
    adult = true,
    lang: LangCode = 'fr'
  ) {
    this.xmlName = xmlName;
    this.lang = lang;
    this.rseed = Rand.fromSeed(seed);
    this.texts =
      typeof rawOrParsed === 'string' ? parseTextDsl(rawOrParsed, xmlName, adult) : rawOrParsed;
  }

  public registerOtherXml(other: TextEngine): void {
    this.otherEngines.push(other);
  }

  public exists(key: string): boolean {
    return this.texts.has(key.toLowerCase());
  }

  public set(key: string, value: string, isName = false): void {
    let val = value;
    if (isName) {
      val = val
        .split('_')
        .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
    }
    this.tvars.set(key, val);
  }

  public resetVars(): void {
    this.tvars = new Map<string, string>();
  }

  public get(key: string, rs?: Rand, firstRecurs = true): string {
    const rng = rs ?? this.rseed;
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes(EXTERNAL_SEP)) {
      const [extName, extKey] = lowerKey.split(EXTERNAL_SEP);
      return this.getOtherXml(extName, extKey);
    }

    const list = this.texts.get(lowerKey);
    if (!list || list.length === 0) {
      throw new Error(`[${this.xmlName}] unknown reference '${lowerKey}'`);
    }

    let str = list[rng.random(list.length)];

    // 1. Expand %subkey%
    const pctParts = str.split('%');
    if (pctParts.length > 1) {
      let built = '';
      for (let idx = 0; idx < pctParts.length; idx++) {
        if (idx % 2 === 1) {
          const sub = this.get(pctParts[idx], rng, false);
          built += GROUP_SEP + sub + GROUP_SEP;
        } else {
          built += pctParts[idx];
        }
      }
      str = built;
    }

    // 2. Expand ¤ face portrait tags (NOTE: original Haxe draws fid even on last segment!)
    const faceParts = str.split('¤');
    {
      let built = '';
      for (let i = 0; i < faceParts.length; i++) {
        built += faceParts[i];
        const fid = rng.random(100) + 1;
        if (i < faceParts.length - 1) {
          built += `<img src='img_faces/${fid}.gif' alt='${fid}' class='face'/>`;
        }
      }
      str = built;
    }

    // 3. Expand # (digit 1..9)
    const digitParts = str.split('#');
    if (digitParts.length > 1) {
      let built = '';
      for (let i = 0; i < digitParts.length; i++) {
        built += digitParts[i];
        if (i < digitParts.length - 1) {
          built += String(rng.random(9) + 1);
        }
      }
      str = built;
    }

    // 4. Expand µ (lowercase letter a..z)
    const letterParts = str.split('µ');
    if (letterParts.length > 1) {
      let built = '';
      for (let i = 0; i < letterParts.length; i++) {
        built += letterParts[i];
        if (i < letterParts.length - 1) {
          built += String.fromCharCode(97 + rng.random(26));
        }
      }
      str = built;
    }

    // 5. Special tokens & ::vars::
    str = str.replace(/\*/g, ' ').replace(/€/g, '');
    str = this.replaceVars(str);

    // 6. Top-level linguistic post-processing
    if (firstRecurs) {
      str = this.applyLang(this.lang, str);
      str = str.split(GROUP_SEP).join('');
      if (this.autoCaps) {
        str = this.capitalize(str);
      }
      str = str
        .split(',.')
        .join('.')
        .split('""')
        .join('"')
        .split(', ?')
        .join('?')
        .split(', !')
        .join('!');
      if (this.underscoreRep) {
        str = str.replace(/_/g, ' ');
      }
      str = trimTextDsl(str);
      str = str.split('| ').join('|').split('|').join('\n').split('[PCT]').join('%');
    }

    return str;
  }

  private getOtherXml(xname: string, key: string): string {
    const target = xname.toLowerCase();
    for (const other of this.otherEngines) {
      if (other.xmlName.toLowerCase() === target) {
        return other.get(key);
      }
    }
    throw new Error(
      `[${this.xmlName}] external reference [${key}] not found in [${xname}]`
    );
  }

  private replaceVars(str: string): string {
    if (!str) return str;
    const parts = str.split(VAR_SEP);
    if (parts.length === 1) return str;
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        out += parts[i];
      } else {
        const val = this.tvars.get(parts[i]);
        if (val === undefined) {
          throw new Error(`[${this.xmlName}] unknown variable '${parts[i]}' in: ${str}`);
        }
        out += val;
      }
    }
    return out;
  }

  private applyLang(lang: string, str: string): string {
    if (lang !== 'fr') return str;
    const words = str.split(' ');
    let out = '';
    for (let i = 0; i < words.length; i++) {
      const wLower = words[i].toLowerCase();
      const next = words[i + 1];
      if (this.matchVoyelTransition(wLower, next, 'de')) {
        out += "d'";
      } else if (this.matchVoyelTransition(wLower, next, 'que')) {
        out += "qu'";
      } else if (this.matchVoyelTransition(wLower, next, 'du')) {
        out += "de l'";
      } else if (this.matchVoyelTransition(wLower, next, 'le')) {
        out += "l'";
      } else if (this.matchTransition(wLower, next, 'de', 'le')) {
        out += 'du';
        words[i + 1] = '';
      } else if (this.matchTransition(wLower, next, 'à', 'le')) {
        out += 'au';
        words[i + 1] = '';
      } else {
        out += words[i] + ' ';
      }
    }
    return out;
  }

  private matchTransition(w1: string, w2: string | undefined, v1: string, v2: string): boolean {
    if (w2 === undefined) return false;
    if (!w1.includes(GROUP_SEP) && !w2.includes(GROUP_SEP)) return false;
    const c1 = w1.toLowerCase().split(GROUP_SEP).join('');
    const c2 = w2.toLowerCase().split(GROUP_SEP).join('');
    return c1 === v1 && c2 === v2;
  }

  private matchVoyelTransition(w1: string, w2: string | undefined, v1: string): boolean {
    if (w2 === undefined) return false;
    if (!w1.includes(GROUP_SEP) && !w2.includes(GROUP_SEP)) return false;
    const c1 = w1.toLowerCase().split(GROUP_SEP).join('');
    const c2 = w2.split(GROUP_SEP).join('');
    return c1 === v1 && c2.length > 0 && this.isVoyel(c2.charAt(0));
  }

  private capitalize(str: string): string {
    if (!str) return str;
    const chars = Array.from(str);
    chars[0] = chars[0].toUpperCase();
    let out = '';
    let capNext = true;
    for (let ch of chars) {
      if (this.isLetter(ch)) {
        if (capNext) {
          ch = this.superUpper(ch);
          capNext = false;
        }
      }
      if (!Number.isNaN(parseInt(ch, 10))) {
        capNext = false;
      }
      out += ch;
      if (ch === '.' || ch === '?' || ch === '!' || ch === '|') {
        capNext = true;
      }
    }
    return out;
  }

  private isLetter(c: string): boolean {
    if (!c) return false;
    const code = c.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true;
    return SPECIAL_LETTERS.includes(c);
  }

  private isVoyel(c: string): boolean {
    const low = c.toLowerCase();
    return (
      low === 'a' ||
      low === 'e' ||
      low === 'i' ||
      low === 'o' ||
      low === 'u' ||
      low === 'y' ||
      VOYEL_LOWERS.includes(low) ||
      VOYEL_UPPERS.includes(low)
    );
  }

  private superUpper(c: string): string {
    const up = c.toUpperCase();
    if (up !== c) return up;
    const lowers = VOYEL_LOWERS + CONS_LOWERS;
    const uppers = VOYEL_UPPERS + CONS_UPPERS;
    const idx = lowers.indexOf(c);
    return idx >= 0 ? uppers.charAt(idx) : c;
  }
}
