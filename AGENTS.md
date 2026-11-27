# Intrusion (Édition Eternaltwin) — Instructions Agent

## Vision & Feuille de Route du Projet

1. **Phase 1 (Stabilisation & Remise en route)** : Correction de bugs, fiabilisation de la refonte TypeScript/Haxe et améliorations légères (QoL) fidèles au jeu original de Motion-Twin (2011). Le dossier `legacy/` sert de référence historique en lecture seule.
2. **Phase 2 (Évolution Gameplay & Contenu)** : Refonte et enrichissement profond du gameplay (nouveaux virus, chipsets, antivirus, types de missions, mécaniques tactiques et équilibrage). `legacy/` ne doit jamais brider une évolution voulue par le chef de projet.

---

## Règles Impératives — Charte Eternaltwin (`Charte-ET.pdf`)

Ces règles sont **absolues** et ne souffrent d'aucune exception :

* **Zéro IA générative pour les assets et textes narratifs (Art. 2)** :
  * Il est **strictement interdit** de générer par IA des sprites, icônes, illustrations, sons, musiques ou textes narratifs de jeu (`assets/`, `legacy/xml/`, dialogues, descriptions de missions/fichiers).
  * Ne jamais invoquer d'outil ou de sous-agent de génération d'images/médias pour créer des ressources du jeu. Tout asset ou texte narratif doit être fourni par un humain ou provenir des archives autorisées Motion-Twin (`CC-BY-NC-SA 4.0`).
* **Licences & Non-commercialité (Art. 1)** :
  * Usage strictement non commercial, créditant **Motion-Twin** et hébergé par **Eternaltwin** (aucun lien de monétisation ou financement externe).
  * Code sous `AGPL-3.0-or-later` (`LICENSE.md`), assets originaux sous `CC-BY-NC-SA 4.0` (`assets/LICENSE.md`).
  * Toute nouvelle dépendance tierce doit avoir une licence compatible AGPLv3 et être ajoutée dans `NOTICE.md`.
* **Authentification & Données Personnelles (Art. 4 & `SECURITY.md`)** :
  * En production (`NODE_ENV=production`), authentification **exclusivement** via OAuth 2.0 Eternaltwin (`/api/auth/etwin/*`). Ne jamais activer `/api/auth/dev-login` en production ni créer de comptes locaux par mot de passe.
  * Minimisation stricte des données : seuls `etwin_user_id` et `display_name` sont stockés. Aucune collecte d'e-mail, mot de passe, IP persistante ou télémétrie tierce.
  * Ne **jamais** stocker en base, exposer au client ou écrire dans les logs le jeton `access_token` OAuth Eternaltwin. Les jetons de session (`intrusion_sid`) sont stockés uniquement sous forme de hash `SHA-256`.
* **Infrastructure mutualisée (Art. 6)** :
  * Signaler explicitement à l'utilisateur tout changement impactant lourdement la charge serveur, le schéma/volume SQLite ou ajoutant une dépendance externe majeure (communication préalable requise auprès d'Eternaltwin).

---

## Architecture & Garde-fous Techniques

* **`packages/shared` (`@intrusion/shared`)** : Logique pure et déterministe uniquement (PRNG `Rand`, parseurs XML/DSL, `MissionGen`, `NetworkGen`, `MissionSession`, schémas Zod). **Zéro dépendance DOM, `node:fs` ou I/O réseau**. Après modification, recompiler avec `npm run build:shared` pour mettre à jour `dist/`.
* **`packages/server` (`@intrusion/server`)** : Hono + `node:sqlite` (Node.js 22.5+). Valider toutes les entrées entrantes avec **Zod**, utiliser exclusivement des requêtes SQL préparées et conserver les protections CSRF (`Origin` / `Sec-Fetch-Site`).
* **`packages/client` (`@intrusion/client`)** : React 19 + Vite 6. L'interface active se trouve dans `packages/client/src/classic/` (`packages/client/src/os/` n'est pas monté dans `App.tsx`). Tout fragment HTML issu des XML ou briefings doit passer par le composant `SafeHtml` (jamais de `dangerouslySetInnerHTML` brut).
* **`packages/engine`** : Moteur tactique Haxe + PixiJS compilé vers `assets/www/intrusion-engine.js` via `packages/engine/engine.hxml`. Toute modification de gameplay en mission doit rester synchronisée entre `packages/shared` et `packages/engine` (voir le skill `gameplay-engine-sync`).
* **Vérification obligatoire avant finalisation** : Exécuter `npm test` et `npm run build` après tout changement significatif de code.
