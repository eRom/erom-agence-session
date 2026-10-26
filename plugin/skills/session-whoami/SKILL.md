---
name: session-whoami
description: "Carte d'identité de la session Claude Code courante : nom, session ID harness, PID, session claude.ai (bridge) avec son lien, socket messaging, lanceur, puis répertoire, branche git, transcript et scratchpad. Commande explicite, lancée au slash : /erom-session:session-whoami (option --json)."
allowed-tools: Bash, ListAgents
user-invocable: true
disable-model-invocation: true
---

# session-whoami

Rassemble en un appel ce qui identifie la session courante. Sans ça, Romain doit
reconstituer à la main le nom, le PID et l'ID de session pour désigner une
session dans une autre conversation, un dispatch ou un debug.

## Exécution

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/session-whoami/scripts/session-whoami.sh"          # Markdown
bash "${CLAUDE_PLUGIN_ROOT}/skills/session-whoami/scripts/session-whoami.sh" --json   # JSON
```

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux
au-dessus du « Base directory for this skill » injecté en tête de la skill.

Le script fait toute la collecte : ne recompose rien à la main, ne relance pas
`ps` ou `env` pour compléter. S'il ne rapporte pas un champ, c'est qu'il n'est
pas observable ici, et l'inventer serait pire que l'absence.

**Sortie Markdown** (défaut) : restitue le bloc tel quel, sans le reformater ni
le résumer. Il est déjà calibré (pas de tableau, listes à puces). N'ajoute une
phrase que si Romain a posé une question précise à laquelle un champ répond.

**Sortie `--json`** : rends le JSON brut dans un bloc `json`, sans commentaire
autour. C'est destiné à être copié ou redirigé, la prose le pollue.

Si Romain ne demande qu'un fragment ("c'est quoi le PID ?"), lance quand même le
script mais réponds par la seule ligne utile.

## Périmètre

Volontairement étroit : ce qu'il faut pour désigner, retrouver ou joindre une
session. Le modèle, l'effort, la version CLI, les quotas et les sessions
voisines en ont été retirés le 13/08/2026 (ils sont lisibles ailleurs, et une
carte d'identité qui déborde ne se lit plus d'un coup d'œil). Si Romain en
redemande un, la question à lui poser est s'il le veut *à demeure* : c'est une
ligne dans le script, mais chaque ligne ajoutée coûte à toutes les invocations
suivantes.

## Le ref court n'est pas observable de l'intérieur

Le code hexadécimal que `ListAgents` affiche entre crochets
(`claude-venus-zdga [997c9f]`) n'est écrit dans aucun fichier : il est calculé
en mémoire côté harness. Une session ne peut pas lire le sien, et `ListAgents`
ne se liste jamais elle-même. Ce ref ne sert qu'à lever une ambiguïté de
`SendMessage` entre deux sessions homonymes, et c'est l'émetteur qui le lit chez
lui. Si Romain le réclame, dis-le lui plutôt que de tenter une dérivation : le
ref n'est pas le début du session ID, la comparaison le prouve (`erom-hq-5f`
porte le ref `7276e7` pour le session ID `aa46dba8-…`).

## Cas limites

- **Depuis un subagent ou un fork** : `CLAUDE_PID` désigne la session parente, et
  c'est bien elle qu'il faut rapporter. Une identité de subagent ne se référence
  pas de l'extérieur, donc elle n'a pas d'intérêt ici.
- **Registre absent** (`~/.claude/sessions/<pid>.json` supprimé, session très
  ancienne) : le script bascule sur les variables d'environnement, rend un
  sous-ensemble et l'annonce par une ligne « Registre ». En JSON, c'est
  `identity.registry_found: false`. Ne laisse pas croire à une session sans nom
  quand c'est le registre qui manquait.
- **Autres sessions** : hors périmètre ici. Pour les lister (y compris Remote
  Control et cloud, qui ne vivent pas dans le registre local), utilise
  `ListAgents`.
