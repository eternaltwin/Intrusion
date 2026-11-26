# Guide de Contribution — Intrusion (Eternaltwin)

Merci de contribuer à la préservation et à l'évolution d'**Intrusion** au sein d'**[Eternaltwin](https://eternaltwin.org)** ! Toute contribution implique le respect intégral des règles ci-dessous.

---

## 1. Respect de la Communauté & Code de Conduite

* Maintenez en toutes circonstances un cadre **respectueux, inclusif et bienveillant** envers les autres contributeurs, les joueurs et l'équipe Eternaltwin.
* Tout comportement discriminatoire, harcelant ou toxique entraîne l'exclusion immédiate du projet.

---

## 2. Règles sur les Licences & l'IA Générative

* **Usage non commercial strict :** Le projet crédite **Motion-Twin** et ne peut comporter aucune monétisation ni appel à financement hors de la plateforme officielle Eternaltwin.
* **Code source (`AGPL-3.0-or-later`) vs Assets (`CC-BY-NC-SA 4.0`) :** Toute réutilisation de bibliothèque ou ressource tierce doit être compatible avec la licence du projet et créditée explicitement dans [`NOTICE.md`](./NOTICE.md).
* **Assets de jeu — Zéro IA générative (Interdiction stricte) :** L'utilisation d'IA générative pour produire des graphismes, sprites, icônes, illustrations, musiques, sons ou textes narratifs **n'est pas tolérée**. Tous les assets doivent être créés par des humains ou provenir des archives autorisées de Motion-Twin / sources sous licence explicite compatible.
* **Assistance IA au code :** Tolérée uniquement à condition que :
  1. l'auteur comprenne intégralement le code soumis, son fonctionnement et ses implications ;
  2. il en assume l'entière responsabilité (bugs, sécurité, dette technique) comme s'il l'avait écrit lui-même ;
  3. chaque Pull Request fasse l'objet d'une **relecture humaine attentive** avant fusion.

---

## 3. Conventions Techniques & Architecture

Le monorepo repose sur **Node.js 22+** et les workspaces npm :

* `packages/shared` : logique pure et déterministe partagée (PRNG, parseurs XML/DSL, génération procédurale, schémas Zod). Aucune dépendance DOM ni I/O serveur.
* `packages/server` : API HTTP **Hono**, validation systématique des entrées via **Zod**, requêtes préparées **SQLite** (`node:sqlite`), authentification **OAuth 2.0 Eternaltwin** exclusive.
* `packages/client` : application **React 19 + TypeScript + Vite 6** (interface fidèle Classique + shell Cyberdeck). Toujours passer par `SafeHtml` pour l'affichage des fragments HTML de missions.
* `packages/engine` : moteur tactique Haxe compilé vers `assets/www/intrusion-engine.js`.

### Règles Sécurité & Données Personnelles
* **Identité Eternaltwin exclusive :** Ne jamais réintroduire de comptes locaux par mot de passe ni collecter d'e-mail ou données personnelles hors du profil OAuth Eternaltwin consenti (`id` et `display_name`).
* **Protection des tokens :** Les `access_token` OAuth Eternaltwin ne doivent jamais être journalisés dans les logs, exposés au client, ni stockés en clair en base de données. Les jetons de session applicatifs sont hachés avec `SHA-256` avant persistance SQLite.

---

## 4. Workflow de Développement & Tests Obligatoires

Tout changement significatif doit être couvert par des tests automatisés et vérifié avant fusion ou mise en production :

```bash
# 1. Installer les dépendances
npm install

# 2. Exécuter la suite complète de tests (shared + server)
npm test

# 3. Vérifier la compilation TypeScript et le bundle de production
npm run build
```

1. Créez une branche dédiée depuis `dev` (`git checkout -b feat/ma-fonctionnalite` ou `fix/mon-correctif`).
2. Ajoutez ou mettez à jour les tests dans `packages/shared/test/` ou `packages/server/test/`.
3. Vérifiez que `npm test` et `npm run build` passent sans erreur ni avertissement.
4. Ouvrez une Pull Request claire décrivant le contexte, les changements et les vérifications effectuées.

> **Impact infrastructure :** Toute évolution majeure impactant la charge serveur, le stockage SQLite ou ajoutant une dépendance externe doit être validée en amont avec le chef de projet et communiquée à l'équipe Eternaltwin avant déploiement.
