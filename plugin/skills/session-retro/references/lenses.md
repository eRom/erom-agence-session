# Lentilles de lecture — rétrospective de chantier

Manuel de mission des lecteurs du skill `session-retro`. L'orchestrateur assigne à chaque lecteur un
rôle (sessions / git / réceptacles / linear), ses entrées et le chemin de son rapport source.
Lis ce fichier EN PREMIER, puis exécute ta mission.

## Règles dures (tous les lecteurs)

1. **Preuve obligatoire.** Chaque finding cite sa source : id de session (8 premiers caractères),
   citation courte (2 lignes max) ou chiffre exact, plus un compte quand c'est une récurrence
   (« ×4 sur 3 sessions »). Un finding sans preuve sera rejeté à la synthèse — ne le produis pas.
2. **Secrets.** Si tu croises un credential (token, clé, mot de passe) dans un digest ou un
   transcript : signale « credential visible en session X » SANS jamais recopier la valeur,
   même partiellement. Le signalement est un finding légitime.
3. **Pas de généralités.** « Mieux documenter » est interdit. Le niveau attendu :
   « le contexte Stalwart a été redonné 3 fois (sessions a, b, c) → candidat CLAUDE.md projet ».
4. **Trajet, pas état.** Tu juges comment le travail s'est déroulé, jamais la qualité actuelle
   du code (c'est le créneau des reviews de code, hors périmètre).
5. **Deep-dive ciblé seulement.** Tu travailles sur les digests. Tu peux ouvrir un transcript
   brut (chemin en tête de digest) pour vérifier UN signal précis, avec `jq`/`grep` chirurgical —
   jamais le lire en entier.
6. Rapport source en **français**, écrit au chemin de sortie indiqué par ta mission. Ta réponse
   finale à l'orchestrateur : un résumé de 10 lignes max — c'est un retour de données, pas un
   message pour Romain.

## Lentille A — « Ça a marché, à répliquer »

Cherche avec autant d'énergie que sur la lentille B :
- Séquences efficaces : gros livrable en peu de tours, enchaînements sans friction.
- Outillage qui a payé : skills, tools, subagents dont l'usage a visiblement accéléré ou
  fiabilisé le travail (chiffre : combien d'usages, quel effet).
- Patterns d'orchestration réussis (fan-out parallèle, TDD, double review, checkpoints d'état)
  et leur rendement constaté.
- Décisions techniques dont le bénéfice se lit dans la suite du chantier.

## Lentille B — « Ça a coûté »

- Frictions : prompts de permission en série, hooks perturbateurs, allers-retours de correction.
- Boucles d'erreur : même erreur d'outil répétée (les digests portent des comptes ×N),
  retries aveugles, erreurs ignorées puis repayées.
- Répétitions de contexte : la même information redonnée sur 2 sessions ou plus
  (candidat CLAUDE.md ou mémoire).
- Signaux explicites de Romain : corrections (« non… »), frustrations (« !!! »), consignes
  répétées, validations. Chaque signal fort est un finding à part entière.
- Coupures quota : travail perdu, reprises confuses, subagents fauchés en vol.
- Outillage manquant : tâche faite à la main qui aurait dû être scriptée/outillée, rituel
  retapé, contournement récurrent, skill/plugin/MCP qui aurait changé la donne.
- Décisions techniques dont le coût est constaté dans la fenêtre (mocks masquant des bugs
  d'intégration, refacto évitable, dépendance regrettée).
- Fils morts : questions restées ouvertes, chantiers commencés jamais refermés.

## Format du rapport source (obligatoire, tous les lecteurs)

```markdown
# Rapport source — <rôle> — <périmètre du lot>

## Ça a marché
- [S:<id8>] <finding> — preuve : <citation courte ou chiffre>

## Ça a coûté
- [S:<id8>] <finding> — preuve : <…> — récurrence : ×N

## Candidats leçons (bruts)
- <leçon en une phrase> → destination pressentie : playbook | gotchas | CLAUDE.md projet | CLAUDE.md global

## Candidats outillage
- <manque constaté> — justification chiffrée : <…>

## Douteux / à vérifier
- <signal non prouvé qui mérite un second regard>
```

## Missions spécialisées

### Lecteur git
Entrées : chemin du repo projet + fenêtre [t0, t1]. Analyse `command git log` sur la fenêtre :
cadence par jour, taille et découpage des commits, reverts/fixups, messages incohérents,
branches abandonnées, gros commits fourre-tout vs découpage propre. Chiffre tout. Même format
de rapport source.

### Lecteur réceptacles
Entrées : `~/.claude/erom-playbook.md`, `_memory_/` du projet, CLAUDE.md projet et global.
Produis trois listes : (1) ce qui est DÉJÀ capturé et où (pour la dédup à la synthèse),
(2) ce que la pratique observée contredit (règle écrite non suivie, doc périmée),
(3) les trous évidents (domaine récurrent sans réceptacle). Même format de rapport source.

### Lecteur Linear (best-effort)
Si un projet Linear est joignable (ONBOARD.md du projet, tools MCP) : trajectoire des issues de
la fenêtre, issues restées en Todo, écarts plan/réalité. Si rien n'est joignable : écris
« Linear non joignable » dans ton rapport source et termine proprement sans bloquer.
