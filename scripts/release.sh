#!/bin/sh
# Builds a release of Motes: Release configuration, signed, zipped, with checksums.
#
#   scripts/release.sh
#
# Signs ad-hoc by default (no Apple account needed). To sign with a Developer ID
# later: MOTES_SIGN_IDENTITY="Developer ID Application: …" scripts/release.sh
# Output: release/Motes-<version>.zip and release/SHA256SUMS
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
identity=${MOTES_SIGN_IDENTITY:--}
version=$(sed -n 's/^ *MARKETING_VERSION: *"\(.*\)"/\1/p' "$root/Motes/project.yml")
[ -n "$version" ] || { echo "Can't read MARKETING_VERSION from Motes/project.yml" >&2; exit 1; }

cd "$root/Motes"
xcodegen --quiet
xcodebuild -scheme Motes -configuration Release -derivedDataPath "$root/build/release" \
    CODE_SIGN_IDENTITY="$identity" build | tail -n 3

app="$root/build/release/Build/Products/Release/Motes.app"
codesign --verify --deep --strict "$app"
codesign --verify --strict "$app/Contents/MacOS/motes-hook"

out="$root/release"
rm -rf "$out"
mkdir -p "$out"
# ditto keeps the bundle's metadata and signature intact.
ditto -c -k --keepParent "$app" "$out/Motes-$version.zip"
(cd "$out" && shasum -a 256 "Motes-$version.zip" > SHA256SUMS)

echo "Motes $version ($(codesign -dv "$app" 2>&1 | sed -n 's/^Signature=//p'))"
cat "$out/SHA256SUMS"
