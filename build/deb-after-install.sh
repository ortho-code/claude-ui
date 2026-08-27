#!/bin/sh
# Runs as root at the end of `apt install` / `dpkg -i`, via electron-builder's deb.afterInstall.
#
# It exists to spare whoever installs this the "just install it a second time" instruction, which is what the WSLg icon race otherwise costs.
# Both steps below are no-ops on a machine that does not need them, and nothing here is allowed to fail an install.
set -e

ENTRY=/usr/share/applications/claude-ui-app.desktop

# The icon theme cache has to know about the icons this package just unpacked.
# dpkg's own hicolor-icon-theme trigger does exactly this, but triggers run at the END of the dpkg run — after every postinst, and therefore after the watcher below has already looked.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -f /usr/share/icons/hicolor 2>/dev/null || true
fi

# WSLg turns a desktop entry's icon into a Windows .ico as soon as the entry appears, and caches the result under the app's name.
# During an install it can read the entry before the icons resolve, and then caches the DISTRO'S OWN LOGO — which is what shows in the Start menu from then on.
# It re-converts on a create event and ignores a plain modification, so re-create the entry now that the icons and the cache are in place.
# Restricted to WSL: nothing else has this behaviour.
if [ -e "$ENTRY" ] && grep -qi microsoft /proc/version 2>/dev/null; then
  tmp=$(mktemp) || exit 0
  cat "$ENTRY" >"$tmp"
  rm -f "$ENTRY"
  # Give the watcher a moment to see the entry go, so the write below reads as a create rather than being coalesced with the delete.
  sleep 1
  cat "$tmp" >"$ENTRY"
  chmod 644 "$ENTRY"
  rm -f "$tmp"
fi

exit 0
