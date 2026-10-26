---
name: session-profile
description: "Choisit et applique un jeu de plugins Claude Code pour le répertoire courant, via <CWD>/.claude/settings.local.json (scope local, jamais commité). Triggers : '/erom-session:session-profile', 'profil de session', 'active les plugins de recherche / de dev', 'coupe les plugins inutiles', 'j'ai besoin de firecrawl / du LSP / de netlify'."
allowed-tools: Bash, Read, AskUserQuestion
user-invocable: true
---

# session-profile — plugins à la demande, par répertoire

Le global (`~/.claude/settings.json`) reste minimal. Cette skill rallume des plugins **pour un répertoire seulement**, sans jamais toucher au global.

Tout passe par `<CWD>/.claude/settings.local.json`. Ce fichier est exclu par `~/.config/git/ignore:1` (`**/.claude/settings.local.json`) : il ne part jamais dans un commit, même sur un repo public.

**Vérifié le 2026-08-06, Claude Code 2.1.223** — `enabledPlugins` en scope local surcharge le global dans les deux sens (`true` sur un `false` global, et l'inverse), et `/reload-plugins` applique en session sans redémarrage.

## Commandes

Toutes tournent depuis le répertoire visé (ou avec `--cwd <chemin>`).

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/session-profile/scripts/profile.ts" list                        # les profils et leurs plugins (défaut)
bun "${CLAUDE_PLUGIN_ROOT}/skills/session-profile/scripts/profile.ts" add firecrawl, erom-image   # virgules ou espaces, au choix
bun "${CLAUDE_PLUGIN_ROOT}/skills/session-profile/scripts/profile.ts" add common security         # un profil ajoute tous ses plugins
bun "${CLAUDE_PLUGIN_ROOT}/skills/session-profile/scripts/profile.ts" rm firecrawl erom-image
```

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux au-dessus du « Base directory for this skill » injecté en tête de la skill.

Un nom est un profil (`common`), un nom court de plugin (`firecrawl`) ou un id complet (`firecrawl@claude-plugins-official`). Un nom inconnu ou ambigu sort en code 2 avec la liste : ne jamais deviner à sa place, redemander à Romain.

**Chaque `add` ajoute aussi le LSP du langage détecté** (marqueur racine type `tsconfig.json`, `Cargo.toml`, sinon extensions présentes). `rm` ne retire que ce qui est nommé ; `rm lsp` retire les LSP détectés.

Afficher la sortie telle quelle.

## Choisir sans nom explicite

`/erom-session:session-profile` nu, ou une intention sans nom (« on attaque le front ») : lancer `list`, lire l'intention réelle de la session, proposer **un** jeu, attendre le feu vert. Ne jamais appliquer d'office : le reload coupe des outils que la session utilise peut-être déjà.

## Données

Les profils vivent dans `profiles.json`, nœud `domains`. Le script n'a aucun plugin en dur : ajouter un plugin à un profil = éditer ce JSON. **Dans le dépôt du plugin** (`~/dev/erom-agence-session/plugin/skills/session-profile/profiles.json`), puis release : la copie installée sous `${CLAUDE_PLUGIN_ROOT}` est un cache que chaque mise à jour du plugin écrase. `lspDetect` porte les règles de détection. Le domaine `lsp` n'est jamais activé en bloc (voir limites) et n'apparaît pas dans `list`.

## Après toute écriture

**Dire à Romain de taper `/reload-plugins`.** Un agent ne peut pas lancer une slash command : sans ce geste, le fichier est écrit mais la session tourne encore sur l'ancien jeu.

Le reload ne casse le cache de prompt que si les serveurs MCP changent **et** que ToolSearch est off. ToolSearch est actif dans cette config. Si Claude Code réclame quand même `/reload-plugins --force`, le cache sautera : le signaler avant que Romain tape.

## Garde-fous

- **Jamais** écrire dans `~/.claude/settings.json` : cette skill est per-répertoire, point.
- **Jamais** écrire dans `<CWD>/.claude/settings.json` (scope project) : il serait commité. Pour du durable partagé : `claude plugin enable <id> --scope project`.
- Ne pas couper les always-on (`alwaysOn` du JSON) sans demande explicite.
- Le script n'installe rien. Un plugin absent se règle avec `claude plugin install <id>`.
- Si `settings.local.json` est du JSON invalide, le script refuse d'écrire. Le corriger, ne pas contourner.
- Un `.bak` est déposé avant chaque écriture. Les autres clés du fichier (`permissions`, `env`, `hooks`) sont préservées.

## Limites connues

- `vtsls@claude-code-lsps` et `typescript-lsp@claude-plugins-official` couvrent le même langage. La détection ne prend que `vtsls` ; n'activer les deux sous aucun prétexte.
- Les serveurs MCP user-level de `~/.claude.json` (exa, erom-memory…) et les connecteurs claude.ai (Linear, Slack, Context7) viennent du compte, **pas** des settings : hors de portée de cette skill.
- La sortie de `add` / `rm` montre ce que déclare `settings.local.json`, pas l'état effectif. Pour le vrai état : `claude plugin list` depuis le répertoire.
- Cette skill est le seul mécanisme de profil en vigueur. Les anciens profils de lancement (`~/.claude/profiles/*.json`) ont été supprimés le 2026-08-06 : ne pas les recréer.
