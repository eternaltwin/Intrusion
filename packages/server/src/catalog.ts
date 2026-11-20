import fs from 'node:fs';
import path from 'node:path';
import { buildGameDataBundle, type GameDataBundle, type LangCode } from '@intrusion/shared';

const cache = new Map<string, GameDataBundle>();

export function getCatalog(assetsDir: string, lang: LangCode = 'fr'): GameDataBundle {
  const key = `${assetsDir}::${lang}`;
  if (cache.has(key)) return cache.get(key)!;

  const xmlDir = path.join(assetsDir, 'xml');
  const read = (file: string) => fs.readFileSync(path.join(xmlDir, file), 'utf8');

  const bundle = buildGameDataBundle(lang, {
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

  cache.set(key, bundle);
  return bundle;
}
