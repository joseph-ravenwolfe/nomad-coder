#!/usr/bin/env bash
# Install the nomad-coder bridge as a launchd service on macOS.
#
# Reads the plist template from this directory, substitutes operator-specific
# paths (HOME, NODE_BIN, REPO_ROOT, PATH, AUTO_APPROVE_AGENTS), bootouts any
# previously-loaded service with the same label, then bootstraps the new one.
#
# Usage:
#   scripts/install/install-launchd.sh                   # AUTO_APPROVE_AGENTS=1 (default)
#   scripts/install/install-launchd.sh --no-auto-approve # AUTO_APPROVE_AGENTS=0
#
# Exits 0 on success, non-zero on failure. Prints the path of the installed
# plist and the running PID.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/com.electrified-cortex.nomad-coder.plist.template"
LABEL="com.electrified-cortex.nomad-coder"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Repo root is two levels up from this script (scripts/install/ → repo root).
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

# Default: enable AUTO_APPROVE_AGENTS=1 (single-operator setup). Override with
# --no-auto-approve to require explicit /approve for each session_start.
AUTO_APPROVE_AGENTS="1"
for arg in "$@"; do
  case "$arg" in
    --no-auto-approve) AUTO_APPROVE_AGENTS="0" ;;
    *) ;;
  esac
done

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
  "$TEMPLATE" > "$TMP_PLIST"

mkdir -p "$HOME/Library/LaunchAgents"

# Bootout any existing service with the same label. Ignore "no such process"
# (exit 3) — just means nothing was loaded, which is fine.
echo "==> Bootouting existing service (if loaded)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 2

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
