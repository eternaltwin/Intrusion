---
name: gameplay-engine-sync
description: >-
  Coordinates gameplay bugfixes, balancing, and new mechanics across Intrusion's dual
  architecture: the deterministic TypeScript core (@intrusion/shared + @intrusion/server)
  and the Haxe/PixiJS tactical mission engine (packages/engine -> intrusion-engine.js).
  Use this skill whenever fixing mission bugs, modifying viruses/antiviruses/chipsets,
  changing network/mission procedural generation, altering scoring/rewards, or adding
  new gameplay mechanics.
---

# Évolution Gameplay & Synchronisation TS <-> Haxe

Intrusion sépare la méta-progression/génération procédurale (**TypeScript**) de l'exécution tactique temps réel en mission (**Haxe / PixiJS**). Utilise ce workflow pour faire évoluer le gameplay ou corriger un bug sans désynchroniser le client et le serveur.

## 1. Cartographie de la Boucle de Mission

Comprendre où vit chaque responsabilité avant d'éditer :

1. **Génération & Contrat (`packages/shared/src/`)** :
   * `rng/Rand.ts` : PRNG déterministe Parker-Miller-Carta (`Rand.fromSeed(seed)`). Attention : modifier l'ordre des appels `Rand` change les réseaux générés pour une `seed` donnée (impacte les Challenges Quotidiens).
   * `generator/MissionGen.ts` & `generator/NetworkGen.ts` : génération des contrats et de la grille réseau `11×11` à partir de `seed` + catalogues XML.
   * `engine/MissionSession.ts` : logique et structures de session côté TypeScript.
   * `types/game.ts` & `schemas/api.ts` : contrats TypeScript (`MissionInitParams`, `MissionEndSummary`, `VirusDef`, `ChipsetDef`, etc.) et validation **Zod** des payloads API.
2. **Pont Client React <-> Moteur Haxe (`packages/client/src/classic/MissionPlayView.tsx`)** :
   * Au lancement d'une mission, React injecte `window.__INTRUSION_CONFIG__ = init` (`MissionInitParams`) et monte le canvas via `window.IntrusionEngine.mount(canvas)`.
   * En fin de mission, Haxe appelle `window.__INTRUSION_ON_END__(raw)` (`EngineRawSummary` : `success`, `kills`, `remainingSec`, `valuables`, `copiedFiles`, `goals`).
   * `MissionPlayView.tsx` transforme ce résumé en `MissionEndSummary` et l'envoie à `POST /api/missions/:key/end`.
   * Le moteur Haxe injecte aussi directement du HTML dans `#sideContent`, `#tutorial`, `#clientTipContent` et `#briefingContent` (`packages/engine/src/JSMain.hx`).
3. **Moteur Tactique en Mission (`packages/engine/src/`)** :
   * `Boot.hx`, `Manager.hx`, `JSMain.hx` : initialisation, pont JS, DOM latéral.
   * `VirusMan.hx` : effets et exécution de chaque virus (`id` du XML).
   * `AntivirMan.hx` : IA, déplacement, détection et riposte des antivirus.
   * `GNetwork.hx`, `GFileSystem.hx`, `FSNode.hx` : topologie réseau `11×11`, dossiers/fichiers, états des nœuds.
   * `UserTerminal.hx`, `Dock.hx`, `WinApp*.hx` : terminal joueur, deck actif, RAM (`cc`), carte et logs.
   * `Data.hx`, `Types.hx` : chargement des ressources XML embarquées à la compilation.
4. **Validation & Récompenses Serveur (`packages/server/src/app.ts`)** :
   * Vérifie la session de mission active, applique les règles chipset (ex: mode `scout` sans butin ni incrément d'essais), calcule argent/XP/score, persiste le butin (`valuables`, `copiedFiles`, Challenges Quotidiens) dans SQLite.

## 2. Usage de `legacy/` selon l'Objectif

* **Correction de bug / Phase 1 (fidélité)** : Consulter `legacy/client/`, `legacy/com/` ou `legacy/website/` en **lecture seule** pour vérifier comment Motion-Twin gérait un cas limite d'origine. Ne jamais modifier `legacy/` (sauf `legacy/xml/` tant que `engine.hxml` embarque ces fichiers).
* **Nouvelle mécanique / Phase 2 (évolution)** : Ne pas se brider par `legacy/`. Concevoir proprement l'évolution de bout en bout à travers `shared` -> `engine` -> `client` -> `server`.

## 3. Workflow d'Ajout ou Modification d'une Mécanique (ex: Nouveau Virus / Chipset / Objectif)

Suivre cet ordre exact pour éviter les erreurs de build ou de désynchronisation :

1. **Données XML (`xml-dsl-catalog`)** :
   * Définir l'entrée en `fr` et `en` dans `assets/xml/` **et** synchroniser `legacy/xml/` (tant que `packages/engine/engine.hxml` embarque `../../legacy/xml/*`).
2. **Types & Schémas (`@intrusion/shared`)** :
   * Mettre à jour `packages/shared/src/types/game.ts`, `xmlLoaders.ts`, les générateurs (`MissionGen.ts` / `NetworkGen.ts` / `MissionSession.ts`) et `schemas/api.ts` si le payload `MissionInitParams` ou `MissionEndSummary` évolue.
   * Compiler immédiatement le package partagé : `npm run build:shared`.
3. **Moteur Tactique Haxe (`packages/engine`)** :
   * Implémenter le comportement en mission dans les classes `.hx` concernées (`VirusMan.hx`, `AntivirMan.hx`, `UserTerminal.hx`, `Data.hx`, etc.).
   * Si le contrat `window.__INTRUSION_CONFIG__` ou `window.__INTRUSION_ON_END__` change, aligner `packages/engine/src/` et `packages/client/src/classic/MissionPlayView.tsx`.
   * Recompiler le bundle moteur depuis `packages/engine` :
     ```bash
     haxe engine.hxml
     ```
     *(Génère `assets/www/intrusion-engine.js` — vérifier que le binaire `haxe` et les haxelibs listées dans `engine.hxml` sont installés sur la machine ; sinon signaler à l'utilisateur la commande exacte à lancer).*
4. **Serveur & UI React (`@intrusion/server` & `@intrusion/client`)** :
   * Mettre à jour les règles d'achat/équipement/validation dans `packages/server/src/app.ts`.
   * Mettre à jour les vues dans `packages/client/src/classic/` (`StoreView.tsx`, `DecksView.tsx`, `MissionsView.tsx`, `MissionEndView.tsx`, `TooltipContext.tsx`).
5. **Tests & Build Global** :
   * Ajouter/adapter les tests Vitest dans `packages/shared/test/` et `packages/server/test/`.
   * Exécuter `npm test` puis `npm run build`.
