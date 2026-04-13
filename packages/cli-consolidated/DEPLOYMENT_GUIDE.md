# Hestia CLI - Complete Deployment Guide

## 🎯 Vision Réalisée

**One command deploys your complete digital infrastructure:**

```bash
hestia deploy --domain monsite.com --provider opencode --website
```

✅ **Cerveau**: Synap Backend (données + connaissances)  
✅ **Mains**: OpenClaw (actions/agents)  
✅ **Dev**: OpenCode OU OpenClaude (au choix)  
✅ **Site**: Website template Next.js (optionnel)  

---

## 🏗️ Architecture Déployée

```
Internet
    │
    ▼
Traefik (Reverse Proxy + SSL Auto)
    │
    ├──► monsite.com           → Synap Backend (API + UI)
    ├──► dev.monsite.com       → OpenCode IDE (développement)
    ├──► gateway.monsite.com   → OpenClaw (agents)
    └──► www.monsite.com       → Website Next.js (vitrine)

Services Internes:
    ├── PostgreSQL + TimescaleDB
    ├── Redis (cache)
    ├── MinIO (stockage S3)
    ├── Typesense (recherche)
    └── Ory Kratos (authentification)
```

---

## 🚀 Déploiement Rapide

### Prérequis

- Docker + Docker Compose
- Un nom de domaine (ou sous-domaine)
- Serveur avec ports 80/443 ouverts

### Commande Complète

```bash
# 1. Installer Hestia CLI
npm install -g @hestia/cli

# 2. Déployer
hestia deploy \
  --domain brain.example.com \
  --provider opencode \
  --website \
  --profile full

# 3. Suivre les instructions affichées
```

### Options

| Option | Description | Défaut |
|--------|-------------|--------|
| `--domain` | Nom de domaine | Obligatoire |
| `--provider` | Plateforme AI (opencode/openclaude/both) | opencode |
| `--website` | Déployer le site web | false |
| `--profile` | Profil (minimal/full/ai-heavy) | full |
| `--dry-run` | Générer sans déployer | false |

---

## 📦 Ce qui est Déployé

### 1. Synap Backend (Brain)

**Services**:
- API REST + tRPC (port 4000)
- Real-time WebSocket (port 4001)
- PostgreSQL + TimescaleDB
- Redis
- MinIO (S3 compatible)
- Typesense (recherche full-text)
- Ory Kratos (auth)
- Ory Hydra (OAuth2)

**Accès**:
- https://monsite.com
- https://monsite.com/api/*
- https://monsite.com/trpc/*

### 2. OpenCode (Dev IDE)

**Description**: IDE web basé sur OpenCode  
**Accès**: https://dev.monsite.com

**Fonctionnalités**:
- Éditeur de code dans le navigateur
- Terminal intégré
- Git intégré
- Connexion directe au workspace Synap
- Extensions supportées

**Intégration**:
- Variables d'env pour Synap SDK
- Commande: `hestia dev` (ouvre OpenCode)

### 3. OpenClaw (Hands)

**Description**: Agent CLI pour automatisation  
**Accès**: https://gateway.monsite.com/gateway

**Fonctionnalités**:
- Exécution de commandes
- Automatisation workflows
- Intégration messagerie (Telegram, etc.)
- Connecté au workspace Synap

**Utilisation**:
```bash
# En ligne de commande locale
opencode --pod https://monsite.com
```

### 4. Website Template (Next.js)

**Description**: Site vitrine + Dashboard utilisateur  
**Accès**: https://www.monsite.com

**Pages**:
- 🏠 Landing page (marketing)
- 🔐 Authentification Kratos
- 📊 Dashboard personnel
- 👤 Profil utilisateur
- 🔍 Recherche (Typesense)

**Tech Stack**:
- Next.js 14 (App Router)
- React 18 + TypeScript
- Tamagui (@synap/ui-system)
- Authentification: Ory Kratos
- Connexion API: tRPC + REST

---

## 🔐 Authentification

### Flow Kratos

```
Utilisateur
    │
    ▼
Website (Next.js)
    │ POST /.ory/kratos/public/self-service/login
    ▼
Synap Backend (proxy → Kratos)
    │
    ▼
Kratos (validation)
    │
    ▼
Cookie ory_kratos_session
    │
    ▼
Redirection Dashboard
```

### Utilisation dans le Code

```tsx
import { useAuth } from '@/lib/auth/AuthProvider';

function MyComponent() {
  const { user, isAuthenticated, logout } = useAuth();
  
  if (isAuthenticated) {
    return <div>Hello {user.name}</div>;
  }
  
  return <button onClick={logout}>Logout</button>;
}
```

---

## 🔌 Connexions entre Services

### Synap ↔ OpenCode

**Configuration**:
```yaml
# docker-compose.yml
services:
  opencode:
    environment:
      - SYNAP_POD_URL=http://synap-backend:4000
      - SYNAP_HUB_API_KEY=${HUB_PROTOCOL_API_KEY}
      - SYNAP_WORKSPACE_ID=default
```

**Sync via State Manager**:
```typescript
// État partagé
{
  "workspace": {
    "id": "default",
    "name": "My Workspace"
  },
  "intelligence": {
    "provider": "openai",
    "model": "gpt-4"
  }
}
```

### Synap ↔ OpenClaw

**Configuration**:
```yaml
services:
  openclaw:
    environment:
      - SYNAP_POD_URL=http://synap-backend:4000
      - SYNAP_HUB_API_KEY=${OPENCLAW_HUB_API_KEY}
      - SYNAP_WORKSPACE_ID=default
```

### Website ↔ Synap

**Rewrites Next.js**:
```javascript
// next.config.js
async rewrites() {
  return [
    {
      source: '/.ory/kratos/public/:path*',
      destination: 'https://synap/.ory/kratos/public/:path*',
    },
    {
      source: '/trpc/:path*',
      destination: 'https://synap/trpc/:path*',
    },
  ];
}
```

---

## 📊 State Manager

**Localisation**: `~/.openclaude-profile.json` + `~/.openclaw/config.json`

**Synchronisation**:
- Bidirectionnelle Synap ↔ Local
- Conflits: stratégie configurable
- Auto-sync sur changements

**Exemple**:
```typescript
// Lire état
const state = await stateManager.getState();

// Mettre à jour
await stateManager.syncToLocal({
  openclaude: {
    profile: {
      name: 'My Workspace',
      ai: { provider: 'openai', model: 'gpt-4' }
    }
  }
});
```

---

## 🎨 Personnalisation Website

### 1. Modifier le Template

```bash
# Cloner le template
cd ~/.hestia/deployments/monsite.com/website

# Modifier
vim app/page.tsx

# Rebuild
docker compose --profile website up -d --build
```

### 2. Utiliser Composants Synap

```tsx
import { EntityCard, useEntity } from '@synap/entity-card';

function EntityView({ entityId }) {
  const { data: entity } = useEntity(entityId);
  
  return <EntityCard entity={entity} variant="full" />;
}
```

### 3. Ajouter Pages

```tsx
// app/mypage/page.tsx
export default function MyPage() {
  return <div>Ma Page Personnalisée</div>;
}
```

---

## 🔧 Commandes CLI

### Gestion Infrastructure

```bash
# Voir le statut
hestia status

# Démarrer les services
hestia ignite

# Arrêter les services
hestia extinguish

# Voir les logs
hestia logs

# Health check
hestia health
```

### Développement

```bash
# Lancer OpenCode IDE
hestia dev

# Mode développement website
hestia website dev

# Rebuild website
hestia website rebuild
```

### Configuration

```bash
# Voir config
hestia config get

# Modifier config
hestia config set key value

# Voir credentials
hestia config credentials
```

---

## 🐛 Dépannage

### Problème: SSL ne fonctionne pas

**Solution**:
```bash
# Vérifier DNS
 dig monsite.com

# Vérifier ports
sudo lsof -i :80
sudo lsof -i :443

# Recréer certificats
rm -rf ~/.hestia/deployments/monsite.com/traefik_certs
hestia ignite
```

### Problème: Auth échoue

**Solution**:
```bash
# Vérifier Kratos
 docker logs synap-kratos-1

# Reset session
rm ~/.openclaude-profile.json
hestia deploy --domain monsite.com
```

### Problème: Website inaccessible

**Solution**:
```bash
# Vérifier build
 cd ~/.hestia/deployments/monsite.com/website
 docker compose logs website

# Rebuild
 docker compose --profile website up -d --build
```

---

## 📚 Ressources

### Documentation

- [Synap Docs](https://docs.synap.io)
- [Website Template README](./synap-starter-website/README.md)
- [OpenCode Docs](https://opencode.ai/docs)
- [Ory Kratos](https://www.ory.sh/kratos/docs/)

### Templates

- Website: `github.com/synap-core/synap-starter-website`
- Docker Compose: Généré automatiquement

### Support

- Issues: GitHub Issues
- Discord: [Synap Community](https://discord.gg/synap)
- Email: support@synap.io

---

## ✅ Checklist Post-Déploiement

- [ ] Domaine résout vers le serveur
- [ ] HTTPS fonctionne (SSL Let's Encrypt)
- [ ] Connexion Synap OK (https://monsite.com)
- [ ] Authentification OK (test login)
- [ ] OpenCode accessible (https://dev.monsite.com)
- [ ] OpenClaw connecté (si activé)
- [ ] Website déployé (https://www.monsite.com)
- [ ] Recherche fonctionne
- [ ] State sync OK

---

## 🎉 Félicitations !

Votre infrastructure digitale est prête !

**Accès rapide**:
- 🧠 **Brain**: https://monsite.com
- 💻 **Dev**: https://dev.monsite.com
- ✋ **Agents**: https://gateway.monsite.com
- 🌐 **Site**: https://www.monsite.com

**Prochaines étapes**:
1. Créer votre premier workspace
2. Inviter des collaborateurs
3. Configurer OpenCode extensions
4. Développer votre première app

---

*Documentation mise à jour: 2026-04-13*
