---
name: etwin-charter-audit
description: >-
  Audits code changes, pull requests, dependencies, and assets against the Eternaltwin
  Charter (Charte-ET.pdf), Katal production conventions, CONTRIBUTING.md, NOTICE.md, and
  SECURITY.md. Use this skill when preparing a PR or release, adding third-party packages
  or assets, modifying OAuth or session handling, changing PostgreSQL schemas, or when
  the user asks to check charter, deployment, or security compliance.
---

# Audit de Conformité — Charte Eternaltwin & Prod Katal

Exécute cette procédure pour vérifier qu'une branche, un diff ou une fonctionnalité respecte intégralement `Charte-ET.pdf`, les conventions d'hébergement Katal d'Eternaltwin, `CONTRIBUTING.md`, `NOTICE.md` et `SECURITY.md`.

## 1. Inspecter le périmètre des changements

1. Lister les fichiers modifiés et non suivis via `git status` et `git diff --stat`.
2. Identifier si les changements touchent :
   * `assets/` ou `legacy/xml/` (ressources artistiques, audio, textes narratifs),
   * `package.json` / `packages/*/package.json` (dépendances tierces),
   * `.env.example` / `packages/server/` (OAuth `ETERNALTWIN_*`, sessions, PostgreSQL, routes API),
   * `packages/client/` (rendu HTML, pied de page AGPLv3, formulaires d'auth).

## 2. Contrôles par Article de la Charte

### Article 1 — Licences & Non-commercialité
* **Crédits & AGPLv3 (§13)** : Vérifier que le lien vers le dépôt source (`https://github.com/eternaltwin/intrusion`) et les mentions Motion-Twin / Eternaltwin restent visibles dans l'interface (`ClassicLayout.tsx` / `AuthView.tsx`).
* **Dépendances tierces** : Si un paquet a été ajouté dans un `package.json`, vérifier :
  1. que sa licence est compatible avec `AGPL-3.0-or-later` (ex: MIT, ISC, BSD, Apache-2.0, LGPL/AGPL),
  2. qu'il est explicitement crédité dans `NOTICE.md` (Section 3).
* **Zéro monétisation** : Aucune référence à un paiement, don tiers, sponsoring ou publicité hors Eternaltwin.

### Article 2 — IA Générative (Tolérance Zéro sur les Assets)
* Vérifier tout fichier ajouté ou modifié dans `assets/img*`, `assets/sfx`, `assets/fonts`, `assets/xml` et `legacy/xml` :
  * Aucun sprite, portrait, son, musique ou texte narratif (`texts.*.xml`, `dialogs.*.xml`, `tutorials.*.xml`, descriptions narratives) ne doit avoir été généré par IA.
  * Si l'origine humaine ou la licence (`CC-BY-NC-SA 4.0` ou compatible créditée dans `assets/LICENSE.md`) d'un nouvel asset n'est pas confirmée par l'utilisateur, **bloquer et demander confirmation explicite**.

### Article 3 — Qualité, Architecture & Tests
* **Pureté `@intrusion/shared`** : Vérifier qu'aucun import `node:*`, `fs`, `fetch`, `window` ou `document` n'a été introduit dans `packages/shared/src/`.
* **Documentation** : Si l'installation, les variables `.env.example` ou l'architecture ont changé, vérifier que `README.md` et `CONTRIBUTING.md` sont à jour.
* **Validation automatisée** : Exécuter `npm test` puis `npm run build` et exiger zéro échec.

### Article 4 — Sécurité & Données Personnelles
* **Identité Eternaltwin exclusive & Conventions `.env` Katal** :
  * Les variables d'environnement OAuth et URL publique doivent supporter la convention Katal : `SELF_URL` / `SELF_API_URL` et le préfixe `ETERNALTWIN_*` (`ETERNALTWIN_URL`, `ETERNALTWIN_CLIENT_ID`, `ETERNALTWIN_CLIENT_SECRET`), jamais `ETWIN_*`.
  * `/api/auth/dev-login` doit rester strictement désactivé lorsque `NODE_ENV=production` ou `APP_ENV=production` (retour `403`).
  * Vérifier le schéma PostgreSQL (`packages/server/src/db/database.ts`) : aucune colonne stockant mot de passe, e-mail, IP persistante ou donnée personnelle hors `eternaltwin_user_id` et `display_name`.
* **Protection des secrets & jetons** :
  * Rechercher `access_token` dans `packages/server/` : il ne doit jamais passer dans `console.*`, un logger, une table PostgreSQL, une URL ou une réponse JSON client.
  * Les sessions (`intrusion_sid`) doivent utiliser un hash `SHA-256` en base et les attributs `HttpOnly`, `SameSite=Lax`, `Secure` (en prod).
* **Défense XSS / SQLi / CSRF** :
  * Aucune concaténation SQL brute dans `packages/server/` (requêtes paramétrées `$1, $2, ...` uniquement).
  * Toutes les routes entrantes mutantes validées par Zod (`@hono/zod-validator` ou `.safeParse`).
  * Rechercher `dangerouslySetInnerHTML` dans `packages/client/src/` : seul `packages/client/src/components/SafeHtml.tsx` est autorisé à l'utiliser après assainissement par liste blanche.

### Article 6 — Infrastructure Eternaltwin & PostgreSQL
* Vérifier que la production utilise exclusivement **PostgreSQL** (`pg` via `DATABASE_URL` ou `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`) — aucun usage de SQLite ni de `pglite://` autorisé en `NODE_ENV=production`.
* Si le diff introduit :
  * une nouvelle dépendance lourde ou binaire natif,
  * une tâche de fond coûteuse en CPU/RAM ou un pool de connexions PostgreSQL démesuré,
  * une migration PostgreSQL impactante ou augmentant fortement le volume de données,
  **ajouter un avertissement explicite** dans le rapport rappelant au chef de projet de prévenir l'équipe Eternaltwin sur Discord avant déploiement.

## 3. Format du Rapport d'Audit

Produire un résumé concis structuré ainsi :
* **Statut global** : `CONFORME` / `CONFORME AVEC AVERTISSEMENT INFRA` / `NON CONFORME (BLOQUANT)`
* **Points vérifiés** : Licences (`NOTICE.md`), Assets IA, Config Katal (`ETERNALTWIN_*` + PostgreSQL), OAuth/PII/Tokens, XSS/SQLi/Zod, Build & Tests.
* **Actions correctives requises** (avec liens vers les fichiers et lignes exactes si anomalie).
