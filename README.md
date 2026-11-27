# Intrusion // Édition Eternaltwin (v2.0)

Préservation et refonte **TypeScript** du jeu de hacking tactique **Intrusion** créé par **[Motion-Twin](https://motion-twin.com/)** (2011), hébergé à titre **strictement non commercial** par l'organisation communautaire **[Eternaltwin](https://eternaltwin.org)**.

---

## Architecture Générale du Monorepo

* **`packages/shared` (`@intrusion/shared`)** : cœur déterministe partagé sans dépendance I/O — générateur pseudo-aléatoire Parker-Miller-Carta 1:1, parseurs XML & DSL bilingues (`fr` / `en`), génération procédurale des contrats (`MissionGen`) et réseaux `11×11` (`NetworkGen`), moteur de simulation (`MissionSession`), et schémas de validation **Zod**.
* **`packages/server` (`@intrusion/server`)** : serveur HTTP **Hono** + **Zod** + **PostgreSQL** (`pg`), authentification **OAuth 2.0 Eternaltwin** centralisée, sessions `HttpOnly` hachées en `SHA-256`, gestion multi-decks (1 à 4), Hackstore, BIOS, Disque Dur (marché noir dynamique, fichiers copiés, cartes détournées) et Challenges Quotidiens classés (niveaux 5, 7, 9).
* **`packages/client` (`@intrusion/client`)** : interface **React 19 + Vite 6** reproduisant fidèlement le thème **Classique** (`src/classic/`), avec assainissement DOM strict (`SafeHtml`) et mixeur audio.
* **`packages/engine`** : code Haxe du moteur tactique compilé vers `assets/www/intrusion-engine.js`.
* **`assets/`** : catalogues XML bilingues (`fr`/`en`), sprites, icônes, polices, 100 portraits et 43 pistes audio originales de Motion-Twin (voir [`assets/LICENSE.md`](./assets/LICENSE.md)).
* **`legacy/`** : archive historique du code Haxe d'origine conservée à titre de référence patrimoniale.

---

## Installation & Démarrage Rapide

### Prérequis
* **Node.js 22+** (compatible `process.loadEnvFile` natif) et **npm 10+**.
* **PostgreSQL 14+** pour l'environnement de production (et optionnellement en développement local ; un mode PostgreSQL embarqué `pglite://` est disponible hors-ligne en développement et pour `npm test`).

### 1. Installation
```bash
npm install
cp .env.example .env
```

### 2. Base de données PostgreSQL & Authentification Eternaltwin (Katal)
* **Production / Staging (`NODE_ENV=production` / `APP_ENV=production`) :**
  * Connexion **PostgreSQL** obligatoire via `DATABASE_URL` (`postgresql://...`) ou les variables Katal séparées (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`).
  * URL publique résolue depuis `SELF_URL` / `SELF_API_URL` (ou `PUBLIC_URL`), calculant automatiquement le callback OAuth `${SELF_URL}/api/auth/eternaltwin/callback` si `ETERNALTWIN_CALLBACK_URL` est omis.
  * L'authentification passe **exclusivement** par le serveur OAuth 2.0 d'**Eternaltwin** (`ETERNALTWIN_URL`, `ETERNALTWIN_CLIENT_ID`, `ETERNALTWIN_CLIENT_SECRET`). Aucune donnée personnelle autre que l'identifiant et le pseudonyme Eternaltwin n'est collectée ni stockée ; le jeton `access_token` OAuth n'est jamais persisté ni journalisé.
* **Développement local (`NODE_ENV=development`) :**
  * Connexion à une base PostgreSQL locale (`DATABASE_URL=postgresql://...`) ou au moteur PostgreSQL embarqué sur disque (`DATABASE_URL=pglite://./data/pgdata`). Si une ancienne sauvegarde locale `data/intrusion.sqlite` est présente, elle est importée automatiquement une première fois vers PostgreSQL (ou à la demande via `npm run db:migrate-local`, nécessite Node.js 22.5+).
  * Si aucun client OAuth Eternaltwin n'est renseigné (ou si `ETERNALTWIN_DEV_AUTH=true`), un simulateur d'identité locale **sans mot de passe** (ou le serveur OAuth simulé `npm run dev:etwin`) permet de tester l'application hors-ligne sur `http://localhost:5173` / `http://localhost:8001`.

### 3. Commandes Principales
```bash
# Exécuter la suite de tests automatisés (Vitest : shared + server sur PostgreSQL embarqué)
npm test

# Développement avec rechargement à chaud (Client Vite :5173 + API Hono :8001)
npm run dev

# (Optionnel) Lancer le serveur OAuth 2.0 Eternaltwin simulé en local (:8002)
npm run dev:etwin

# (Optionnel) Ré-importer manuellement une ancienne base locale data/intrusion.sqlite vers PostgreSQL
npm run db:migrate-local

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
