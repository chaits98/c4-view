#!/usr/bin/env bash
# The one definition of "is this commit safe to land".
#
# Used by .githooks/pre-commit (--fast), .githooks/pre-push (--full), CI, and humans. If a check only
# exists in CI, a contributor finds out after the push; if it only exists in the hook, CI can drift from
# it. One script, three callers.
#
#   ./scripts/check.sh            # --fast: gates, types, tests, goldens, tokens, secrets (~10 s)
#   ./scripts/check.sh --full     # + skill scanners, SonarQube, deps, doctor       (~2 min)
#   ./scripts/check.sh --list     # print the steps and exit
#
# Exit: 0 all pass (SKIP is not a failure in --fast, or when an OPTIONAL tool is missing in --full),
#       1 something failed, 2 the environment is not set up (run ./scripts/setup-dev.sh).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mode=fast
[ "${1:-}" = "--full" ] && mode=full
[ "${1:-}" = "--list" ] && { sed -n '2,12p' "$0"; exit 0; }

failed=0
skipped=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
skip() { printf '  \033[33mSKIP\033[0m  %s — %s\n' "$1" "$2"; skipped=$((skipped + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; failed=$((failed + 1)); }

step() {  # step <name> <command...>
  local name=$1; shift
  if "$@" >/tmp/c4v-check.out 2>&1; then pass "$name"; else fail "$name"; sed 's/^/        /' /tmp/c4v-check.out | tail -20; fi
}

have() { command -v "$1" >/dev/null 2>&1; }

echo "c4-view check ($mode) on $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
echo

# ── environment ────────────────────────────────────────────────────────────────
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
node_minor=$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 18 ]; }; then
  echo "  Node >= 22.18 is required (found $(node -v 2>/dev/null || echo none)). Run ./scripts/setup-dev.sh"
  exit 2
fi
[ -d node_modules ] || { echo "  dev dependencies missing. Run ./scripts/setup-dev.sh"; exit 2; }

# ── the fast suite: everything a reviewer would otherwise catch by reading ─────
step "gate: 300-line cap, purity, no any/placeholders" node tools/gate.mjs
step "types: tsc --noEmit"                             npx tsc --noEmit
step "tests: node --test"                              node --test
step "goldens: 11 levels byte-identical"               node tools/golden.mjs --check
step "audit: every fixture and example is green"       bash -c '
  for f in fixtures/*.json examples/*.json docs/c4/*.json skill/assets/*.json; do
    node src/cli.ts audit "$f" --strict >/dev/null || { echo "failed: $f"; exit 1; }
  done'
step "tokens: every measured contrast pair clears its WCAG threshold" node tools/contrast.mjs

# ── secrets: cheap, and the one class of mistake git keeps forever ────────────
if have gitleaks; then
  step "secrets: gitleaks (working tree + history)" gitleaks detect --redact --no-banner
elif have docker && docker image inspect zricethezav/gitleaks:latest >/dev/null 2>&1; then
  step "secrets: gitleaks (docker)" docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact --no-banner
else
  skip "secrets: gitleaks" "not installed (setup-dev.sh fetches the image)"
fi

if [ "$mode" = fast ]; then
  echo
  echo "  $([ "$failed" -eq 0 ] && echo 'ok' || echo "$failed failed") · $skipped skipped · full suite runs on pre-push"
  exit "$([ "$failed" -eq 0 ] && echo 0 || echo 1)"
fi

# ── full suite ────────────────────────────────────────────────────────────────
# The skill is a shipped artefact. Scan it with the same engines CI uses, from whichever runtime exists
# here: a host binary (pipx, what CI does) or the scanner image (what this box does). Never silently skip.
if have skillspector; then
  scan() { "$@" >/tmp/c4v-scan.out 2>&1; }   # CI path: pipx-installed binaries
elif have docker && docker image inspect c4v-scanners:0.2 >/dev/null 2>&1; then
  scan() { docker run --rm -v "$PWD/skill:/work/skill:ro" -w /work c4v-scanners:0.2 "$@" >/tmp/c4v-scan.out 2>&1; }
else
  scan() { return 127; }
fi

if scan skillspector scan skill --no-llm --format markdown; then pass "skill: skillspector (0 issues)"; else fail "skill: skillspector"; sed 's/^/        /' /tmp/c4v-scan.out | tail -10; fi
if scan skill-scanner scan skill --policy low-noise --fail-on-severity high; then pass "skill: cisco skill-scanner"; else fail "skill: cisco skill-scanner"; sed 's/^/        /' /tmp/c4v-scan.out | tail -10; fi
if scan skillfrisk scan skill; then pass "skill: skillfrisk"; else fail "skill: skillfrisk"; sed 's/^/        /' /tmp/c4v-scan.out | tail -10; fi
if [ "$(type -t scan)" = function ] && scan true; then :; else fail "skill: no scanner runtime — install docker, or pipx install skillspector cisco-ai-skill-scanner skillfrisk"; fi

step "deps: npm audit (0 runtime deps, dev tree only)" npm audit --audit-level=high
step "doctor: this machine can still run the tool"   node src/cli.ts doctor

# SonarQube is self-hosted on the maintainer's box, so it is OPTIONAL for a contributor — but it must be
# impossible to mistake "not run" for "passed", hence SKIP with the reason on its own line.
if [ -n "${SONAR_TOKEN:-}" ] || [ -f "$HOME/.env" ] && grep -q '^SONAR_TOKEN=' "$HOME/.env" 2>/dev/null; then
  if have sonar-scanner || [ -x "$HOME/.sonar/native-sonar-scanner/sonar-scanner-6.2.1.4610-linux-x64/bin/sonar-scanner" ]; then
    scanner=$(command -v sonar-scanner || echo "$HOME/.sonar/native-sonar-scanner/sonar-scanner-6.2.1.4610-linux-x64/bin/sonar-scanner")
    if [ -z "${SONAR_TOKEN:-}" ]; then set -a; . "$HOME/.env"; set +a; fi
    step "sonar: analysis + quality gate" bash -c "node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=coverage/lcov.info >/dev/null 2>&1 && '$scanner' -Dsonar.login=\"\$SONAR_TOKEN\" >/dev/null"
  else
    skip "sonar" "scanner binary not installed"
  fi
else
  skip "sonar" "no SONAR_TOKEN — CI runs it on the maintainer's instance"
fi

echo
echo "  $([ "$failed" -eq 0 ] && echo 'ok' || echo "$failed failed") · $skipped skipped"
exit "$([ "$failed" -eq 0 ] && echo 0 || echo 1)"
