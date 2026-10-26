---
name: session-retro
description: "Rétrospective de chantier sur demande explicite (bilan, post-mortem) : analyse transcripts, git et mémoire, propose des écritures playbook/gotchas/CLAUDE.md. Rituel coûteux, jamais spontané."
argument-hint: "[description du chantier, ex : chantier swarm / depuis la v1 / tout le projet]"
user-invocable: true
disable-model-invocation: true
---

# session-retro — rétrospective de chantier

Tu orchestres une rétrospective profonde du travail accompli sur un chantier. Objectif : des
postes actionnables tracés, pas un rapport que personne ne relit. Tu juges le TRAJET (process,
outillage, coût constaté des décisions techniques), jamais l'état actuel du code.

Déroule les 5 phases dans l'ordre. Tous les artefacts intermédiaires (digests, rapports
sources) vont dans le scratchpad de session — ils peuvent contenir des secrets et ne sont
JAMAIS versionnés. Seul le rapport final entre dans le repo, et il ne cite jamais un credential.

## Phase 0 — Cadrage (gratuit, se termine par un GO)

1. Périmètre : traduis l'argument en fenêtre `[t0, t1]` dans le repo courant. Garde-fou rtk :
   `git log`, `git status` et `git branch` sont exclus de la réécriture rtk depuis le
   2026-07-18 (exclude_commands) ; si une sortie git semble tronquée ou réécrite malgré tout,
   vérifie `rtk config` (chemin lu + exclusions) avant d'incriminer la commande.
   Sans argument : tout l'historique ;
   s'il existe déjà des rapports dans `_memory_/retros/`, propose « depuis la dernière rétro »
   (borne = date du dernier rapport) via AskUserQuestion.
2. Transcripts : le dossier est `~/.claude/projects/<slug>/` où `<slug>` = chemin absolu du cwd
   avec chaque `/` remplacé par `-` (ex : `/Users/recarnot/dev/x` → `-Users-recarnot-dev-x`).
   Vérifie que le dossier existe ; sinon retrouve-le par
   `ls ~/.claude/projects/ | grep <nom-du-projet>`.
3. Annonce le périmètre chiffré : nombre de sessions dans la fenêtre, volume (Mo), commits,
   période. Demande le GO via AskUserQuestion (options : lancer / ajuster le périmètre).
   C'est la SEULE validation avant la phase 4 — après le GO, déroule sans re-demander.

## Phase 1 — Digest mécanique (secondes)

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/session-retro/digest.ts" \
  --dir ~/.claude/projects/<slug> \
  --from <t0-ISO> --to <t1-ISO> \
  --out <scratchpad>/retro/digests
```

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux au-dessus du
« Base directory for this skill » injecté en tête de la skill.

Bornes `--from`/`--to` en heure LOCALE ; une date seule (`2026-07-18`) couvre la journée
entière. Les digests affichent des heures locales, fuseau annoncé dans chaque sortie —
directement comparables à git.

Lis ensuite UNIQUEMENT `<scratchpad>/retro/digests/_index.md` (jamais les digests un à un :
c'est le travail des lecteurs). Si le script émet des avertissements de format (⚠️), signale-les
à Romain avant de continuer : le format des transcripts a peut-être changé.

## Phase 2 — Lecture parallèle (le gros du coût)

1. Compose les lots depuis `_index.md` : 6 à 10 sessions par lot, équilibrés au volume
   (une session-fleuve de 25 h peut faire un lot à elle seule). Regroupe les micro-sessions
   automatisées (0-1 prompt, quelques minutes, StructuredOutput dominant) dans un lot dédié
   « runs automatisés » : leur signal propre est l'échec headless silencieux.
2. Dispatche TOUS les lecteurs en UN SEUL message (appels Agent parallèles),
   `subagent_type: "retro-reader"` :
   - un lecteur par lot de sessions,
   - un lecteur git,
   - un lecteur réceptacles.
   PAS de lecteur Linear : ce volet est à toi, voir le point 5.
3. Chaque mission de dispatch contient, explicitement : le rôle, la liste des chemins de
   digests du lot (ou repo + fenêtre pour git, chemins des réceptacles pour réceptacles),
   l'instruction de lire d'abord `${CLAUDE_PLUGIN_ROOT}/skills/session-retro/references/lenses.md`
   **résolu en chemin absolu** (le lecteur ne reçoit pas la variable), le chemin de
   sortie du rapport source `<scratchpad>/retro/sources/<nom-du-lot>.md`, et la consigne de
   répondre par un résumé de 10 lignes max. La mission du lecteur git précise : si une
   sortie git paraît réécrite ou tronquée, vérifier les exclusions rtk (`rtk config`)
   avant de conclure.
4. À la réception : vérifie que chaque rapport source existe sur disque. Un retour qui
   ressemble à une erreur API (coupure quota du lecteur) n'est PAS un rapport : redispatche
   ce lot. Ne relis jamais les digests toi-même.
5. **Le volet Linear, tu le fais TOI**, pendant que les lecteurs tournent (best-effort,
   seulement si le projet a un ONBOARD.md ou un projet Linear connu).
   Pourquoi pas un lecteur dédié : le type `retro-reader` est déclaré avec une liste de tools
   explicite (`Read, Grep, Glob, Bash, Write, ToolSearch`), donc il n'hérite d'aucun MCP de
   plugin et son `ToolSearch` répond « No matching deferred tools found » sur les tools
   caserne. Le rôle échouait à chaque exécution (constaté le 2026-08-13, rétro CCA bilingue).
   L'orchestrateur, lui, les a. Deux appels suffisent :
   ```
   ToolSearch select:mcp__plugin_erom-caserne_caserne__list_issues,mcp__plugin_erom-caserne_caserne__project_status
   list_issues(query: "<mot-clé du chantier>", limit: 40)
   list_issues(active: true, limit: 40)
   ```
   Écris le résultat dans `<scratchpad>/retro/sources/linear.md`, au même format que les autres
   rapports sources. Ce que tu cherches : le chantier était-il tracé (issue ouverte avant,
   pendant, après) ou piloté entièrement hors Linear ? L'écart entre le travail réel et sa
   trace est le finding, pas la liste des issues. Si les tools ne se chargent pas, écris un
   rapport « injoignable » qui dit précisément ce qui a échoué, et arrête-toi : jamais de
   contournement par credentials, jamais d'ouverture d'un fichier de secrets.

## Phase 3 — Synthèse et rapport

Lis les rapports sources (pas les digests). Croise, arbitre, déduplique contre l'inventaire du
lecteur réceptacles. REJETTE tout finding sans preuve traçable (session, chiffre, citation).
Écris `_memory_/retros/YYYY-MM-DD-<slug-du-chantier>.md` (crée le dossier au besoin) :

1. **Fiche du chantier** — chiffres mécaniques de `_index.md` (sessions, prompts, erreurs,
   coupures, tokens, commits, période).
2. **Résumé exécutif** — 8 lignes max.
3. **Ce qui a marché — à répliquer** (avec preuves).
4. **Ce qui a coûté — frictions chiffrées** (avec preuves).
5. **Leçons proposées** — chacune pré-formatée pour sa destination : playbook
   (`~/.claude/erom-playbook.md`, format « **leçon.** justification (source) » dans la section
   thématique adaptée), gotchas (`_memory_/gotchas.md` du projet, format du fichier),
   CLAUDE.md (diff proposé, projet ou global).
6. **Outillage manquant** — candidats skills/commandes/MCP/plugins avec justification chiffrée.
7. **Caveats méthodologiques** — ce que la rétro n'a pas pu voir (lots redispatchés, sessions
   hors fenêtre, Linear injoignable…).
8. **Écritures appliquées** — laissé « en attente de validation » à ce stade.

Une leçon déjà présente dans un réceptacle n'est PAS re-proposée : elle peut apparaître en
« confirmée une fois de plus » dans la section 3 ou 4, sans écriture associée.

## Phase 4 — Écritures validées

1. Présente le tableau des écritures proposées : destination, contenu exact, justification.
2. Fais valider par AskUserQuestion (multiSelect : Romain coche celles qu'il veut). RIEN ne
   s'écrit sans validation explicite.
3. Applique les écritures validées, puis renseigne la section 8 du rapport (appliquée /
   refusée, par item).
4. Commits, en ne stageant que les fichiers réellement touchés :
   - repo projet : le rapport (+ gotchas/CLAUDE.md projet si modifiés) —
     `docs(retro): rétrospective <chantier>` ;
   - `~/.claude` (repo git) : playbook / CLAUDE.md global si modifiés —
     `docs(playbook): leçons de la rétro <chantier>`.
5. Recap final : chiffres clés du chantier, liste des écritures appliquées, chemin du rapport,
   hash des commits. Chaque point self-contained.

## Garde-fous

- Le type `retro-reader` n'est pas livré par ce plugin : il vit dans `~/.claude/agents/retro-reader.md`,
  partagé avec la skill `harness-review`. S'il manque, la phase 2 ne peut pas partir : le dire à
  Romain plutôt que de basculer sur un autre type d'agent.
- Une rétro ne modifie JAMAIS de code, uniquement rapport + réceptacles validés.
- Les digests/rapports sources restent dans le scratchpad ; ne jamais les copier dans le repo.
- Si le fan-out dépasse ~12 lecteurs, regroupe davantage : au-delà, le coût explose sans gain.
- Avant de confier un rôle à un sous-agent, vérifie que son type expose les tools dont la
  mission dépend. Une liste `tools:` explicite dans la définition d'agent exclut les MCP de
  plugin, et `ToolSearch` ne peut pas indexer ce qui n'est pas dans son périmètre : la mission
  échoue alors à chaque exécution, pas une fois sur dix.
- Ferme les lecteurs dès leurs rapports lus (`TaskStop` sur chacun). Un agent terminé garde son
  pane, le serveur tmux du swarm plafonne autour de 8, et la rétro elle-même sature le plafond
  si elle ne fait pas son ménage (constaté le 2026-08-13 : 8 panes sur 8 occupés par des
  lecteurs finis depuis un quart d'heure).
- En cas de coupure quota pendant la phase 2-3 : l'état vit dans le scratchpad (digests +
  rapports sources déjà écrits) ; à la reprise, redispatche uniquement les lots sans rapport.
