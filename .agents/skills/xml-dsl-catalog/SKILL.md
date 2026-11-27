---
name: xml-dsl-catalog
description: >-
  Guides editing, extending, and validating Intrusion's bilingual (fr/en) XML catalogs
  and custom indentation-based DSL files (virus, chipsets, antivirus, valuables,
  sysPatterns, texts, fsNames, names, tutorials, lang.client). Use this skill whenever
  reading, debugging, balancing, or adding game content in assets/xml/, legacy/xml/,
  or modifying parsers in packages/shared/src/data/.
---

# Catalogues XML & DSL Bilingues (`fr` / `en`)

Utilise ce guide dès que tu modifies les données de jeu (`virus`, `chipsets`, `antivirus`, `valuables`, textes, patterns réseau) ou les parseurs de `packages/shared/src/data/`.

## 1. Règle Charte — Contenu Narratif Humain Uniquement

* Conformément à l'Article 2 de `Charte-ET.pdf`, **ne jamais générer de textes narratifs, dialogues, noms de fichiers humoristiques ou briefings par IA**.
* Tu peux corriger des bugs de syntaxe XML/DSL, ajuster des valeurs numériques d'équilibrage, câbler des clés techniques ou intégrer mot pour mot les textes rédigés par l'utilisateur. Si un texte descriptif/narratif manque (`fr` ou `en`), place un marqueur explicite ou demande le texte exact à l'utilisateur.

## 2. Double Emplacement des XML (Piège Critique Serveur vs Haxe)

Les données XML sont consommées à **deux endroits distincts** :

1. **Serveur & Client React (`assets/xml/`)** :
   * Lu au démarrage par `packages/server/src/catalog.ts` (`getCatalog`) via `buildGameDataBundle` (`packages/shared/src/data/xmlLoaders.ts`).
   * Mis en cache en mémoire (`Map` dans `catalog.ts`) -> redémarrer le serveur après modification.
2. **Moteur Tactique Haxe (`legacy/xml/` embarqué à la compilation)** :
   * `packages/engine/engine.hxml` embarque les fichiers `../../legacy/xml/*.xml` via `-resource ...@xml_*` directement dans `assets/www/intrusion-engine.js` !
   * **Conséquence** : Tant que `engine.hxml` pointe vers `../../legacy/xml/`, toute modification d'un XML utilisé en mission (`virus`, `antivirus`, `chipsets`, `valuables`, `sysPatterns`, `lang.client`, `tutorials`, `texts`, `fsNames`, `names`) doit être **répercutée à l'identique dans `assets/xml/` ET `legacy/xml/`** (ou `engine.hxml` doit être redirigé vers `../../assets/xml/`), puis le moteur Haxe doit être recompilé (`haxe engine.hxml` dans `packages/engine/`).

## 3. Formats XML Standards (`packages/shared/src/data/xmlLoaders.ts`)

Toujours maintenir la **parité stricte des identifiants** entre la version française et la version anglaise :

| Donnée | Fichier FR | Fichier EN | Structure & Attributs Clés |
| :--- | :--- | :--- | :--- |
| **Virus** | `virus.xml` | `virus.en.xml` | `<cat id="..." name="..."><v id="..." name="..." pr="prix|-1" size="1" cc="coût_ram" p="puissance" info="0" use="nb_usages" t="_file\|_folder\|_net\|_none" l="niveau_min" start="1" recom="1">Desc</v></cat>` |
| **Antivirus** | `antivirus.xml` | `antivirus.en.xml` | `<v id="..." diff="difficulté" minLvl="1" max="9999" p="puissance">Desc</v>` |
| **Chipsets** | `chipsets.xml` | `chipsets.en.xml` | `<c id="..." pr="prix" name="..." l="niveau_min">Desc</c>` |
| **Valuables** | `valuables.xml` | `valuables.en.xml` | `<v id="..." v="valeur_vente" name="..." rare="0\|1"/>` |
| **UI Client** | `lang.client.fr.xml` | `lang.client.en.xml` | `<t id="cle">Texte avec <strong>HTML</strong>, __ (double saut), \| (saut), ::var::</t>` |
| **Tutoriels** | `tutorials.fr.xml` | `tutorials.en.xml` | `<t id="first\|second\|third"><s id="..." auto="1" y="-1\|0\|1">Texte ou -</s></t>` |

### Syntaxe des descriptions de virus (`formatVirusDesc`)
* Variables interpolées automatiquement : `::p::` (`power`), `::s::` (`size`), `::cc::` (`cc`), `::info::` (`info`), `::pcombo::` (`power * combo`).
* Blocs conditionnels de combo : le texte entre crochets `[...]` est masqué hors combo (`combo === null`) et affiché lorsqu'un combo est actif.

## 4. Formats DSL Indentation-Strict (`TextEngine.ts` & `PatternLoader.ts`)

Les fichiers `sysPatterns.xml`, `texts.{fr,en}.xml`, `fsNames.{fr,en}.xml` et `names.{fr,en}.xml` ne sont **pas** du XML balisé classique : ce sont des fichiers DSL sensibles aux **tabulations (`\t`)**.

### Règles de syntaxe impératives (sinon crash au démarrage)
1. **Clé de section** : Doit commencer **colonne 0** (ni tabulation `\t`, **ni espace `' '` en début de ligne** — `parseTextDsl` lève une exception immédiate `unexpected leading space` au moindre espace en colonne 0 !).
2. **Entrées sous une clé** : Doivent **obligatoirement commencer par au moins une vraie tabulation `\t`** (jamais d'espaces d'indentation).
3. **Commentaires** : Lignes commençant par `<!--`.

### Spécificités `TextEngine` (`texts`, `fsNames`, `names`)
* Marqueur `__adult__` : filtre automatiquement la ligne si le mode adulte est désactivé (`adult = false`).
* Variables `::var::`, groupes alternatifs séparés par `/\`, références inter-fichiers `names` via `:`.

### Spécificités `PatternLoader` (`sysPatterns.xml`)
* Clés de nœuds systèmes préfixées par `/` (ex: `/sys_printer`, `/sys_db`).
* Entrées indentées par `\t` :
  * Contient `/` -> sous-dossier référençant un autre pattern (ex: `\t/system_light`, `\t0:1:/oldmail`).
  * Sans `/` -> fichier terminal entre guillemets (ex: `\t"file.antivir"`, `\t-1:2:"file.lib"`).
  * Préfixe `min:max:` -> tirage aléatoire via `Rand` dans `[min, max]` (les valeurs `<= 0` donnent `0` occurrence, permettant une probabilité d'absence, ex: `-3:2:"file.video"`).

## 5. Procédure de Validation après Modification

1. Vérifier qu'aucune indentation par espaces n'a été introduite dans les fichiers DSL (`texts`, `fsNames`, `names`, `sysPatterns`).
2. Vérifier que chaque nouvel `id` existe à la fois en `fr` et en `en`.
3. Synchroniser `assets/xml/` et `legacy/xml/` si le moteur Haxe consomme le fichier modifié (et recompiler Haxe si applicable).
4. Lancer `npm test` (valide le chargement de `buildGameDataBundle` et la génération procédurale) puis `npm run build`.
