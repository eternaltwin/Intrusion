# Politique de Sécurité — Intrusion (Eternaltwin)

## Signalement d'une Vulnérabilité (Divulgation Responsable)

**Ne publiez jamais une faille de sécurité dans une Issue ou Pull Request publique.**

Toute vulnérabilité découverte sur l'application **Intrusion** (ou concernant la manipulation des jetons OAuth / sessions) doit être **signalée sans délai en privé à l'équipe Eternaltwin** (ainsi qu'au chef de projet via le canal officiel Eternaltwin sur Discord), **avant toute divulgation publique**.

* Plateforme Eternaltwin : <https://eternaltwin.org>
* Organisation GitHub officielle : <https://github.com/eternaltwin>

---

## Engagements Sécurité & Données Personnelles

1. **Authentification OAuth 2.0 Eternaltwin centralisée :**
   * En production (`NODE_ENV=production`), toute authentification passe exclusivement par le serveur OAuth d'Eternaltwin (`/api/auth/etwin/login` & `/api/auth/etwin/callback`) avec validation cryptographique anti-CSRF du paramètre `state` (`timingSafeEqual`).
   * Le mode de connexion simulé sans mot de passe (`/api/auth/dev-login`) est strictement bloqué en production (`HTTP 403`).
2. **Minimisation stricte des données personnelles :**
   * Seuls l'identifiant technique Eternaltwin (`etwin_user_id`) et le pseudonyme public (`display_name`) fournis par `/api/v1/auth/self` après accord de l'utilisateur sont stockés.
   * Aucun mot de passe, adresse e-mail, adresse IP persistante ou traceur tiers n'est stocké en base de données.
3. **Manipulation sécurisée des jetons :**
   * Le jeton `access_token` OAuth reçu d'Eternaltwin est utilisé uniquement en mémoire vive le temps d'interroger `/api/v1/auth/self`, puis immédiatement détruit : il n'est **jamais stocké en base de données, jamais placé dans un cookie ou une URL, et jamais écrit dans les logs**.
   * Les cookies de session applicatifs (`intrusion_sid`) utilisent `HttpOnly`, `SameSite=Lax` et `Secure` (en HTTPS / production), et seul leur condensat `SHA-256` (`token_hash`) est stocké dans SQLite.
4. **Défense en profondeur :**
   * Validation systématique des entrées entrantes via schémas **Zod** et requêtes SQL préparées.
   * Protection CSRF par vérification des en-têtes `Origin` / `Sec-Fetch-Site` sur toutes les mutations API.
   * Limitation de débit (rate-limiting) sur les routes d'authentification et l'API.
   * En-têtes HTTP de sécurité (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`) et assainissement DOM par liste blanche (`SafeHtml`).
