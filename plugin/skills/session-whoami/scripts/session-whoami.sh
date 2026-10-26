#!/bin/bash
# session-whoami : carte d'identité de la session Claude Code courante.
# Usage : session-whoami.sh [--json]
#
# Perimetre volontairement etroit : ce qu'il faut pour designer, retrouver ou
# joindre une session depuis l'exterieur. Tout le reste (modele, quotas, pairs)
# est lisible ailleurs et n'a pas sa place ici.
set -uo pipefail

FORMAT="markdown"
[ "${1:-}" = "--json" ] && FORMAT="json"

CLAUDE_HOME="$HOME/.claude"
UID_NUM="$(id -u)"

# ---------------------------------------------------------------- helpers ---
psline() { RTK_DISABLED=1 command ps -ww -o "$2=" -p "$1" 2>/dev/null | head -1; }
nn()     { [ -n "${1:-}" ] && [ "$1" != "null" ]; }

# Nom lisible d'un process : "bun /Users/.../caserne run claude --" -> "caserne run claude"
# Le "--" separateur et le "-" des shells de login sont du bruit : on les coupe.
procname() {
  local cmd="$1" first rest out
  first="${cmd%% *}"; rest="${cmd#* }"
  case "$(basename -- "$first")" in
    bun|node|python|python3|uv|deno)
      # runtime generique : le nom qui compte est celui du script qui suit
      out="$(basename -- "${rest%% *}") ${rest#* }" ;;
    login) out="login" ;;
    *) out="$(basename -- "$first")" ;;
  esac
  echo "$out" | sed -e 's/^-//' -e 's/ --$//' -e 's/  */ /g' | cut -c1-60
}

# TERM_PROGRAM porte un identifiant technique ; on le rend presentable.
pretty_term() {
  case "${1:-}" in
    zed) echo "Zed" ;;
    vscode) echo "VS Code" ;;
    iTerm.app) echo "iTerm" ;;
    Apple_Terminal) echo "Terminal.app" ;;
    ghostty) echo "Ghostty" ;;
    WarpTerminal) echo "Warp" ;;
    tmux) echo "tmux" ;;
    "") echo "" ;;
    *) echo "$1" ;;
  esac
}

# --------------------------------------------------------------- identite ---
# CLAUDE_PID est injecte dans l'env de chaque outil Bash par le harness.
# Fallback : on remonte les ancetres jusqu'a trouver le binaire claude.
PID="${CLAUDE_PID:-}"
if [ -z "$PID" ]; then
  p=$PPID
  for _ in 1 2 3 4 5 6; do
    [ -z "$p" ] || [ "$p" = "1" ] && break
    case "$(psline "$p" command)" in *claude*--remote-control*|*/claude\ *|claude\ *) PID="$p"; break ;; esac
    p="$(psline "$p" ppid | tr -d ' ')"
  done
fi

REG="$CLAUDE_HOME/sessions/${PID}.json"
REG_OK=1
if [ -r "$REG" ]; then
  eval "$(jq -r '
    @sh "R_NAME=\(.name // "")
         R_SID=\(.sessionId // "")
         R_CWD=\(.cwd // "")
         R_SOCK=\(.messagingSocketPath // "")
         R_BRIDGE=\(.bridgeSessionId // "")"' "$REG")"
else
  REG_OK=0
  R_NAME=""; R_SID="${CLAUDE_CODE_SESSION_ID:-}"; R_CWD="$PWD"
  R_SOCK="${CLAUDE_CODE_MESSAGING_SOCKET:-}"; R_BRIDGE="${CLAUDE_CODE_BRIDGE_SESSION_ID:-}"
fi
[ -n "$R_SID" ] || R_SID="${CLAUDE_CODE_SESSION_ID:-}"
[ -n "$R_CWD" ] || R_CWD="$PWD"

BRIDGE_URL=""
nn "$R_BRIDGE" && BRIDGE_URL="https://claude.ai/code/$R_BRIDGE"

# --------------------------------------------------------------- lanceur ----
# La chaine des parents dit comment la session a ete lancee (caserne, tmux, un
# IDE, un cron). Ni l'env ni le registre ne portent cette information.
ANCESTORS=()
p="$(psline "$PID" ppid | tr -d ' ')"
for _ in 1 2 3 4 5 6; do
  [ -z "$p" ] || [ "$p" = "0" ] || [ "$p" = "1" ] && break
  c="$(psline "$p" command)"; [ -z "$c" ] && break
  ANCESTORS+=("$(procname "$c")")
  p="$(psline "$p" ppid | tr -d ' ')"
done

# Le lanceur retenu : le premier ancetre qui n'est pas un shell de transport.
# bash 3.2 (celui d'Apple) traite un tableau vide comme unbound sous set -u :
# la forme ${x[@]+"${x[@]}"} est la seule portable quand la chaine est vide.
LAUNCHER=""
for a in ${ANCESTORS[@]+"${ANCESTORS[@]}"}; do
  case "$a" in zsh|bash|sh|login|env) continue ;; *) LAUNCHER="$a"; break ;; esac
done
TERM_APP="$(pretty_term "${TERM_PROGRAM:-}")"
[ -n "$LAUNCHER" ] || LAUNCHER="${TERM_APP:-shell}"

# ------------------------------------------------------------------ lieux ---
# Le slug projet remplace / et . par - (convention du harness).
SLUG="$(echo "$R_CWD" | sed 's/[\/.]/-/g')"
TRANSCRIPT="$CLAUDE_HOME/projects/$SLUG/$R_SID.jsonl"
[ -r "$TRANSCRIPT" ] || TRANSCRIPT=""
TRANSCRIPT_SIZE=""
[ -n "$TRANSCRIPT" ] && TRANSCRIPT_SIZE="$(du -h "$TRANSCRIPT" 2>/dev/null | cut -f1 | tr -d ' ')"

SCRATCH="/private/tmp/claude-$UID_NUM/$SLUG/$R_SID/scratchpad"
[ -d "$SCRATCH" ] || SCRATCH=""

GIT_BRANCH=""
if git -C "$R_CWD" rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH="$(git -C "$R_CWD" --no-optional-locks branch --show-current 2>/dev/null)"
  [ -n "$GIT_BRANCH" ] || GIT_BRANCH="detached@$(git -C "$R_CWD" rev-parse --short HEAD 2>/dev/null)"
fi

# ----------------------------------------------------------------- sortie ---
if [ "$FORMAT" = "json" ]; then
  jq -n \
    --arg name "$R_NAME" --arg session_id "$R_SID" --argjson pid "${PID:-0}" \
    --arg bridge_session_id "$R_BRIDGE" --arg bridge_url "$BRIDGE_URL" \
    --arg socket "$R_SOCK" --arg launcher "$LAUNCHER" --arg terminal "$TERM_APP" \
    --arg cwd "$R_CWD" --arg transcript "$TRANSCRIPT" --arg transcript_size "$TRANSCRIPT_SIZE" \
    --arg scratchpad "$SCRATCH" --arg git_branch "$GIT_BRANCH" \
    --argjson registry_found "$REG_OK" \
    '
    # walk redefini localement : absent de jq < 1.6, et ce script doit tourner partout.
    def w(f): . as $in
      | if type == "object" then reduce keys_unsorted[] as $k ({}; .[$k] = ($in[$k] | w(f)))
        elif type == "array" then map(w(f))
        else f end;
    {
      identity: {name: $name, session_id: $session_id, pid: $pid,
                 bridge_session_id: $bridge_session_id, bridge_url: $bridge_url,
                 messaging_socket: $socket, launcher: $launcher, terminal: $terminal,
                 registry_found: ($registry_found == 1)},
      location: {cwd: $cwd, transcript: $transcript, transcript_size: $transcript_size,
                 scratchpad: $scratchpad, git_branch: $git_branch}
    }
    # une chaine vide veut dire "non applicable ici" : null le dit mieux au consommateur
    | w(if type == "string" and . == "" then null else . end)'
  exit 0
fi

# --- Markdown (sans tableau) -------------------------------------------------
# Une ligne absente vaut mieux qu'une ligne a "?" : le lecteur doit pouvoir
# faire confiance a ce qui s'affiche sans verifier derriere.
code() { nn "${2:-}" && echo "- **$1** : \`$2\`${3:-}"; }

echo "## Session \`${R_NAME:-sans nom}\`"
echo
code "Session ID (harness)" "$R_SID"
code "PID" "$PID"
# nn "$R_BRIDGE" && echo "- **Session claude.ai** : \`$R_BRIDGE\` ($BRIDGE_URL)"
nn "$R_BRIDGE" && echo "- **Session claude.ai** : \`$R_BRIDGE\`"
code "Socket messaging" "$R_SOCK"
term_suffix=""
[ -n "$TERM_APP" ] && [ "$TERM_APP" != "$LAUNCHER" ] && term_suffix=" depuis $TERM_APP"
code "Lancée par" "$LAUNCHER" "$term_suffix"
[ "$REG_OK" = "0" ] && echo "- **Registre** : absent (\`$REG\`), infos reconstituées depuis l'environnement seul"
echo
echo "### Lieu de travail"
echo
code "Répertoire" "$R_CWD"
nn "$GIT_BRANCH" && echo "- **Git** : branche \`$GIT_BRANCH\`"
code "Transcript" "$TRANSCRIPT" "${TRANSCRIPT_SIZE:+ ($TRANSCRIPT_SIZE)}"
code "Scratchpad" "$SCRATCH"

# Les lignes ci-dessus sont conditionnelles : sans ce exit, un champ absent en
# derniere position ferait sortir le script en erreur et passer pour un echec.
exit 0
