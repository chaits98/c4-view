#!/usr/bin/env bash
# One command that makes a fresh machine able to contribute WITHOUT drifting from the pipeline.
#
#   ./scripts/setup-dev.sh              # install, build, hooks, scanner image
#   ./scripts/setup-dev.sh --no-docker  # skip the containers (hooks then run in "pipx or skip" mode)
#   ./scripts/setup-dev.sh --force-hooks  # take over core.hooksPath even if another dir owns it
#
# Idempotent: run it as often as you like. Every step prints why it exists, because a contributor who does
# not understand a gate will disable it the first time it is inconvenient.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FORCE_HOOKS=0
NO_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --force-hooks) FORCE_HOOKS=1 ;;
    --no-docker) NO_DOCKER=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ok    %s\n' "$1"; }
warn() { printf '  note  %s\n' "$1"; }
die() { printf '\n  FAIL  %s\n' "$1"; exit 1; }

# ── 1. Node ────────────────────────────────────────────────────────────────────
say "Node"
have_node=$(command -v node >/dev/null 2>&1 && echo yes || echo no)
[ "$have_node" = yes ] || die "node is not installed. Install Node 22.18+ (nvm install 22), then re-run."
major=$(node -p 'process.versions.node.split(".")[0]')
minor=$(node -p 'process.versions.node.split(".")[1]')
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 18 ]; }; then
  die "Node $(node -v) cannot run TypeScript directly; this repo needs >= 22.18. nvm install 22 && nvm use 22"
fi
ok "node $(node -v) — runs the .ts sources with no build step"

# ── 2. dev dependencies ───────────────────────────────────────────────────────
say "Dev dependencies"
if [ -d node_modules ]; then ok "node_modules present"; else npm install --no-audit --no-fund >/dev/null && ok "installed (typescript, @types/node, ajv — dev only)"; fi
node -e "require('typescript')" 2>/dev/null || die "typescript is missing from node_modules; delete node_modules and re-run"

# ── 3. build ──────────────────────────────────────────────────────────────────
say "Build (dist/)"
npm run build >/dev/null 2>&1 && ok "dist/ built from src/ — a tarball install ships this, not TypeScript" || die "tsc failed; run npm run build to see why"

# ── 4. the gates ──────────────────────────────────────────────────────────────
say "Gates"
command -v git >/dev/null || die "git is required"
ok "gate.mjs, golden.mjs, audit are in-repo — no external service needed"

# ── 5. pre-commit hooks ───────────────────────────────────────────────────────
say "Hooks"
current=$(git config --get core.hooksPath || true)
if [ -z "$current" ]; then
  git config core.hooksPath .githooks
  ok "core.hooksPath set to .githooks (was unset)"
elif [ "$current" = ".githooks" ]; then
  ok "core.hooksPath already .githooks"
elif [ "$FORCE_HOOKS" -eq 1 ]; then
  git config core.hooksPath .githooks
  warn "core.hooksPath was '$current'; replaced by .githooks (--force-hooks)"
else
  warn "core.hooksPath is '$current', which OVERRIDES .githooks — this repo's hooks would never run."
  warn "  point it here:  git config core.hooksPath .githooks      (or re-run with --force-hooks)"
fi
chmod +x .githooks/pre-commit .githooks/pre-push scripts/check.sh
ok "pre-commit = fast gates · pre-push = fast + scanners + sonar + deps"

# ── 6. scanners (docker) ──────────────────────────────────────────────────────
say "Skill scanners"
if [ "$NO_DOCKER" -eq 1 ]; then
  warn "skipped (--no-docker): pre-push will SKIP the skill scan; CI still runs it"
elif command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    if docker image inspect c4v-scanners:0.2 >/dev/null 2>&1; then
      ok "c4v-scanners:0.2 already built"
    else
      docker build --network host -f security/Dockerfile -t c4v-scanners:0.2 . >/dev/null 2>&1 \
        && ok "built c4v-scanners:0.2 (skillspector, cisco, agentscan, skillfrisk)" \
        || warn "scanner image build failed; run it by hand: docker build -f security/Dockerfile -t c4v-scanners:0.2 ."
    fi
  else
    warn "docker is installed but the daemon is not reachable; pre-push will SKIP scanners"
  fi
else
  warn "no docker: install it, or 'pipx install skillspector cisco-ai-skill-scanner skillfrisk agentscan-cli'"
fi

# ── 7. SonarQube (optional, maintainer-only) ──────────────────────────────────
say "SonarQube (optional)"
if [ -n "${SONAR_TOKEN:-}" ] || grep -q '^SONAR_TOKEN=' "$HOME/.env" 2>/dev/null; then
  ok "SONAR_TOKEN found — pre-push will run the analysis"
else
  warn "no SONAR_TOKEN: the analysis is skipped locally and runs on the maintainer's instance"
fi

# ── 8. prove it ───────────────────────────────────────────────────────────────
say "Verify"
if ./scripts/check.sh --fast; then
  say "Ready"
  printf '  ./scripts/check.sh --full   # what pre-push and CI run\n  node src/cli.ts serve       # the viewer on :8788\n'
else
  die "the fast suite is red on a fresh setup — fix that before contributing"
fi
