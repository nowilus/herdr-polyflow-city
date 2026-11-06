#!/bin/sh
# PolyFlow Office screen: a second Herdr window with its own home, showing only the office.
# Usage: launch.sh <app home> <screen home>
set -u
src=${1:?app home}
dst=${2:?screen home}
mkdir -p "$dst/layouts" "$dst/themes" "$dst/mods"
for m in "$src"/mods/polyflow-*/; do
  name=$(basename "$m")
  rm -rf "$dst/mods/$name"
  cp -R "$m" "$dst/mods/$name"
  rm -f "$dst/mods/$name/gpui-kit.d.ts" "$dst/mods/$name/jsconfig.json"
done
cp "$src/themes/polyflow-neon.json" "$dst/themes/"
cp "$src/mods/polyflow-office/screen/office-screen.json" "$dst/layouts/"
[ -f "$src/settings.json" ] && cp "$src/settings.json" "$dst/"
# The agents' hooks write their activity into the main home: tell the office window where that is.
mkdir -p "$dst/data/polyflow-office"
printf '%s\n' "$src" > "$dst/data/polyflow-office/source-home.txt"
export HERDR_APP_HOME="$dst"
nohup herdr-app >/dev/null 2>&1 &
i=0
while [ $i -lt 20 ]; do
  herdr-app do layout.switch --name office-screen >/dev/null 2>&1 && { herdr-app do overlay.close >/dev/null 2>&1; exit 0; }
  i=$((i + 1)); sleep 1
done
exit 1
