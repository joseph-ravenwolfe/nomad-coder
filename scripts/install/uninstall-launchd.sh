#!/usr/bin/env bash
# Uninstall the nomad-coder launchd service.
#
# Bootouts the running daemon and removes the plist file. With --purge, also
# deletes the cache directory and log files. Does NOT remove the cloned repo.
#
# Usage:
#   scripts/install/uninstall-launchd.sh           # service only
#   scripts/install/uninstall-launchd.sh --purge   # service + cache + logs

set -euo pipefail

LABEL="com.joseph-ravenwolfe.nomad-coder"
LEGACY_LABEL="com.electrified-cortex.nomad-coder"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
PURGE=0

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    *) ;;
  esac
done

echo "==> Bootouting service"
launchctl bootout "gui/$(id -u)/$LABEL"        2>/dev/null || true
launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" 2>/dev/null || true
sleep 2

if [ -f "$PLIST_DEST" ]; then
  rm -f "$PLIST_DEST"
  echo "Removed: $PLIST_DEST"
else
  echo "(no plist at $PLIST_DEST)"
fi

if [ -f "$LEGACY_PLIST" ]; then
  rm -f "$LEGACY_PLIST"
  echo "Removed legacy: $LEGACY_PLIST"
fi

if [ "$PURGE" = "1" ]; then
  echo "==> Purging cache + logs"
  rm -rf "$HOME/.cache/nomad-coder"
  rm -f "$HOME/Library/Logs/nomad-coder.log" "$HOME/Library/Logs/nomad-coder.err.log"
  echo "Removed: $HOME/.cache/nomad-coder"
  echo "Removed: $HOME/Library/Logs/nomad-coder.{log,err.log}"
fi

echo ""
echo "Uninstalled. The cloned repo at $(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd) is untouched."
