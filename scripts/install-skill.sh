#!/usr/bin/env bash
# Kept so the old command still works; the real installer is `c4v skill install`, driven by
# skill/harnesses.jsonl (data, not code — adding a harness is one line).
#
#   ./scripts/install-skill.sh                 # every harness detected on this machine
#   ./scripts/install-skill.sh --harness agents,claude-code
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v c4v >/dev/null 2>&1; then exec c4v skill install "$@"; fi
exec node "$here/src/cli.ts" skill install "$@"
