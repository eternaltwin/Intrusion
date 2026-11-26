# Intrusion // Édition Eternaltwin (v2.0)

Préservation et refonte **TypeScript** du jeu de hacking tactique **Intrusion** créé par **[Motion-Twin](https://motion-twin.com/)** (2011), hébergé à titre **strictement non commercial** par l'organisation communautaire **[Eternaltwin](https://eternaltwin.org)**.

---

## Architecture Générale du Monorepo

* **`packages/shared` (`@intrusion/shared`)** : cœur déterministe partagé sans dépendance I/O — générateur pseudo-aléatoire Parker-Miller-Carta 1:1, parseurs XML & DSL bilingues (`fr` / `en`), génération procédurale des contrats (`MissionGen`) et réseaux `11×11` (`NetworkGen`), moteur de simulation (`MissionSession`), et schémas de validation **Zod**.
* **`packages/server` (`@intrusion/server`)** : serveur HTTP **Hono** + **Zod** + **SQLite** (`node:sqlite` natif Node.js 22+, zéro service externe requis hors Eternaltwin), authentification **OAuth 2.0 Eternaltwin** centralisée, sessions `HttpOnly` hachées en `SHA-256`, gestion multi-decks (1 à 4), Hackstore, BIOS, Disque Dur (marché noir dynamique, fichiers copiés, cartes détournées) et Challenges Quotidiens classés (niveaux 5, 7, 9).
* **`packages/client` (`@intrusion/client`)** : interface **React 19 + Vite 6** proposant le thème fidèle **Classique** (`src/classic/`) ainsi que le shell alternatif **Cyberdeck OS** (`src/os/`), assainissement DOM strict (`SafeHtml`) et mixeur audio.
* **`packages/engine`** : code Haxe du moteur tactique compilé vers `assets/www/intrusion-engine.js`.
* **`assets/`** : catalogues XML bilingues (`fr`/`en`), sprites, icônes, polices, 100 portraits et 43 pistes audio originales de Motion-Twin (voir [`assets/LICENSE.md`](./assets/LICENSE.md)).
* **`legacy/`** : archive historique du code Haxe d'origine conservée à titre de référence patrimoniale.

---

## Installation & Démarrage Rapide

### Prérequis
* **Node.js 22.5+** (requis pour le module natif `node:sqlite`) et **npm 10+**.

### 1. Installation
```bash
npm install
cp .env.example .env
```

### 2. Authentification Eternaltwin vs Développement Local
* **Production (`NODE_ENV=production`) :** L'authentification passe **exclusivement** par le serveur OAuth 2.0 d'**Eternaltwin** (`ETWIN_URL`, `ETWIN_CLIENT_ID`, `ETWIN_CLIENT_SECRET`, `ETWIN_CALLBACK_URL`). Aucune donnée personnelle autre que l'identifiant et le pseudonyme Eternaltwin n'est collectée ni stockée ; le jeton `access_token` OAuth n'est jamais persisté ni journalisé.
* **Développement local (`NODE_ENV=development`) :** Si aucun client OAuth Eternaltwin n'est renseigné (ou si `ETWIN_DEV_AUTH=true`), un simulateur d'identité locale **sans mot de passe** permet de tester l'application hors-ligne sur `http://localhost:5173` / `http://localhost:8001`.

### 3. Commandes Principales
```bash
# Exécuter la suite de tests automatisés (Vitest : shared + server)
npm test

# Développement avec rechargement à chaud (Client Vite :5173 + API Hono :8001)
npm run dev

# Compiler tous les workspaces pour la production
npm run build

# Démarrer le serveur de production (sert l'API + le client compilé sur PORT=8001)
npm start
```

---

## Contribution & Sécurité

* **Contribuer :** Consultez [`CONTRIBUTING.md`](./CONTRIBUTING.md) pour les conventions d'architecture, l'obligation de tests avant mise en production, le code de conduite communautaire et la politique stricte relative à l'IA générative (**zéro asset généré par IA**).
* **Sécurité :** Consultez [`SECURITY.md`](./SECURITY.md). Toute faille de sécurité doit être signalée **sans délai et en privé à l'équipe Eternaltwin** avant toute divulgation publique.

---

## Licences & Crédits

* **Usage strictement non commercial :** Projet hébergé par **[Eternaltwin](https://eternaltwin.org)** avec l'aimable autorisation patrimoniale de **Motion-Twin**. Aucun financement autre que la plateforme officielle d'Eternaltwin n'est autorisé.
* **Code source (`packages/*`) :** Distribué sous licence **[GNU AGPLv3](./LICENSE.md)** (`AGPL-3.0-or-later`).
* **Assets originaux Motion-Twin (`assets/`, `legacy/`) :** Propriété de **Motion-Twin** (&copy; 2011), distribués sous licence **[CC-BY-NC-SA 4.0](./assets/LICENSE.md)**.
* **Bibliothèques tierces :** Détail complet des licences et attributions dans [`NOTICE.md`](./NOTICE.md).
