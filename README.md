# Intrusion // Cyberdeck Edition (v2.0)

Refonte intégrale 100 % **TypeScript** du jeu de hacking tactique **Intrusion** (Motion-Twin, 2011).

## Architecture Monorepo

- **`packages/shared` (`@intrusion/shared`)** : PRNG Parker-Miller-Carta fidèle 1:1, parseurs XML & DSL (`fr` / `en`), générateurs procéduraux (`MissionGen`, `NetworkGen` `11×11`), et moteur de simulation temps réel déterministe (59 virus, 19 antivirus, 13 chipsets, CLI `.hackrc`, tutoriels Circé).
- **`packages/server` (`@intrusion/server`)** : API **Hono** + **Zod** + **SQLite** (`node:sqlite` natif Node 22, zéro Redis), authentification sécurisée (`scrypt` + sessions `HttpOnly`), multi-decks (1 à 4), Hackstore + BIOS, Disque Dur (marché noir dynamique, fichiers copiés, cartes bancaires), et Challenge Quotidien classé.
- **`packages/client` (`@intrusion/client`)** : Shell **Cyberdeck OS** plein écran (**Vite 6 + React 19 + Tailwind CSS v4**), scène tactique hybride **PixiJS v8 HiDPI** + HUD DOM ultra-net, et mixeur audio 3 pistes.
- **`assets/`** : Données XML bilingues, icônes, sprites, 100 portraits et 43 pistes audio historiques.
- **`legacy/`** : Archive complète du code Haxe d'origine conservée pour référence.

## Démarrage Rapide (Node.js 22+)

```bash
# Installer les dépendances
npm install

# Lancer la suite de tests automatisés (Vitest)
npm test

# Compiler pour la production et démarrer sur http://localhost:8001
npm run build
npm start

# Développement avec rechargement à chaud (Vite HMR sur :5173 + API Hono sur :8001)
npm run dev
```
