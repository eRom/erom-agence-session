#!/usr/bin/env bash
# handoff-init.sh : prépare le terrain d'une passation de session.
#
# Ne rédige rien : résout l'identité de la session source, calcule le chemin de
# sortie canonique, crée le dossier, et rassemble le socle factuel (répertoire,
# branche, working tree, derniers commits) que le document de passation doit
# citer. L'agent écrit ensuite le fichier lui-même avec Write.
#
# Usage : handoff-init.sh "[nom de la session cible]"
#         Sans argument, la cible est notée "unassigned" (passation déposée pour
#         une session qui n'existe pas encore).

set -uo pipefail

TARGET_RAW="${1:-}"
# Résolu depuis l'emplacement du script : le plugin vit dans un cache versionné,
# jamais à un chemin fixe sous ~/.claude.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHOAMI="$SCRIPT_DIR/../../session-whoami/scripts/session-whoami.sh"
OUT_DIR="/tmp/claude-$(id -u)/handoffs"

# --- slug : nom de session -> fragment de nom de fichier ---------------------
# Les noms de session sont souvent des titres de conversation entiers
# ("Créer pages HTML autonomes pour atlas avec SEO"), parfois suivis d'un [ref].
slug() {
  local raw="$1" out=""
  raw="$(printf '%s' "$raw" | sed -E 's/\[[0-9a-f]{4,}\]//g')"
  # python3 déplie les accents (é -> e) ; iconv //TRANSLIT ne le fait pas sur macOS.
  out="$(printf '%s' "$raw" | python3 -c '
import re, sys, unicodedata
s = unicodedata.normalize("NFKD", sys.stdin.read())
s = "".join(c for c in s if not unicodedata.combining(c)).lower()
print(re.sub(r"-+$", "", re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]))
' 2>/dev/null)" || out=""
  if [ -z "$out" ]; then
    out="$(printf '%s' "$raw" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E -e 's/[^a-z0-9]+/-/g' -e 's/^-+//' -e 's/-+$//' \
      | cut -c1-40 | sed -E 's/-+$//')"
  fi
  printf '%s' "$out"
}

# --- identité de la session source ------------------------------------------
SOURCE_NAME=""
SOURCE_CWD=""
SOURCE_BRANCH=""
SOURCE_TRANSCRIPT=""
if [ -x "$WHOAMI" ] || [ -f "$WHOAMI" ]; then
  WHOAMI_JSON="$(bash "$WHOAMI" --json 2>/dev/null)" || WHOAMI_JSON=""
  if [ -n "$WHOAMI_JSON" ]; then
    IFS=$'\t' read -r SOURCE_NAME SOURCE_CWD SOURCE_BRANCH SOURCE_TRANSCRIPT <<EOF
$(printf '%s' "$WHOAMI_JSON" | python3 -c '
import json,sys
d = json.load(sys.stdin)
i, l = d.get("identity", {}), d.get("location", {})
print("\t".join([
    i.get("name") or "-",
    l.get("cwd") or "-",
    l.get("git_branch") or "-",
    l.get("transcript") or "-",
]))
' 2>/dev/null)
EOF
  fi
fi
[ -z "${SOURCE_NAME:-}" ] && SOURCE_NAME="session-inconnue"
[ -z "${SOURCE_CWD:-}" ] || [ "${SOURCE_CWD:-}" = "-" ] && SOURCE_CWD="$PWD"

TARGET_NAME="${TARGET_RAW:-unassigned}"
SOURCE_SLUG="$(slug "$SOURCE_NAME")"
TARGET_SLUG="$(slug "$TARGET_NAME")"
[ -z "$SOURCE_SLUG" ] && SOURCE_SLUG="source"
[ -z "$TARGET_SLUG" ] && TARGET_SLUG="unassigned"

STAMP="$(date +%Y-%m-%d-%H%M)"
ISO="$(date +%Y-%m-%dT%H:%M:%S%z)"
mkdir -p "$OUT_DIR" 2>/dev/null
OUT_PATH="$OUT_DIR/${SOURCE_SLUG}-to-${TARGET_SLUG}-${STAMP}.md"

# --- socle factuel du répertoire de travail ---------------------------------
cd "$SOURCE_CWD" 2>/dev/null || true
GIT_STATUS=""
GIT_LOG=""
GIT_HEAD=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [ -z "$SOURCE_BRANCH" ] || [ "$SOURCE_BRANCH" = "-" ] && SOURCE_BRANCH="$(git branch --show-current 2>/dev/null)"
  GIT_HEAD="$(git rev-parse --short HEAD 2>/dev/null)"
  GIT_STATUS="$(git status --short 2>/dev/null | head -25)"
  GIT_LOG="$(git log --oneline -5 2>/dev/null)"
fi

echo "## Passation : socle factuel"
echo
echo "- Source        : $SOURCE_NAME"
echo "- Cible         : $TARGET_NAME"
echo "- Horodatage    : $ISO"
echo "- Fichier à écrire : $OUT_PATH"
echo "- Répertoire    : $SOURCE_CWD"
[ -n "$SOURCE_TRANSCRIPT" ] && [ "$SOURCE_TRANSCRIPT" != "-" ] && echo "- Transcript    : $SOURCE_TRANSCRIPT"
if [ -n "$GIT_HEAD" ]; then
  echo "- Git           : branche ${SOURCE_BRANCH:-?} @ $GIT_HEAD"
  echo
  if [ -n "$GIT_STATUS" ]; then
    echo "### Working tree (non commité)"
    echo '```'
    printf '%s\n' "$GIT_STATUS"
    echo '```'
    echo "ATTENTION : ces fichiers sont sales. Romain mène des sessions parallèles sur"
    echo "le même repo : la cible ne doit pas présumer que ce dirty est le sien."
  else
    echo "- Working tree  : propre"
  fi
  echo
  echo "### 5 derniers commits"
  echo '```'
  printf '%s\n' "$GIT_LOG"
  echo '```'
else
  echo "- Git           : hors dépôt"
fi
