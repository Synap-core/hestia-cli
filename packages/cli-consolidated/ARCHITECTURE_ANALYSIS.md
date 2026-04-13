# Architecture Analysis: Current State vs Desired State

## 🎯 VISION GLOBALE

**Objectif**: Un utilisateur peut en UNE SEULE COMMANDE déployer :
- 🧠 **Cerveau**: Synap (données + connaissances)
- ✋ **Mains**: OpenClaw (actions/agents)
- 💻 **Dev**: OpenCode (développement IA)
- 🌐 **Site**: Website de base extensible par l'IA

**Accès**: Domaine unique avec sous-domaines (ex: `user-domain.com`)

---

## ✅ ÉTAT ACTUEL (Ce qui existe)

### 1. Infrastructure Docker (EXCELLENT)
```yaml
# synap-backend/deploy/docker-compose.standalone.yml
Services déjà configurés:
  ✅ Backend API (Synap)
  ✅ Realtime (WebSocket)
  ✅ PostgreSQL + TimescaleDB
  ✅ Redis
  ✅ MinIO (stockage S3)
  ✅ Typesense (search)
  ✅ Ory Kratos (auth)
  ✅ Ory Hydra (OAuth2)
  ✅ Caddy (reverse proxy + SSL auto)
  ✅ OpenClaw (opt-in via --profile openclaw)
  ✅ Pod Agent (gestion à distance)
```

### 2. Intégration OpenClaw-OpenClaude-Synap (EXCELLENT)

**Dans `state-manager.ts`**:
```typescript
// Gère la synchro bidirectionnelle entre:
- Synap Backend (via API Hub Protocol)
- OpenClaude (~/.openclaude-profile.json)
- OpenClaw (~/.openclaw/config.json)

// Fichiers:
✅ OpenClaude profile: ~/.openclaude-profile.json
✅ OpenClaw config: ~/.openclaw/config.json
✅ Hestia config: ~/.hestia/config.yaml
```

### 3. Traefik Templates (EXISTE mais pas intégré)

**Fichiers trouvés**:
```
hestia-cli/packages/install/src/templates/
  ✅ traefik.yml
  ✅ traefik-docker-compose.yml
  ✅ pangolin-docker-compose.yml
```

### 4. Installation Scripts (EXISTE)

```bash
# Dans synap-backend/deploy/
✅ setup-openclaw.sh  # Setup automatique OpenClaw
✅ install.sh         # Installation générale
```

---

## ❌ GAPS CRITIQUES (Ce qui manque)

### Gap #1: Pas de "One-Click Deployment"

**Problème**: Aucune commande ne fait TOUT automatiquement.

**Actuellement**:
```bash
# L'utilisateur doit faire manuellement:
1. git clone synap-backend
2. cd deploy && cp .env.example .env
3. Générer tous les secrets
4. docker compose up -d
5. Setup OpenClaw séparément
6. Setup OpenClaude séparément
7. Configurer le domaine
8. Lier les 3 systèmes
```

**Devrait être**:
```bash
hestia deploy --domain mon-site.com --provider opencode
# Fait TOUT automatiquement
```

### Gap #2: Gestion de Domaine Non Automatisée

**Problème**: Aucun setup automatique de domaine + DNS.

**Actuel**:
- Caddy avec Let's Encrypt (automatique mais limité)
- Ou configuration manuelle Traefik

**Manque**:
- Génération automatique de sous-domaines
- Configuration DNS automatique
- Support Docuploy (que vous mentionnez)

### Gap #3: Pas de Website "Base" Généré

**Problème**: Aucun template de base pour le site web.

**Attendu**:
- Template Next.js/React avec Synap SDK
- Pages pré-configurées:
  - Landing page
  - Dashboard
  - Profile utilisateur
  - Search (Typesense)
- Composants réutilisables:
  - `@synap/ui-system`
  - `@synap/hooks`
  - `@synap/cell-runtime`

### Gap #4: Intégration OpenCode Inexistante

**Problème**: OpenCode ("@gitlawb/openclaude") est externalisé mais pas intégré.

**Actuel**:
```typescript
// Dans tsup.config.ts
external: ['@gitlawb/openclaude']
```

**Manque**:
- Commande `hestia dev` pour lancer OpenCode
- Intégration avec le workspace Synap
- Génération automatique de code
- Déploiement auto vers le site

### Gap #5: CLI Incomplet

**Commandes existantes mais NON FONCTIONNELLES**:
```typescript
// Placeholders identifiés:
❌ add      - API client créé mais pas utilisé
❌ remove   - Même problème
❌ provision - Commentaire "placeholder"
❌ usb      - Commentaire "placeholder"
```

**Commandes manquantes CRUCIALES**:
```typescript
❌ deploy       - Déploiement one-click
❌ domain       - Gestion domaine/DNS
❌ website      - Génération/management site
❌ dev          - Lancer environnement dev (OpenCode)
❌ connect      - Connecter Synap↔OpenClaw↔OpenCode
```

---

## 🔧 ARCHITECTURE RECOMMANDÉE

### 1. Commande `hestia init --full`

Wizard interactif qui configure:
```yaml
1. Nom du projet
2. Domaine (ou sous-domaine .synap.io)
3. Provider AI:
   - OpenCode (recommandé)
   - OpenClaude
   - Plus tard
4. Clés API (masquées)
5. Test connexion
6. Génération docker-compose.yml final
```

### 2. Commande `hestia deploy`

Pipeline complète:
```yaml
1. Pre-flight checks
2. Génération docker-compose.final.yml
3. Génération .env avec tous les secrets
4. Docker compose pull
5. Docker compose up -d
6. Attente healthchecks
7. Setup OpenClaw (si activé)
8. Setup OpenCode (si activé)
9. Synchronisation State Manager
10. Affichage URLs d'accès
```

### 3. Commande `hestia website`

Génération site web:
```yaml
1. Clone template: github.com/synap-core/starter-website
2. Installation dépendances (@synap/*)
3. Configuration SDK Synap
4. Build Docker image
5. Ajout au docker-compose
6. Redémarrage avec Traefik/Caddy
```

### 4. Commande `hestia dev`

Environnement développement:
```yaml
1. Lancer OpenCode IDE
2. Connecter au workspace Synap
3. Ouverture navigateur
4. Mode "watch" pour hot-reload
```

---

## 📊 MATRICE DE FONCTIONNALITÉS

| Fonctionnalité | Existe | Fonctionnel | Intégré | Priorité |
|----------------|--------|-------------|---------|----------|
| **Core Infrastructure** |
| Synap Backend Docker | ✅ | ✅ | ✅ | - |
| OpenClaw Docker | ✅ | ✅ | ⚠️ (profile manuel) | Haute |
| OpenClaude npm | ✅ | ⚠️ | ❌ | Haute |
| Traefik Config | ✅ | ⚠️ | ❌ | Haute |
| **CLI Commands** |
| ignite/extinguish | ✅ | ✅ | ✅ | - |
| status | ✅ | ✅ | ✅ | - |
| init | ✅ | ⚠️ | ⚠️ (pas de wizard) | Haute |
| add/remove | ✅ | ❌ | ❌ | Haute |
| deploy | ❌ | ❌ | ❌ | CRITIQUE |
| website | ❌ | ❌ | ❌ | CRITIQUE |
| dev | ❌ | ❌ | ❌ | CRITIQUE |
| **Intégration** |
| Synap↔OpenClaw | ✅ | ✅ | ⚠️ (state manager) | Moyenne |
| Synap↔OpenCode | ⚠️ | ❌ | ❌ | Haute |
| OpenClaw↔OpenCode | ❌ | ❌ | ❌ | Haute |
| **Déploiement** |
| Docker Compose | ✅ | ✅ | ✅ | - |
| SSL Auto (Caddy) | ✅ | ✅ | ✅ | - |
| SSL Auto (Traefik) | ✅ | ⚠️ | ❌ | Moyenne |
| Gestion Domaine | ❌ | ❌ | ❌ | CRITIQUE |
| Docuploy | ❌ | ❌ | ❌ | À définir |

---

## 🚀 PLAN D'IMPLÉMENTATION RECOMMANDÉ

### Phase 1: One-Click Deploy (CRITIQUE)
**Objectif**: `hestia deploy` fonctionne en une commande

1. Créer `deploy.ts` command
2. Générer docker-compose.unified.yml
3. Générer .env complet avec tous les secrets
4. Intégrer setup automatique OpenClaw
5. Intégrer setup automatique OpenCode

### Phase 2: Gestion Domaine (CRITIQUE)
**Objecti**: Support domaine personnalisé

1. Intégrer Traefik (ou garder Caddy)
2. Automatisation DNS (si possible)
3. Génération sous-domaines:
   - `app.domain.com` → Synap
   - `gateway.domain.com` → OpenClaw
   - `dev.domain.com` → OpenCode

### Phase 3: Website Template (HAUTE)
**Objectif**: `hestia website create` génère un site

1. Créer repo template: `synap-starter-website`
2. Intégrer composants @synap/*
3. Pages: Home, Dashboard, Profile, Search
4. Connexion API Synap automatique

### Phase 4: Dev Mode (HAUTE)
**Objectif**: `hestia dev` lance environnement complet

1. Intégrer @gitlawb/openclaude
2. Mode développement avec hot-reload
3. Sync automatique code ↔ Synap

---

## 💡 RECOMMANDATIONS TECHNIQUES

### Reverse Proxy: Caddy vs Traefik

**Actuel**: Caddy (dans docker-compose)
**Avantages Caddy**:
- Configuration simple
- SSL Let's Encrypt automatique
- Déjà configuré et testé

**Votre demande**: Traefik + Docuploy
**Pourquoi Traefik serait mieux**:
- Labels Docker natifs
- Dashboard intégré
- Middlewares avancés
- Meilleur pour multi-domaines

**Recommandation**: Migrer vers Traefik

### OpenCode Intégration

```typescript
// Nouvelle commande: hestia dev
// Dans package.json:
{
  "dependencies": {
    "@gitlawb/openclaude": "latest"
  }
}

// Service à ajouter au docker-compose:
services:
  opencode:
    image: ghcr.io/opencode/opencode:latest
    environment:
      - SYNAP_POD_URL=http://backend:4000
      - SYNAP_API_KEY=${SYNAP_API_KEY}
      - WORKSPACE_DIR=/workspace
    volumes:
      - ./website:/workspace
```

### State Manager Déjà Prêt !

**Bonnes nouvelles**: Le state manager est déjà très avancé!
```typescript
// Dans state-manager.ts:
- Sync bidirectionnelle ✅
- Conflits resolution ✅
- File watching ✅
- Auto-sync ✅
```

Il faut juste l'utiliser dans les commandes CLI.

---

## 🎯 CONCLUSION

### ✅ Forces Actuelles:
1. Backend Synap très complet et testé
2. Intégration OpenClaw déjà configurée
3. State Manager sophistiqué
4. Templates Traefik existants
5. Docker Compose standalone fonctionnel

### ❌ Bloquants Critiques:
1. **Pas de commande `deploy` unifiée**
2. **CLI très incomplet** (placeholders)
3. **Pas d'intégration OpenCode**
4. **Pas de génération website**
5. **Gestion domaine manuelle**

### 🚀 Prochaine Action Recommandée:

**Implémenter `hestia deploy` complète**:
```bash
# Ce que ça fait:
1. Génère docker-compose.final.yml
2. Génère .env avec tous les secrets
3. Lance: docker compose up -d
4. Setup OpenClaw + OpenCode
5. Synchronise State Manager
6. Affiche: "Votre cerveau est prêt sur https://..."
```

C'est le **fondement** de tout le reste.
