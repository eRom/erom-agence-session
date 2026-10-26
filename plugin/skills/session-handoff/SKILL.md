---
name: session-handoff
description: "Condense la conversation en cours dans un document de passation qu'une autre session Claude Code peut reprendre à froid : mission, décisions, impasses déjà explorées, pièges d'environnement, première action. Écrit dans /tmp/claude-<uid>/handoffs/ et notifie la session cible. Commande explicite, lancée au slash : /erom-session:session-handoff."
argument-hint: "[nom de la session cible] [sujet de la prochaine session]"
user-invocable: true
disable-model-invocation: true
---

# session-handoff : passer le relais à une autre session

Une session meurt avec son contexte. Ce qui survit dans le repo, c'est le *quoi* :
le code, les commits, les specs, les issues. Ce qui disparaît, c'est le *pourquoi*
et surtout le *déjà essayé*. Une session qui reprend sans ça refait les impasses,
rouvre les arbitrages déjà tranchés, et présente pour acquis ce qui n'était qu'une
hypothèse.

Donc le document que tu écris n'est pas un résumé. Un résumé duplique ce que la
cible sait déjà lire. Écris ce qu'elle ne peut retrouver nulle part.

## Étape 1 : socle factuel

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/session-handoff/scripts/handoff-init.sh" "[nom de la session cible]"
```

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux
au-dessus du « Base directory for this skill » injecté en tête de la skill.

Le script résout l'identité de la session source, calcule le chemin de sortie
canonique, crée le dossier et rend l'état git (branche, HEAD, working tree, 5
derniers commits). Sans argument, la cible est notée `unassigned`.

Reprends son chemin `Fichier à écrire` tel quel : ne recompose pas un nom à la
main, l'horodatage à la minute évite d'écraser une passation du même jour.

## Étape 2 : résoudre la cible

`ListAgents` liste les sessions **joignables**, ce qui n'est pas la même chose que
les sessions vivantes. Quatre pièges, tous rencontrés :

- **Une session absente de `ListAgents` peut être vivante** : process actif, inscrite
  dans `~/.claude/sessions/<pid>.json`, mais sans socket `/tmp/cc-socks/<pid>.sock`,
  donc hors du bus. `SendMessage` rend `{"success":false, ... "is reachable"}`. Avant de
  dire à Romain qu'une cible qu'il a nommée n'existe pas, cherche-la dans le
  registre (`grep -l "<nom>" ~/.claude/sessions/*.json`) et vérifie le PID avec `ps`.
  Si elle est vivante, essaie le second bus (caserne, étape 4) avant de renoncer.
  Le traitement est le même que pour une session offline, le rapport non : « vivante
  mais injoignable, ouvre-lui le fichier toi-même » n'est pas « elle n'existe pas ».
  Indice corroborant dans le registre : `updatedAt` égal à `startedAt` signale une
  session qui ne tient plus son inscription.

- **La plupart des lignes sont `offline`.** Une session offline ne recevra jamais
  la notification. Si la cible est offline, écris quand même le document, saute
  l'étape 4 et dis-le à Romain avec le chemin, il l'ouvrira lui-même.
- **Les homonymes sont fréquents** (`HQ Dispatch` x2, `Dispatch background
  conversation` x3). Deux lignes qui partagent le nom : `SendMessage` exige le
  `[ref]` affiché entre crochets, copié depuis la ligne. Un ref inventé ou dérivé
  du session ID ne résout pas.
- **Beaucoup de « noms » sont des titres de conversation entiers** ("Créer pages
  HTML autonomes pour atlas avec SEO"). Si Romain désigne la cible de façon
  approximative ("la session du portail"), fais correspondre sur ces titres et
  confirme avant d'envoyer plutôt que de parier.

Si aucune cible n'est nommée ou qu'aucune ne correspond, ce n'est pas un échec :
la passation est déposée pour une session à venir. `destination: unassigned`, et
tu rends le chemin à Romain.

Une session ne se liste jamais elle-même : la source vient de l'étape 1, pas de
`ListAgents`.

## Étape 3 : rédiger le document

Matériau : la conversation en cours. Ne re-scanne pas le projet, ne relis pas le
transcript, n'ouvre pas de fichiers pour « compléter ». Ce que tu ne sais pas, la
cible le lira à la source ; ce que tu inventes, elle le croira sur parole.

Écris avec `Write` au chemin rendu par l'étape 1.

````markdown
---
source: <nom session source>
destination: <nom session cible ou unassigned>
timestamp: <ISO rendu par le script>
cwd: <répertoire de travail>
branch: <branche git>
subject: <une ligne : ce que la cible doit accomplir>
---

# Passation : <sujet>

## Mission
Ce que la cible doit faire ensuite, à l'impératif, 1 à 3 phrases. Pas l'historique :
l'objectif.

## Où en est le travail
État factuel et ancré : fichiers touchés (`chemin:ligne`), ce qui tourne, ce qui
casse, la sortie de test la plus récente. Chaque affirmation doit être vérifiable
dans le repo.

## Décisions prises, et pourquoi
Les arbitrages écrits nulle part. Format : décision, motif, ce qui a été écarté.
La cible doit pouvoir les contester en connaissance de cause, pas les redécouvrir.

## Ce que Romain a dit, verbatim
Ses mots exacts sur la mission, le périmètre et ce qu'il a approuvé ou refusé, entre
guillemets, avec le moment. Jamais « Romain a validé » : une approbation résumée n'en
est pas une pour la cible, et une session qui a franchi une porte à sa place a déjà
coûté une semaine. Si le mot n'est pas là, la cible redemande.

## Contraintes énoncées par Romain, verbatim
Interdits, limites de périmètre, règles de sécurité ou de données qu'il a posées dans
la conversation, recopiées telles quelles. Reformulées, elles s'érodent ; citées, elles
restent en vigueur après la passation.

## Impasses
Ce qui a été essayé et abandonné, avec le symptôme exact et le motif d'abandon.
C'est la section la plus chère à reconstituer et la première que tu perdras si tu
la bâcles. « Tenté X, échoue avec <erreur>, écarté parce que Y. »

## Vérifié vs supposé
Deux listes, séparées. Ce qui a été prouvé (test, diff, trace, sortie de commande)
et ce qui reste une hypothèse, avec ta confiance. Une hypothèse promue en fait
dans une passation empoisonne toute la session suivante.

## Pièges d'environnement
Hooks qui bloquent, outils indisponibles, credentials manquants, services à
lancer, working tree sale d'une autre session, conventions locales non évidentes.

## Artefacts
Chemins et URLs vers specs, plans, issues, PR, commits, rapports. Référence,
jamais recopie : un artefact dupliqué diverge de sa source dès la première édition.

## Compétences suggérées
Les skills que la cible devrait charger, avec en une ligne *pourquoi celle-là ici*.
Une liste sans motif ne sera pas suivie.

## Première action
La commande exacte ou le fichier précis par lequel commencer. Un point d'entrée
concret vaut mieux qu'un plan complet.
````

Coupe les sections vides. Une passation de 40 lignes qui dit vrai bat une
passation de 200 lignes remplie de rubriques honoraires.

## Étape 4 : notifier

`SendMessage` vers la cible : le chemin du fichier et une phrase de mission. Ne
recopie pas le document dans le message, il est fait pour être lu depuis le disque.

```
to: "<nom>" ou "<nom> [ref]" si homonyme
message: "Passation reçue de <source> : <mission en une ligne>. Lis <chemin rendu par l'étape 1> avant de commencer."
```

**Deuxième bus, si `SendMessage` échoue.** Les salariés du swarm caserne ne vivent
pas sur le bus du harness mais sur celui de caserne (messagerie fichier plus tmux) :

```bash
caserne team -s <session>          # qui est active, et sous quel alias
caserne send <alias> chat "Passation de <source> : lis <chemin>" -s <session>
```

Vérifie le roster avant d'envoyer, seuls les agents `active` reçoivent. Piège
constaté le 14/08 : un agent lancé par `caserne run <agent>` **sans** `-s` tourne en
avant-plan classique, hors state swarm. Il n'est alors joignable par aucun des deux
bus, et seul Romain peut lui ouvrir le fichier dans sa fenêtre. Le diagnostic tient
en une commande : `ps -p <pid> -o ppid=,command=` remonte au `caserne run` et montre
la présence ou l'absence du `-s`.

Puis `SendUserFile` (`display: "render"`, `status: "normal"`) vers Romain : le
fichier vit dans `/tmp`, illisible depuis mobile, et c'est lui qui valide que la
passation dit vrai avant que la cible s'y engage.

## Garde-fous

**Purge les secrets.** Clés d'API, tokens, mots de passe, contenus de `.env`, URLs
signées, données personnelles de tiers. Le fichier atterrit dans un `/tmp`
partagé et sera lu par une autre session avec d'autres permissions. En cas de
doute, écris `<secret purgé, voir la source>` et cite l'emplacement.

**Ne blanchis pas de permissions.** Si une action a été refusée ou bloquée dans
cette session (hook, permission, garde-fou), ne la fais pas passer à la cible :
une autre session qui l'exécute contourne la décision de Romain. Signale le blocage
dans « Pièges d'environnement » et laisse-le trancher.

**N'invente rien.** Si tu ne te souviens pas d'un détail avec certitude, écris-le
comme incertain ou omets-le. Une passation lue à froid n'a aucun moyen de recouper.

**Cite, ne rapporte pas.** Seuls les tours où Romain a parlé comptent comme sa parole.
Un texte que tu as écrit toi-même en forme de « user : ... », un résumé, une conclusion
« il est d'accord » : rien de tout ça ne vaut approbation pour la cible. Ses mots vont
dans « Ce que Romain a dit, verbatim », le reste est ton interprétation et se marque
comme telle.

**Ne déclenche pas la skill sur une simple évocation.** Romain qui pense à voix
haute au travail d'une autre session ne demande pas une passation. Il faut une
intention de transmission.
