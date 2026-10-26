![erom-session](plugin/assets/plugin.png)

# erom-session

Plugin Claude Code pour gérer le cycle de vie d'une session d'agent : savoir qui elle est, choisir ses plugins, passer le relais à une autre session, tirer le bilan d'un chantier et refermer proprement.

## Installation

```
/plugin marketplace add eRom/erom-marketplace
/plugin install erom-session@erom-marketplace
```

## Les skills

| Skill | Invocation | Ce qu'elle fait |
|---|---|---|
| `session-whoami` | `/erom-session:session-whoami [--json]` | Carte d'identité de la session courante : nom, session ID, PID, session claude.ai, socket de messagerie, lanceur, répertoire, branche, transcript et scratchpad. |
| `session-profile` | `/erom-session:session-profile [list \| add \| rm]`, ou en langage naturel | Active ou coupe des plugins pour le répertoire courant seulement, via `.claude/settings.local.json`. Profils prédéfinis (`common`, `dev`, `design`...) et LSP ajouté selon le langage détecté. |
| `session-handoff` | `/erom-session:session-handoff [cible] [sujet]` | Condense la conversation en document de passation (mission, décisions, impasses, pièges, première action) et notifie la session cible. |
| `session-retro` | `/erom-session:session-retro [chantier]` | Rétrospective de chantier : digest des transcripts, lecture parallèle par subagents, rapport dans `_memory_/retros/` et écritures proposées pour validation. |
| `session-end` | « fin de session », « sauvegarde le contexte projet » | Cartographie la connaissance projet dans `_memory_/` puis commite et pousse ces seuls fichiers. |

## Prérequis

- `bun` pour `session-profile` et le digest de `session-retro`.
- `jq` et `git` pour `session-whoami` et `session-handoff`.
- `session-retro` dispatche des lecteurs de type `retro-reader`, un agent défini côté utilisateur (`~/.claude/agents/retro-reader.md`) et non livré par ce plugin.
- Le second bus de `session-handoff` et le volet Linear de `session-retro` s'appuient sur `erom-caserne`, facultatif.

## Licence

MIT, Romain Ecarnot.
