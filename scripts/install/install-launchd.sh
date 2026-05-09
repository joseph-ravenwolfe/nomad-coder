#!/usr/bin/env bash
# Install the nomad-coder bridge as a launchd service on macOS.
#
# Reads the plist template from this directory, substitutes operator-specific
# paths and choices (HOME, NODE_BIN, REPO_ROOT, PATH, AUTO_APPROVE_AGENTS,
# TERMINAL, CC_CLI_COMMAND), bootouts any previously-loaded service (current
# label *and* legacy `com.electrified-cortex.nomad-coder` for migration),
# then bootstraps the new one.
#
# Usage:
#   scripts/install/install-launchd.sh                              # defaults: ghostty + cc
#   scripts/install/install-launchd.sh --terminal iterm --cli claude
#   scripts/install/install-launchd.sh --no-auto-approve            # AUTO_APPROVE_AGENTS=0
#
# Flags:
#   --terminal <name>      ghostty | iterm | terminal | wave | warp   (default: ghostty)
#   --cli <command>        the binary used to launch Claude Code        (default: cc)
#   --no-auto-approve      AUTO_APPROVE_AGENTS=0 (default is 1)
#
# Exits 0 on success, non-zero on failure. Prints the path of the installed
# plist and the running PID.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/com.joseph-ravenwolfe.nomad-coder.plist.template"
LABEL="com.joseph-ravenwolfe.nomad-coder"
LEGACY_LABEL="com.electrified-cortex.nomad-coder"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"

# Repo root is two levels up from this script (scripts/install/ → repo root).
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

TERMINAL="ghostty"
CC_CLI_COMMAND="cc"
AUTO_APPROVE_AGENTS="1"

while [ $# -gt 0 ]; do
  case "$1" in
    --terminal)
      TERMINAL="${2:-}"; shift 2 ;;
    --terminal=*)
      TERMINAL="${1#--terminal=}"; shift ;;
    --cli)
      CC_CLI_COMMAND="${2:-}"; shift 2 ;;
    --cli=*)
      CC_CLI_COMMAND="${1#--cli=}"; shift ;;
    --no-auto-approve)
      AUTO_APPROVE_AGENTS="0"; shift ;;
    *)
      echo "warn: unknown arg: $1" >&2; shift ;;
  esac
done

# Validate terminal choice — must have a matching applescript.
LAUNCH_SCRIPT="$REPO_ROOT/scripts/cc/${TERMINAL}-cc-tab.applescript"
if [ ! -f "$LAUNCH_SCRIPT" ]; then
  echo "error: no launch script for terminal '$TERMINAL'." >&2
  echo "       expected: $LAUNCH_SCRIPT" >&2
  echo "       available: $(ls "$REPO_ROOT/scripts/cc/"*-cc-tab.applescript 2>/dev/null | sed 's|.*/||;s|-cc-tab.applescript||' | tr '\n' ' ')" >&2
  exit 2
fi

# Resolve Node binary from PATH. If `node` isn't on PATH, we can't install.
if ! command -v node >/dev/null 2>&1; then
  echo "error: \`node\` not found on PATH. Install Node.js (>=18) before running this script." >&2
  exit 2
fi
NODE_BIN="$(command -v node)"

# Build dist/ if it doesn't exist or is stale relative to src/.
if [ ! -d "$REPO_ROOT/dist" ] || [ -z "$(ls -A "$REPO_ROOT/dist" 2>/dev/null)" ]; then
  echo "==> Building dist/ (first install)"
  (cd "$REPO_ROOT" && npm install --silent && npm run build)
fi

# Path embedded in the plist must include Node's parent dir + standard system
# bins. We keep this conservative — the daemon doesn't need a user shell PATH.
NODE_DIR="$(dirname "$NODE_BIN")"
EMBED_PATH="$NODE_DIR:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Render the plist by substituting placeholders. Use a temp file to avoid
# clobbering the destination on partial writes.
TMP_PLIST="$(mktemp -t nomad-coder.plist.XXXXXX)"
trap 'rm -f "$TMP_PLIST"' EXIT

sed \
  -e "s|{{HOME}}|$HOME|g" \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{REPO_ROOT}}|$REPO_ROOT|g" \
  -e "s|{{PATH}}|$EMBED_PATH|g" \
  -e "s|{{AUTO_APPROVE_AGENTS}}|$AUTO_APPROVE_AGENTS|g" \
  -e "s|{{TERMINAL}}|$TERMINAL|g" \
  -e "s|{{CC_CLI_COMMAND}}|$CC_CLI_COMMAND|g" \
  "$TEMPLATE" > "$TMP_PLIST"

mkdir -p "$HOME/Library/LaunchAgents"

# Bootout any existing service with the new label OR the legacy label
# (`com.electrified-cortex.nomad-coder` from before the rename). Ignore
# "no such process" — just means nothing was loaded, which is fine.
echo "==> Bootouting existing service (if loaded)"
launchctl bootout "gui/$(id -u)/$LABEL"        2>/dev/null || true
launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" 2>/dev/null || true
sleep 2

# If a legacy plist file is sitting in LaunchAgents, remove it so it doesn't
# get re-bootstrapped on next login.
if [ -f "$LEGACY_PLIST" ]; then
  rm -f "$LEGACY_PLIST"
  echo "==> Removed legacy plist: $LEGACY_PLIST"
fi

# Move plist into place + bootstrap.
mv "$TMP_PLIST" "$PLIST_DEST"
trap - EXIT

echo "==> Bootstrapping $LABEL"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"

# Wait for the bridge to start listening on port 3099.
echo -n "==> Waiting for bridge to come up on port 3099 "
for i in $(seq 1 20); do
  if lsof -nP -iTCP:3099 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✓"
    PID="$(lsof -nP -iTCP:3099 -sTCP:LISTEN -t | head -n1)"
    echo ""
    echo "Installed: $PLIST_DEST"
    echo "Running:   PID $PID, http://127.0.0.1:3099/mcp"
    echo "Terminal:  $TERMINAL  (CC_LAUNCH_SCRIPT=$LAUNCH_SCRIPT)"
    echo "CLI:       $CC_CLI_COMMAND"
    echo "Logs:      $HOME/Library/Logs/nomad-coder.log"
    echo "          $HOME/Library/Logs/nomad-coder.err.log"
    exit 0
  fi
  sleep 0.5
  echo -n "."
done

echo " ✗"
echo "" >&2
echo "error: bridge did not start within 10s. Check logs:" >&2
echo "  tail -50 $HOME/Library/Logs/nomad-coder.err.log" >&2
exit 1
