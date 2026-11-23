import { XMLParser } from 'fast-xml-parser';
import { parsePatternMap, PatternLoader } from './PatternLoader.js';
import { parseTextDsl, TextEngine } from './TextEngine.js';
import type {
  AntivirusDef,
  ChipsetDef,
  LangCode,
  TutorialStepDef,
  TutorialTrackId,
  ValuableDef,
  VirusCategory,
  VirusDef,
  VirusTarget,
} from '../types/game.js';

export interface RawXmlBundle {
  virus: string;
  antivirus: string;
  chipsets: string;
  valuables: string;
  langClient: string;
  tutorials: string;
  sysPatterns: string;
  texts: string;
  fsNames: string;
  names: string;
}

export interface TextEngineSet {
  texts: TextEngine;
  fsNames: TextEngine;
  names: TextEngine;
  patterns: PatternLoader;
}

export interface GameDataBundle {
  lang: LangCode;
  viruses: Map<string, VirusDef>;
  antiviruses: Map<string, AntivirusDef>;
  chipsets: Map<string, ChipsetDef>;
  valuables: Map<string, ValuableDef>;
  uiStrings: Map<string, string>;
  tutorials: Record<TutorialTrackId, TutorialStepDef[]>;
  rawDsl: {
    sysPatterns: string;
    texts: string;
    fsNames: string;
    names: string;
  };
  createTextEngines: (seed: number, adult?: boolean) => TextEngineSet;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function cleanInlineText(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}

export function loadVirusesXml(rawXml: string): Map<string, VirusDef> {
  const parsed = xmlParser.parse(rawXml);
  const root = parsed.virus ?? {};
  const map = new Map<string, VirusDef>();

  for (const catNode of asArray<any>(root.cat)) {
    const cat = String(catNode['@_id'] ?? 'utils') as VirusCategory;
    const catName = String(catNode['@_name'] ?? cat);

    for (const vNode of asArray<any>(catNode.v)) {
      const id = String(vNode['@_id']).toLowerCase();
      const name = vNode['@_name'] !== undefined ? String(vNode['@_name']) : id;
      const desc = cleanInlineText(typeof vNode === 'object' ? vNode['#text'] : vNode);
      const target = (vNode['@_t'] !== undefined ? String(vNode['@_t']) : '_file') as VirusTarget;
      const size = vNode['@_size'] !== undefined ? parseInt(String(vNode['@_size']), 10) : 1;
      const power = vNode['@_p'] !== undefined ? parseInt(String(vNode['@_p']), 10) : 0;
      const info = vNode['@_info'] !== undefined ? parseInt(String(vNode['@_info']), 10) : 0;
      const cc = vNode['@_cc'] !== undefined ? parseInt(String(vNode['@_cc']), 10) : 0;
      const uses = vNode['@_use'] !== undefined ? parseInt(String(vNode['@_use']), 10) : null;
      const price = vNode['@_pr'] !== undefined ? parseInt(String(vNode['@_pr']), 10) : 9999;
      const date = vNode['@_date'] !== undefined ? String(vNode['@_date']) : null;
      const level = vNode['@_l'] !== undefined ? parseInt(String(vNode['@_l']), 10) : 1;
      const recom = vNode['@_recom'] !== undefined;
      const start = vNode['@_start'] !== undefined;

      map.set(id, {
        id,
        name,
        desc,
        target,
        size,
        power,
        info,
        cc,
        uses,
        price,
        cat,
        catName,
        date,
        level,
        recom,
        start,
      });
    }
  }
  return map;
}

export function loadAntivirusesXml(rawXml: string): Map<string, AntivirusDef> {
  const parsed = xmlParser.parse(rawXml);
  const root = parsed.antivirus ?? {};
  const map = new Map<string, AntivirusDef>();

  for (const vNode of asArray<any>(root.v)) {
    const key = String(vNode['@_id']).toLowerCase();
    const diff = parseInt(String(vNode['@_diff'] ?? '0'), 10);
    const minLevel = parseInt(String(vNode['@_minLvl'] ?? '1'), 10);
    const max = vNode['@_max'] !== undefined ? parseInt(String(vNode['@_max']), 10) : 9999;
    const power = vNode['@_p'] !== undefined ? parseInt(String(vNode['@_p']), 10) : 0;
    const desc = cleanInlineText(typeof vNode === 'object' ? vNode['#text'] : vNode);

    map.set(key, {
      key,
      diff,
      minLevel,
      max,
      desc,
      power,
    });
  }
  return map;
}

export function loadChipsetsXml(rawXml: string): Map<string, ChipsetDef> {
  const parsed = xmlParser.parse(rawXml);
  const root = parsed.chipsets ?? {};
  const map = new Map<string, ChipsetDef>();

  for (const cNode of asArray<any>(root.c)) {
    const id = String(cNode['@_id']).toLowerCase();
    const price = parseInt(String(cNode['@_pr'] ?? '0'), 10);
    const name = String(cNode['@_name'] ?? id);
    const level = cNode['@_l'] !== undefined ? parseInt(String(cNode['@_l']), 10) : 0;
    const desc = cleanInlineText(typeof cNode === 'object' ? cNode['#text'] : cNode);

    map.set(id, {
      id,
      price,
      name,
      desc,
      level,
    });
  }
  return map;
}

export function loadValuablesXml(rawXml: string): Map<string, ValuableDef> {
  const parsed = xmlParser.parse(rawXml);
  const root = parsed.valuables ?? {};
  const map = new Map<string, ValuableDef>();

  for (const vNode of asArray<any>(root.v)) {
    const id = String(vNode['@_id']).toLowerCase();
    const price = parseInt(String(vNode['@_v'] ?? '0'), 10);
    const name = String(vNode['@_name'] ?? id);
    const rare = String(vNode['@_rare'] ?? '0') === '1';

    map.set(id, {
      id,
      price,
      name,
      rare,
    });
  }
  return map;
}

export function loadLangClientXml(rawXml: string): Map<string, string> {
  const map = new Map<string, string>();
  // Preserve inner HTML tags like <strong>...</strong> inside <t id="...">...</t>
  const tagRegex = /<t\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(rawXml)) !== null) {
    const id = match[1];
    const body = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/__/g, '\n\n')
      .replace(/\|/g, '\n');
    map.set(id, body);
  }
  return map;
}

export function loadTutorialsXml(rawXml: string): Record<TutorialTrackId, TutorialStepDef[]> {
  const parsed = xmlParser.parse(rawXml);
  const root = parsed.tutorial ?? {};
  const out: Record<TutorialTrackId, TutorialStepDef[]> = {
    first: [],
    second: [],
    third: [],
  };

  for (const tNode of asArray<any>(root.t)) {
    const trackId = String(tNode['@_id']) as TutorialTrackId;
    if (!(trackId in out)) continue;

    const steps: TutorialStepDef[] = [];
    for (const sNode of asArray<any>(tNode.s)) {
      const id = String(sNode['@_id']);
      const auto = sNode['@_auto'] !== undefined;
      const rawY = sNode['@_y'];
      const y = rawY === '-1' ? 75 : rawY === '1' ? 290 : 150;
      const rawTxt = cleanInlineText(typeof sNode === 'object' ? sNode['#text'] : sNode);
      const text = rawTxt === '-' ? '' : rawTxt;
      steps.push({ id, auto, y, text });
    }
    out[trackId] = steps;
  }
  return out;
}

export function formatLang(
  uiStrings: Map<string, string>,
  key: string,
  vars?: Record<string, string | number>
): string {
  let str = uiStrings.get(key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      const cleanKey = k.startsWith('_') ? k.slice(1) : k;
      str = str.split(`::${cleanKey}::`).join(String(v));
    }
  }
  return str;
}

export function formatVirusDesc(v: VirusDef, combo: number | null = null): string {
  let str = v.desc;
  let effectiveCombo = combo;
  if (effectiveCombo === null) {
    const normalized = str.replace(/\]/g, '[');
    const parts = normalized.split('[');
    str = parts.filter((_, idx) => idx % 2 === 0).join('');
    effectiveCombo = 1;
  } else {
    str = str.replace(/\[/g, '').replace(/\]/g, '');
  }

  const replacements: Record<string, number> = {
    p: v.power,
    s: v.size,
    cc: v.cc,
    info: v.info,
    pcombo: v.power * effectiveCombo,
  };
  for (const [k, val] of Object.entries(replacements)) {
    str = str.split(`::${k}::`).join(String(val));
  }
  return str;
}

export function buildGameDataBundle(lang: LangCode, raw: RawXmlBundle): GameDataBundle {
  const viruses = loadVirusesXml(raw.virus);
  const antiviruses = loadAntivirusesXml(raw.antivirus);
  const chipsets = loadChipsetsXml(raw.chipsets);
  const valuables = loadValuablesXml(raw.valuables);
  const uiStrings = loadLangClientXml(raw.langClient);
  const tutorials = loadTutorialsXml(raw.tutorials);

  const parsedPatterns = parsePatternMap(raw.sysPatterns);
  const parsedAdult = {
    fsNames: parseTextDsl(raw.fsNames, 'xml_fsNames', true),
    texts: parseTextDsl(raw.texts, 'xml_texts', true),
    names: parseTextDsl(raw.names, 'xml_names', true),
  };
  const parsedSafe = {
    fsNames: parseTextDsl(raw.fsNames, 'xml_fsNames', false),
    texts: parseTextDsl(raw.texts, 'xml_texts', false),
    names: parseTextDsl(raw.names, 'xml_names', false),
  };

  const createTextEngines = (seed: number, adult = true): TextEngineSet => {
    const tables = adult ? parsedAdult : parsedSafe;
    const patterns = new PatternLoader(seed, parsedPatterns);
    const fsNames = new TextEngine(seed, tables.fsNames, 'xml_fsNames', adult, lang);
    fsNames.underscoreRep = true;

    const texts = new TextEngine(seed, tables.texts, 'xml_texts', adult, lang);
    texts.autoCaps = true;

    const names = new TextEngine(seed, tables.names, 'xml_names', adult, lang);
    names.autoCaps = true;

    texts.registerOtherXml(names);
    fsNames.registerOtherXml(names);

    return { texts, fsNames, names, patterns };
  };

  return {
    lang,
    viruses,
    antiviruses,
    chipsets,
    valuables,
    uiStrings,
    tutorials,
    rawDsl: {
      sysPatterns: raw.sysPatterns,
      texts: raw.texts,
      fsNames: raw.fsNames,
      names: raw.names,
    },
    createTextEngines,
  };
}
