#!/usr/bin/env bash
# Install the c4-diagram skill into the Hermes skills directory.
#
#   ./scripts/install-skill.sh
#   HERMES_SKILLS_DIR=~/.hermes/profiles/buddy/skills ./scripts/install-skill.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${HERMES_SKILLS_DIR:-$HOME/.hermes/skills}/software-development/c4-diagram"
mkdir -p "$dest"
cp -a "$here/skill/." "$dest/"
echo "skill installed -> $dest/SKILL.md"
echo "check it with:  hermes skills list | grep c4-diagram"
