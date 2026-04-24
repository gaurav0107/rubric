#!/usr/bin/env bash
# Produce a live Homebrew Formula from packaging/homebrew/rubric.rb.template.
#
# Usage:
#   packaging/homebrew/build-formula.sh <version> <artifacts-dir> > Formula/rubric.rb
#
# <artifacts-dir> must contain the four unix binaries from the GitHub release:
#   rubric-darwin-arm64
#   rubric-darwin-x64
#   rubric-linux-arm64
#   rubric-linux-x64
#
# Emits the filled formula on stdout. No dependencies beyond `shasum` and `sed`.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <version> <artifacts-dir>" >&2
  exit 2
fi

VERSION="$1"
DIR="$2"

if [ ! -d "$DIR" ]; then
  echo "error: artifacts dir not found: $DIR" >&2
  exit 1
fi

sha() {
  local f="$DIR/$1"
  if [ ! -f "$f" ]; then
    echo "error: missing artifact $f" >&2
    exit 1
  fi
  shasum -a 256 "$f" | awk '{print $1}'
}

DARWIN_ARM64=$(sha rubric-darwin-arm64)
DARWIN_X64=$(sha rubric-darwin-x64)
LINUX_ARM64=$(sha rubric-linux-arm64)
LINUX_X64=$(sha rubric-linux-x64)

HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
TEMPLATE="$HERE/rubric.rb.template"

# Strip the leading `# ` block of setup instructions so the emitted Formula is
# idiomatic. Everything from `class Rubric` onward is what ships in the tap.
sed -n '/^class Rubric/,$p' "$TEMPLATE" \
  | sed \
    -e "s|__VERSION__|${VERSION}|g" \
    -e "s|__DARWIN_ARM64_SHA__|${DARWIN_ARM64}|g" \
    -e "s|__DARWIN_X64_SHA__|${DARWIN_X64}|g" \
    -e "s|__LINUX_ARM64_SHA__|${LINUX_ARM64}|g" \
    -e "s|__LINUX_X64_SHA__|${LINUX_X64}|g"
