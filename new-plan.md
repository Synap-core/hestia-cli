***__Eve Composable Installer — Implementation Plan__***              

                                          

  **Current State vs Desired State**                   

                                                 

  **Current:** Binary setup profiles (inference_only / data_pod / full), deprecation-gated commands, implicit file-based state

  sharing between eve and synap, Dokploy tightly coupled to builder init, no post-install extensibility.

                                                                                                                                

  **Desired:** Composable eve install with explicit component picker, base layers always installed, optional components addable

  later via eve add, explicit state sharing contract, components independently manageable.                                      

                                                                                   

  ---                                                                                                                           

  **Phase 1: Remove Deprecation Gates & Restructure CLI**                              

                                                                                                                                

  **Files to change:**                                                                                                              

                                                 

  - packages/eve-cli/src/commands/setup.ts — Remove printEveDeprecation(), requireDelegationConfirmed(), --confirm-delegation   

  option, --json special handling in deprecation                                                                                

  - packages/eve-cli/src/commands/brain/init.ts — Same deprecation removal

  - packages/eve-cli/src/commands/status.ts — Same deprecation removal                                                          

  - packages/eve-cli/src/lib/ui.ts — Remove printEveDeprecation() and requireDelegationConfirmed() (or keep as unused helpers)

  - packages/eve-cli/test/cli-smoke.test.ts — Remove --confirm-delegation from all test commands                                

                                                                                                                                

  **Why:**                                                                                                                          

                                                                                                                                

  These gates were temporary placeholders. The new eve install command will be the native path, not a delegation to Synap bash

  scripts.                                                                                                                      

                                                                                                                                

  ---                                                                                                                           

  **Phase 2: Design Composable eve install**                                                                                        

                                                                                                                                

  **New command structure:**                                                                                                        

                                                                                   

  eve install              # Interactive component picker                                                                       

  eve install --all        # Install everything (default preset)                                                                

  eve install --synap      # Install Synap only

  eve install --hermes     # Install Hermes daemon only                                                                         

  eve install --openclaw   # Install OpenClaw only                                 

  eve install --traefik    # Install Traefik only                                                                               

  eve install --domain foo.example.com --ssl                                       

                                                                                                                                

  **New file: packages/eve-cli/src/commands/install.ts**                                                                            

                                                                                                                                

  This replaces setup.ts as the primary entry point.                                                                            

                                                                                                                                

  **Component model:**                                                                                                              

                                                                                                                                

  Each component has:                                                                                                           

  - name — display name                                                                                                         

  - description — what it does (shown in picker)                                                                                

  - requiredBy — which other components need it                                    

  - install() — async install function                                                                                          

  - dependencies — hard requirements (can't install without)                       

  - optionalDependencies — soft requirements (better with, not required)                                                        

                                                                                   

  **Component registry:**                                                                                                           

                                                 

  // packages/eve-cli/src/lib/components.ts                                                                                     

                                                                                                                                

  interface Component {                                                                                                         

    id: 'synap' | 'hermes' | 'openclaw' | 'traefik' | 'dokploy' | 'opencode' | 'ollama';                                        

    name: string;                                                                                                               

    emoji: string;                                                                                                              

    description: string;                                                                                                        

    dependencies: string[];        // hard deps                                                                                 

    optionalDependencies: string[]; // soft deps                                   

    install: (opts: ComponentInstallOpts) => Promise<ComponentResult>;                                                          

  }                                                                                                                             

                                                                                                                                

  **Base layers (always installed):**                                                                                               

                                                                                                                                

  1. **Traefik** — routing layer (chosen over Caddyfile, see Phase 4)                                                               

  2. **Entity state** — already in @eve/dna, always present                                                                         

                                                                                                                                

  **Core components (user picks):**                                                                                                 

                                                                                                                                

  1. **Synap** — data pod (backend API, DB, etc.)                                                                                   

  2. **Hermes** — task daemon (polls Synap, executes tasks)                                                                         

  3. **OpenClaw** — AI assistant container                                             

                                                                                                                                

  **Optional components (addable later):**                                                                                          

                                                                                                                                

  1. **Dokploy** — PaaS deployment                                                                                                  

  2. **OpenCode** — code editor container                                              

  3. **Ollama** — local LLM (needed by OpenClaw if no Synap AI)                                                                     

                                                                                                                                

  **Picker UX:**                                                                                                                    

                                                                                                                                

  🧬 Eve Composable Installer                                                                                                   

                                                                                   

  Base layers (auto-installed):                                                                                                 

    ✓ Traefik — routing & reverse proxy                                                                                         

    ✓ Entity State — organ health tracking                                                                                      

                                                                                                                                

  Select components:                                                                                                            

                                                                                   

    [ ] Synap        🏛️   Your personal data pod — capture, store, query anything                                                

    [ ] Hermes       🔄  Task daemon — polls Synap, automates workflows

    [ ] OpenClaw     🤖  AI assistant — local LLM-powered agent                                                                 

                                                                                                                                

  Optional add-ons:                              

    [ ] Dokploy      🚀  PaaS deployment platform                                                                               

    [ ] OpenCode     💻  Browser-based code editor                                                                              

    [ ] Ollama       🧠  Local LLM (required by OpenClaw if no Synap AI)

                                                                                                                                

    ↑↓ navigate  ✓ select  A select all  I install                                                                              

                                                                                                                                

  **State flow:**                                                                                                                   

                                                                                                                                

  1. User selects components → writes to setup-profile.json as an array of component IDs, not a binary profile string           

  2. Each component's install() runs in dependency order                                                                        

  3. Results written to state.json per organ                                                                                    

                                                                                                                                

  **Migration from old profiles:**                                                                                                  

                                                                                   

  If setup-profile.json exists with old profile field (inference_only / data_pod / full), show a migration notice:              

  🔄 Detected legacy setup profile: full                                           

     Converting to composable model...                                                                                          

     ✓ Synap + Traefik + Hermes                                                    

     Pass --migrate to apply automatically                                                                                      

                                                                                   

  ---                                                                                                                           

  **Phase 3: eve add <component> and eve remove <component>**                          

                                                                                                                                

  **Commands:**                                                                                                                     

                                                 

  eve add dokploy      # Add Dokploy to existing install                                                                        

  eve add openclaw     # Add OpenClaw (resolves deps: checks for Ollama/Synap AI)                                               

  eve remove dokploy   # Remove Dokploy, keep other components

  eve enable <cmd>     # Enable a stopped component                                                                             

  eve disable <cmd>    # Disable without removing config                           

                                                                                                                                

  **New file: packages/eve-cli/src/commands/add.ts**                                   

                                                 

  **New file: packages/eve-cli/src/commands/remove.ts**                                                                             

                                                                                                                                

  **Logic:**                                                                                                                        

                                                                                                                                

  1. Read current setup-profile.json and state.json                                                                             

  2. Resolve component definition from registry                                    

  3. Check dependencies (fail if missing, or offer to install them)                                                             

  4. Run component's install() function                                            

  5. Update setup-profile.json (add to components array)                                                                        

  6. Update state.json (set organ to ready)                                        

                                                 

  **Example — eve add openclaw when no Ollama or Synap AI:**

                                                                                                                                

  ⚠️   OpenClaw requires a local LLM. Neither Ollama nor Synap AI detected.

      Install Ollama now? [Y/n]                                                                                                 

                                                                                   

  ---                                                                                                                           

  **Phase 4: Traefik vs Caddyfile Decision**                                                                                        

                                                                                                                                

  **Decision: Traefik as primary, remove Caddyfile**                                                                                

                                                                                                                                

  **Why Traefik:**                                

  - More programmable — Docker API, dynamic config, JSON/YAML config files                                                      

  - Better for CLI-driven setup — docker run with flags, watchtower integration    

  - Already implemented in @eve/legs (run-proxy-setup.ts)                                                                       

  - Supports tunnel integration (Pangolin/Cloudflare) natively

  - Route config is JSON-driven, easy to compose per-component                                                                  

                                                                                   

  **Caddyfile integration points to remove:**       

  - Synap's native install uses Caddyfile. This is in the synap bash script, NOT in Eve CLI. Eve CLI should never touch         

  Caddyfile.                                                                                                           

  - If synap install generates Caddyfile, Eve's Synap delegate path should post-process it → convert to Traefik labels          

  - OR: when Eve installs Synap, it passes --traefik flag to synap install (if supported) or manages routing separately via     

  Traefik                                                                                                                  

                                                                                                                                

  **Traefik routes (compose per installed component):**                                

                                                                                                                                

  # Auto-generated by eve install                                                  

  http:                                                                                                                         

    routers:                                                                                                                    

      synap:                                                                                                                    

        rule: Host("synap.example.com")                                                                                         

        service: synap                                                                                                          

        entryPoints: web                                                           

      hermes:                                                                                                                   

        rule: Host("hermes.example.com")                                           

        service: hermes                          

      openclaw:

        rule: Host("openclaw.example.com")                                                                                      

        service: openclaw              

      traefik-api:                                                                                                              

        rule: Host("traefik.example.com")                                          

        service: api@internal                    

                                       

    services:                                                                                                                   

      synap:                                  

        loadBalancer:                                                                                                           

          servers:                                                                 

            - url: http://synap-container:3000                                                                                  

      hermes:                          

        loadBalancer:                                                                                                           

          servers:                                                                 

            - url: http://hermes-container:9000

      openclaw:                        

        loadBalancer:                                                                                                           

          servers:                            

            - url: http://openclaw-container:4000                                                                               

                                                                                   

  **Route management in code:**                                                                                                     

                                              

  - @eve/legs becomes the single source of truth for Traefik config                                                             

  - Each component that needs a route exports a getTraefikConfig() function        

  - run-proxy-setup.ts merges all component configs → writes final traefik.yml                                                  

  - New function: updateTraefikRoutes(components: ComponentConfig[]) — additive, not overwrite

                                                                                                                                

  **Files to modify:**                                                                 

                                                                                                                                

  - packages/@eve/legs/src/lib/run-proxy-setup.ts — Make it the central Traefik orchestrator

  - Each organ package that needs routing exports traefik config:                                                               

    - @eve/brain → getBrainTraefikConfig()                                                                                      

    - @eve/builder → getHermesTraefikConfig()

    - @eve/arms → getOpenClawTraefikConfig()                                                                                    

  - eve-cli/install.ts — collects all component configs, calls runProxySetup() once after all installs

                                                                                                                                

  ---                                            

  **Phase 5: Explicit State Sharing Contract Between eve and synap**                                                                

                                                                                                                                

  **Current state (implicit):**            

                                                                                                                                

  - resolveSynapDelegate() finds the synap bash script and repo root               

  - Eve CLI calls synap install, synap profiles enable openclaw, etc.                                                           

  - State is shared via file system: setup-profile.json, secrets.json, state.json

  - No contract — Eve doesn't know what synap did, synap doesn't know Eve ran it                                                

  

  **New contract: ~/.local/share/eve/state.json is the single source of truth**                                                     

                                                                                   

  **Schema:**

  {

    "version": 2,

    "installed": {

      "traefik": {

        "version": "3.0.0",

        "state": "ready",

        "installedAt": "2026-04-23T10:00:00Z",

        "config": {

          "tunnel": false,               

          "ssl": false,                

          "domain": null                        

        }                                     

      },                                         

      "synap": {

        "version": "0.5.0",                                                                                                     

        "state": "ready",

        "installedAt": "2026-04-23T10:05:00Z",                                                                                  

        "path": "/Users/antoine/Documents/Code/synap/synap-backend",               

        "config": {                             

          "domain": "synap.local",            

          "withAI": true,                        

          "aiProvider": "openrouter"          

        },                                                                                                                      

        "managedBy": "eve"          // ← explicit ownership marker

      },                                                                                                                        

      "hermes": {                                                                  

        "version": "0.1.0",                                                                                                     

        "state": "ready",                                                          

        "installedAt": "2026-04-23T10:10:00Z",   

        "config": {                             

          "pollIntervalMs": 30000,                                                                                              

          "maxConcurrentTasks": 1                

        }                                                                                                                       

      },                                                                                                                        

      "openclaw": {

        "version": "0.2.0",                                                                                                     

        "state": "ready",                                                          

        "installedAt": "2026-04-23T10:15:00Z",                                                                                  

        "config": {                                                                

          "llmProvider": "ollama",               

          "model": "llama3.1:8b"                

        }                                                                                                                       

      }                                          

    },                                                                                                                          

    "secrets": {                                                                                                                

      "synapApiKey": "...",                      

      "openrouterApiKey": "...",                                                                                                

      "_note": "secrets are encrypted in production"                                                                            

    },                                          

    "setupProfile": {                                                                                                           

      "version": 2,                                                                

      "components": ["traefik", "synap", "hermes", "openclaw"],

      "installedAt": "2026-04-23T10:00:00Z"                                                                                     

    }                                           

  }                                                                                                                             

                                                                                   

  **Key design decisions:**                       

                                                                                                                                

  1. **managedBy field** — marks if a component was installed by Eve ("eve") or manually ("manual") or by Synap script ("synap").

  This determines who manages updates/lifecycle.                                                                                

  2. **Eve never modifies Synap's internal state** — Eve installs Synap via the bash script, then writes its own record in

  state.json. Synap doesn't need to know about Eve's state file.                                                                

  3. **Synap delegate becomes a bridge, not a crutch** — when managedBy: "eve" is set:

    - Eve CLI owns the lifecycle (start/stop/update)

    - synap commands are called only for Synap-specific operations (profile management, etc.)                                   

    - When managedBy: "manual", Eve CLI reads Synap's state but doesn't modify it

  4. **secrets.json stays per-workspace** — API keys and credentials live in <cwd>/.eve/secrets/secrets.json. Both Eve and Synap    

  delegate can write to it (Synap writes API keys after synap install, Eve writes them after eve add openclaw).                 

  5. **Setup profile migration** — old profile field ("full") → new components array:

    - inference_only → ["traefik", "ollama"]                                                                                    

    - data_pod → ["traefik", "synap"]                                              

    - full → ["traefik", "synap", "hermes", "openclaw"]                                                                         

                                                                                   

  **Files to modify:**                                                                                                              

                                                                                   

  - packages/@eve/dna/src/entity-state.ts — Update state.json schema (version 2)                                                

  - packages/eve-cli/src/lib/synap-delegate.ts — Update to respect managedBy field

  - packages/eve-cli/src/commands/install.ts — Write new schema on install                                                      

  - packages/eve-cli/src/commands/status.ts — Read new schema, show managedBy in display

                                                                                                                                

  ---                                                                              

  **Phase 6: Decouple Dokploy and Optional Components**                                                                             

                                                                                   

  **Current problem:**                                                                                                              

                                                

  Dokploy is tied to builder init --with-dokploy. If user didn't select it initially, they can't add it later.                  

                                                                                   

  **Solution:**

                                                                                                                                

  Dokploy becomes a standalone component in the registry, installable via eve add dokploy at any time.

                                                                                                                                

  **Files to change:**                                                                 

                                              

  - **New:** packages/@eve/builder/src/lib/dokploy-setup.ts — Extract Dokploy logic from builder/deploy.ts into a standalone

  function

  - **New:** packages/@eve/builder/src/commands/add-dokploy.ts — Or reuse eve-cli/src/commands/add.ts with Dokploy component        

  definition                             

  - packages/@eve/builder/src/commands/init.ts — Remove --with-dokploy flag (or keep as alias for eve add dokploy post-init)    

  - packages/@eve/builder/src/commands/deploy.ts — Keep but require Dokploy to be in state.json first

                                              

  **Component flow:**                                

                                                

  eve install --synap --hermes    # Base install, no Dokploy                                                                    

  ... later ...                                  

  eve add dokploy                  # Adds Dokploy, configures Traefik routes                                                    

  eve builder deploy              # Now works — Dokploy detected in state                                                       

                                       

  **Other optional components:**                                                                                                    

                                                                                   

  - **OpenCode** — same pattern, standalone install, Traefik route added

  - **Ollama** — currently part of inference_only profile. Becomes standalone component. OpenClaw has it as optionalDependency.

                                                                                                                                

  ---                                  

  **Phase 7: Entity-State Schema Updates**                                                                                          

                                                                                   

  **Changes to @eve/dna/src/entity-state.ts:**       

  1. **Add version: 2** to state.json root                                                                                          

  2. **New fields on organ entries:**

    - version?: string — component version                                                                                      

    - installedAt?: string — ISO timestamp                                         

    - managedBy?: 'eve' | 'synap' | 'manual' — ownership

    - config?: Record<string, unknown> — component-specific config

  3. **Update updateOrgan()** to accept optional version and config

  4. **Migration function:** migrateStateV1ToV2(state: any) => StateV2

  5. **Remove organ-centric state model** — replace with component-centric:

  // OLD: { organs: { brain: { state: 'ready' }, arms: { state: 'ready' } } }

  // NEW: { installed: { synap: { state: 'ready', version: '0.5.0' }, openclaw: { ... } } }                                     

                                              

  **Mapping old organ names → new component IDs:**                                                                                  

                                                                                   

  ┌─────────┬──────────────────────┐                                                                                            

  │  Organ  │     Component ID     │          

  ├─────────┼──────────────────────┤                                                                                            

  │ brain   │ synap                │                                               

  ├─────────┼──────────────────────┤                                                                                            

  │ arms    │ openclaw             │                                               

  ├─────────┼──────────────────────┤                                                                                            

  │ builder │ hermes               │                                               

  ├─────────┼──────────────────────┤

  │ eyes    │ (future — RSS/feeds) │

  ├─────────┼──────────────────────┤

  │ legs    │ traefik              │

  └─────────┴──────────────────────┘     

                                       

  **getNextSteps()** **logic** **update:**                  

                                              

  // OLD: "brain is missing → run eve brain init"

  // NEW: "synap is missing → run eve install --synap or eve add synap"

                                                                                                                                

  ---

  **Phase 8: Test Updates**                                                                                                         

                                                                                   

  **Files** **to** **update:**

  - packages/eve-cli/test/cli-smoke.test.ts — Replace setup tests with install tests

  - packages/@eve/dna/test/entity-state.test.ts — Update for v2 schema

  - packages/@eve/legs/test/traefik.test.ts — Update Traefik config assertions

  - **New:** packages/eve-cli/test/component-registry.test.ts — Test component registry, dependency resolution

  - **New:** packages/eve-cli/test/install-flow.test.ts — Test install order, dependency chains

  - **New:** packages/eve-cli/test/migration.test.ts — Test v1→v2 state migration

                                                                                                                                

  **Test strategy:**                              

                                                                                                                                

  - Unit tests for each component's install() function (mocked)                    

  - Integration tests for dependency resolution                                                                                 

  - Smoke tests for new eve install CLI interface

  - Migration tests for old profile → new components array                                                                      

                                                                                   

  ---

  **File Summary — What's Created vs Modified**                                                                                     

  

  **New files:**                                                                                                                    

                                                                                   

  1. packages/eve-cli/src/commands/install.ts — Main composable installer

  2. packages/eve-cli/src/commands/add.ts — Post-install component addition

  3. packages/eve-cli/src/commands/remove.ts — Component removal

  4. packages/eve-cli/src/lib/components.ts — Component registry

  5. packages/@eve/builder/src/lib/dokploy-setup.ts — Extracted Dokploy logic

  6. packages/eve-cli/test/component-registry.test.ts

  7. packages/eve-cli/test/install-flow.test.ts                                                                                 

  8. packages/eve-cli/test/migration.test.ts    

                                                                                                                                

  **Modified files:**                                                                  

  1. packages/eve-cli/src/commands/setup.ts — Deprecate in favor of install.ts (keep for backward compat, redirect to install)

  2. packages/eve-cli/src/commands/brain/init.ts — Remove deprecation gates

  3. packages/eve-cli/src/commands/status.ts — Remove deprecation gates, update display for v2 schema                           

  4. packages/eve-cli/src/lib/ui.ts — Remove deprecation helpers                   

  5. packages/eve-cli/src/index.ts — Register new commands (install, add, remove), update help text

  6. packages/@eve/dna/src/entity-state.ts — v2 schema, migration function

  7. packages/eve-cli/src/lib/synap-delegate.ts — Respect managedBy field                                                       

  8. packages/@eve/legs/src/lib/run-proxy-setup.ts — Central Traefik orchestrator, per-component config aggregation

  9. packages/@eve/builder/src/commands/init.ts — Remove --with-dokploy coupling                                                

  10. packages/@eve/builder/src/commands/deploy.ts — Require Dokploy in state      

  11. packages/eve-cli/test/cli-smoke.test.ts — Update for new commands                                                         

  12. packages/@eve/dna/test/entity-state.test.ts — v2 schema tests

  13. packages/@eve/legs/test/traefik.test.ts — New Traefik config assertions                                                   

                                                                                                                                

  ---                                            

  **Coupling Analysis**                                                                                                             

                                                                                                                                

  **Before (tight):**                                

                                                                                                                                

  eve setup → brain init (synap delegate) → synap install script                                                                

             → legs setup (Traefik)         → hardcoded routes

             → builder init --with-dokploy   → Dokploy baked in                                                                 

             → arms install                  → requires brain already installed    

                                       

  **After (decoupled):**                            

                                              

  eve install --synap --hermes                   

    ├── traefik (base, auto) → runProxySetup([]) → minimal config

    ├── synap                → synapInstall(opts) → writes state.json {managedBy: "eve"}                                        

    │   └── runProxySetup([brainConfig]) → adds synap route

    ├── hermes               → hermesInstall(opts) → writes state.json                                                          

    │   └── runProxySetup([hermesConfig]) → adds hermes route                      

    └── openclaw (opt-in)    → openclawInstall(opts) → writes state.json

        └── runProxySetup([openclawConfig]) → adds openclaw route

                                       

  eve add dokploy (later)                                                                                                       

    ├── dokployInstall(opts) → writes state.json

    └── runProxySetup([dokployConfig]) → adds dokploy route                                                                     

                                                                                   

  Each component is independently installable. Traefik is the shared infrastructure layer, updated additively. No component     

  requires a specific installation order beyond dependency resolution.

                                                                                                                                

  ---                                                                              

  **Implementation Order**

                                                                                                                                

  1. **Phase 7** (entity-state v2 schema) — foundation, everything else depends on it

  2. **Phase 1** (remove deprecation gates) — clean slate                                                                           

  3. **Phase 4** (Traefik centralization) — infrastructure layer                       

  4. **Phase 5** (state sharing contract) — explicit contracts

  5. **Phase 2** (eve install) — main feature     

  6. **Phase 3** (eve add/remove) — extensibility    

  7. **Phase 6** (decouple Dokploy) — untangle coupling

  8. **Phase 8** (tests) — validate everything                                                                                      

                                       

  Phases 1-5 can be done in one PR. Phases 6-8 in a follow-up.
