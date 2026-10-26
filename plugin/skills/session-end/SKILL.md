---
name: session-end
description: "Cartographie de fin de session : persiste la connaissance projet dans _memory_/, puis commit et push chirurgical de ces seuls fichiers. Uniquement sur demande explicite ('fin de session', 'end session', 'sauvegarde le contexte projet'), jamais sur simple politesse."
user-invocable: true
---

# session-end

Capture l'état de connaissance actuel du projet dans `_memory_/` pour que la prochaine session démarre sans phase de redécouverte. Utiliser le contexte accumulé pendant la session — **ne pas re-scanner tout le projet**.

## Fichiers à générer/mettre à jour

Si `_memory_/` n'existe pas, le créer.

Le skill possède **exactement ces 4 fichiers**. Ne touche à rien d'autre dans `_memory_/` : `ONBOARD.md`, `audit/` et le reste du dossier appartiennent à d'autres outils.

**`_memory_/architecture.md`** : type, objectif, stack, arborescence simplifiée des dossiers clés, couches/modules et communication, flux de données principaux, dépendances externes critiques.

**`_memory_/key-files.md`** : fichiers les plus importants. Pour chacun : chemin, rôle, contenu en 1 ligne. Regroupés par module/domaine. Inclure configs critiques (env, CI).

**`_memory_/patterns.md`** : conventions de nommage, patterns architecturaux (repository, service, controller…), patterns de code récurrents (error handling, logging, auth), style de tests, conventions commit/branching si observées.

**`_memory_/gotchas.md`** : pièges, bugs résolus + cause racine, configs subtiles, points d'attention, workarounds + pourquoi.

## Avant d'écrire : le contrôle des trouvailles ouvertes

Relis les cinq derniers tours de Romain. Pour chaque problème qu'il y a signalé (un bug, un rendu qui ne va pas, un « ça ne marche pas », une trouvaille de revue), demande-toi s'il a confirmé lui-même qu'il était réglé. Sa confirmation, pas la tienne : un taste-gate vert ou un test qui passe ne remplace pas son mot.

S'il en reste un non confirmé, nomme-le en tête de l'output, avant la ligne de cartographie :

```
Reste ouvert : <problème signalé, une ligne> (signalé à <HH:MM>, pas de confirmation depuis)
```

Ne bloque pas la session sur ce point, ne le corrige pas de ta propre initiative : signale-le, écris la cartographie, rends la main. Une session qui se ferme sur une trouvaille ouverte la perd, parce que la suivante démarre sur `_memory_` et pas sur le transcript. C'est déjà arrivé deux semaines de suite.

## Règles d'écriture

- **Concis** : chaque fichier lisible en 30 secondes.
- **Factuel, à deux niveaux** : un fait corroboré (test, diff, trace, ou 2e occurrence indépendante) s'écrit nu ; une observation à occurrence unique s'écrit avec le tag `[candidat 1x - <source>]`. Jamais de supposition.
- **Cycle de vie des candidats** : à la mise à jour suivante, un candidat re-confirmé perd son tag et devient fait nu ; un candidat jamais revu après plusieurs sessions se supprime.
- **Merge** : si les fichiers existent, mettre à jour plutôt qu'écraser. Ne JAMAIS supprimer d'info existante sauf si devenue fausse ou obsolète, ou candidat expiré (règle ci-dessus).
- **No-op** : ne réécris un fichier que si la session a apporté du contenu nouveau ou corrigé pour ce fichier ; rafraîchir la date seule ne justifie pas une écriture.
- **Date** : ajouter la date de dernière mise à jour en haut de chaque fichier mis à jour.
- À la **création** d'un fichier sans matière : placeholder `Aucun élément identifié pour le moment`.

## Dernière étape : commit & push chirurgical de `_memory_`

Ne s'exécute que si des fichiers ont réellement été écrits (voir No-op). Rien écrit = rien à commiter, on saute cette étape.

**Chirurgical** signifie : seuls les fichiers `_memory_/` que TU viens d'écrire partent dans le commit. Romain mène des sessions parallèles sur le même repo : tout autre fichier modifié ou déjà stagé ne t'appartient pas et ne doit jamais entrer dans ce commit.

1. Racine du repo, en absolu. Sans repo git, s'arrêter là et le dire.

   ```bash
   ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || echo "pas un repo git"
   ```

2. Fichiers ignorés : si `_memory_/` est gitignoré, ne rien commiter et le signaler.

   ```bash
   cd "$ROOT" && git check-ignore -q _memory_/architecture.md && echo "_memory_ gitignoré"
   ```

3. Stage puis commit sur pathspec explicite. La liste `<fichiers>` est exactement celle des fichiers mis à jour, jamais `git add .`, jamais `-A`, jamais `git add _memory_/` en bloc.

   `<fichiers>` est une suite d'arguments séparés par des espaces, chacun non quoté :
   `_memory_/architecture.md _memory_/gotchas.md`, et surtout pas
   `"_memory_/architecture.md _memory_/gotchas.md"`. Quotée, la liste entière arrive à git comme
   un seul chemin, et la commande sort en 128 avec `could not open directory` suivi de
   `fatal: pathspec ... did not match`. (17 et 18/09/2026, même échec sur deux repos neufs,
   `erom-tools-gmail-cli` et `erom-poc-typesage-ai`, alors que les fichiers existaient.)

   ```bash
   cd "$ROOT" && git add -- <fichiers> && git commit -m "chore(memory): cartographie de session <YYYY-MM-DD>" -- <fichiers>
   ```

   Le `-- <fichiers>` sur le `commit` est ce qui rend le geste chirurgical : il ignore tout ce qui traîne dans l'index en dehors de ces chemins.

4. Push seulement si la branche a un upstream. Sans upstream, laisser le commit local et le dire — ne jamais créer de remote ni deviner une branche cible.

   ```bash
   cd "$ROOT" && git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1 && git push
   ```

5. Push refusé (divergence, remote en avance) : **jamais** de `--force`, jamais de `pull --rebase` automatique. Laisser le commit local, rapporter la sortie brute de git et rendre la main.

## Output

```
Reste ouvert : <problème signalé, une ligne> (signalé à <HH:MM>, pas de confirmation depuis)
Session cartographiée : <YYYY-MM-DD | HH:MM> (fichiers mis à jour : <liste>)
Commit <sha court> poussé sur <branche>
```

La première ligne n'apparaît que si le contrôle des trouvailles ouvertes en a trouvé une, et elle passe toujours en premier : c'est la seule information de cet output que la session suivante ne retrouvera pas dans `_memory_`. Une par problème s'il y en a plusieurs.

Adapter la dernière ligne à ce qui s'est réellement passé : `Commit <sha court> local, pas d'upstream`, `Push refusé : <raison>, commit <sha court> local`, `_memory_ gitignoré, rien commité`, ou `Hors repo git, rien commité`. Ne jamais annoncer un push non vérifié.

Si la session n'a rien appris de nouveau : ne rien écrire, ne rien commiter, et répondre `Rien de neuf à cartographier.` — précédé de la ligne `Reste ouvert :` si le contrôle en a trouvé une. Une session sans apprentissage peut très bien se fermer sur un bug signalé.
