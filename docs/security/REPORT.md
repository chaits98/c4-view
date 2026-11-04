# Security report — c4-view

One section per version, newest first. The **first** (0.2.2, 2026-10-31) is the deep audit: four skill
scanners, a threat model, and the findings that were fixed. Every section after it is written by
`node scripts/security-report.mjs`, which `npm version` runs before it commits and tags — so the report in
the tree is always the report for the version in the tree. A scan that describes a version nobody runs is a
decoration.

## Re-run at 0.12.7 — 2026-11-04

| layer | tool | result |
|---|---|---|
| repo + full history | gitleaks 8 (working tree + history) | **no leaks** — 130 commits scanned |
| package code | Semgrep `p/security-audit` + `p/typescript` | **0 findings** over 53 files in `src/` |
| package code | SonarQube (self-hosted) | 0 bugs, 0 vulnerabilities, 0 hotspots, 0 code smells, 0.9% duplication, **98.6% coverage**, 5005 ncloc, gate **OK** |
| dependencies | `npm audit --omit=dev` | **0 vulnerabilities**; 0 runtime dependencies |
| skill instructions | skillspector, cisco skill-scanner, skillfrisk | skillspector: clean; cisco skill-scanner: clean; skillfrisk: clean |

## Re-run at 0.12.6 — 2026-11-04

| layer | tool | result |
|---|---|---|
| repo + full history | gitleaks 8 (working tree + history) | **no leaks** — 129 commits scanned |
| package code | Semgrep `p/security-audit` + `p/typescript` | **0 findings** over 53 files in `src/` |
| package code | SonarQube (self-hosted) | 0 bugs, 0 vulnerabilities, 0 hotspots, 0 code smells, 0.9% duplication, **98.6% coverage**, 4928 ncloc, gate **OK** |
| dependencies | `npm audit --omit=dev` | **0 vulnerabilities**; 0 runtime dependencies |
| skill instructions | skillspector, cisco skill-scanner, skillfrisk | skillspector: clean; cisco skill-scanner: clean; skillfrisk: clean |

## Re-run at 0.12.5 — 2026-11-04

| layer | tool | result |
|---|---|---|
| repo + full history | gitleaks 8 (working tree + history) | **no leaks** — 127 commits scanned |
| package code | Semgrep `p/security-audit` + `p/typescript` | **0 findings** over 53 files in `src/` |
| package code | SonarQube (self-hosted) | 0 bugs, 0 vulnerabilities, 0 hotspots, 0 code smells, 0.9% duplication, **98.6% coverage**, 4928 ncloc, gate **OK** |
| dependencies | `npm audit --omit=dev` | **0 vulnerabilities**; 0 runtime dependencies |
| skill instructions | skillspector, cisco skill-scanner, skillfrisk | skillspector: clean; cisco skill-scanner: clean; skillfrisk: clean |

## Re-run at 0.12.3 — 2026-11-03

| layer | tool | result |
|---|---|---|
| repo + full history | gitleaks 8 | **no leaks** — 111 commits, 1.24 MB scanned |
| package code | Semgrep `p/security-audit` + `p/typescript` | **0 findings** over 52 files in `src/` |
| package code | SonarQube 9.9 (self-hosted) | **0 bugs, 0 vulnerabilities, 0 hotspots, 0 code smells**, 0.9% duplication, **98.6% coverage**, 4,796 ncloc, gate **OK** |
| dependencies | `npm audit --omit=dev` | **0 vulnerabilities**; zero runtime dependencies |
| skill instructions | SkillSpector, cisco skill-scanner, skillfrisk, agentscan | run in CI on every push (`skill-scan` job); cisco is gated at `--fail-on-severity high` |
| gates | `./scripts/check.sh` | 300-line ceiling, purity, no `any`, no placeholders, goldens byte-identical |

The Runtime surface table below (F1–F5) is unchanged: every finding is either fixed or accepted with the
reasoning recorded, and none of the code paths involved has changed since.

## The original audit — 0.2.2, 2026-10-31


Scope: the skill's instructions, the package's code and dependencies, and the runtime surface the tool
exposes. Date: 2026-10-31. Everything below is reproducible with `security/Dockerfile` and the commands
at the end.

## Verdict

| layer | tool | result |
|---|---|---|
| skill instructions | NVIDIA **SkillSpector 2.12.0** (static, `--no-llm`) | **score 0/100, severity LOW, recommendation SAFE, 0 issues**, 100% of files inspected |
| skill instructions | **cisco-ai-skill-scanner 2.3.2** (Apache-2.0) | safe, max severity SAFE, **0 findings** after adding `license: MIT` to the skill manifest (the only finding it ever raised was `MANIFEST_MISSING_LICENSE`, INFO) |
| skill instructions | **agentscan-cli 1.2.2** (MIT) | critical 0, high 0, medium 0, low 2, info 13 — all "observed patterns, not verdicts": unpinned dependencies quoted in a usage example, and a `network.connect` capability at the `curl` POST line |
| skill instructions | **skillfrisk 0.3.0** (MIT) | risk score **0**, `failed: false`, 0 findings, 3 files scanned |
| skill instructions | snyk-agent-scan, ramparts | **not used, on purpose.** Snyk's scanner is account-gated (`SNYK_TOKEN`), so it fails the keyless rule; ramparts is Apache-2.0 but needs a Rust build — worth adding to a CI image, not to a throwaway container. Recorded so nobody re-litigates it |
| package code | Semgrep `p/security-audit` + `p/typescript` | **0 findings** across `src/` (89 rules, 27 files) |
| repo + history | **gitleaks 8** (MIT) | **0 leaks** across 28 commits / 754 KB, full history |
| package code | SonarQube 9.9 (self-hosted) | **0 bugs, 0 vulnerabilities, 0 hotspots, 0 code smells, 0 debt**, 92.5% line coverage, gate OK |
| dependencies | `npm audit`, `osv-scanner` | **zero runtime dependencies** — the only tree is two dev packages (typescript, @types/node, ajv for the schema test) |
| runtime surface | manual threat model + tests | findings F1–F5 below; F1 and F2 fixed in 0.2.2 |

There is no telemetry, no outbound network call, and no code path that executes model content.

## Skill scan — SkillSpector

```
Skill:      c4-diagram          Source: /skill          Scanned: 2026-10-31 13:26 UTC
Score       0/100      Severity LOW      Recommendation SAFE
Components  2 (SKILL.md 212 lines, SMOKE-PROMPT.md 33)   Executable: none
Issues      0
Coverage    100.0% — 2 fully inspected, 0 partial, 0 uninspected
```

**One SARIF warning is accepted and explained rather than suppressed.** SkillSpector's `skillspector.sarif`
carries a single result: rule **E1 "External Transmission"** at `SKILL.md:233` — the `curl -X POST …/api/diagrams`
line, i.e. the instruction to hand the model to the viewer. That is the product working as designed: the
endpoint is the user's own server, loopback by default, and reaching it needs a token the moment the bind
leaves loopback. It is recorded here so a reviewer sees the capability rather than a suspiciously empty
report; the markdown report scores it 0/100 with no *issues* because it is a capability, not a defect.

The static analyzers that matter for a text-only skill all ran and came back clean: prompt injection,
data exfiltration, privilege escalation, supply chain, excessive agency, output handling, memory
poisoning, tool misuse, rogue agent, anti-refusal, SSRF, deserialization. The behavioral AST/taint
analyzers reported `no_applicable_files` — correct, because the skill ships **no executable code**; every
command in it is a `c4v` invocation a human can read.

Eleven `reference_missing` ledger exceptions are recorded against paths the skill names that are not
bundled with it (`src/cli.ts`, `docs/c4/<id>.json` and similar). Those are runtime paths in the user's
repo, not shipped artifacts — expected for a skill that drives a CLI rather than containing it. They are
not findings, but they are the kind of thing a reviewer should see rather than have hidden, so they stay
in the report.

The semantic analyzers were **off** (`--no-llm`): SkillSpector's LLM stage uploads file contents to a
configured provider. For a skill whose whole text is public, that trade is not worth taking by default;
a CI run that wants it can enable it deliberately.

## Product-layer

- **SonarQube** (existing gate, `sonar-project.properties`): 2,403 ncloc, 0 issues, gate OK. The 300-line
  per-file ceiling is enforced by `tools/gate.mjs` because Sonar Community cannot express it.
- **Semgrep** (`p/security-audit` + `p/typescript`, `semgrep/semgrep` image): 0 findings over `src/` —
  no `child_process` with interpolation, no `eval`, no dynamic `require`, no unsafe deserialisation. The
  one spawn in the codebase is `execFileSync` with an argv array and a resolved binary path.
- **Dependencies:** none at runtime. `npm audit` reports 0 vulnerabilities; there is no lockfile drift
  surface because there is nothing to resolve at install time. This is worth stating loudly in a README:
  a diagram renderer that pulls in 200 transitive packages is a worse security proposition than one that
  pulls in none.
- **Build provenance:** the tarball is built by `tsc` from the same commit; `dist/` is gitignored and
  produced by `prepack`, so the published artefact cannot drift from `src/`. Public release should add
  `npm publish --provenance` in CI (OIDC), which cannot be done from a local registry.

## Runtime surface — threat model and findings

Trust boundaries, from the outside in: **browser/agent → HTTP server → model parser → layout → SVG/HTML
emitter → filesystem**. The model is attacker-controlled in the case that matters (an agent wrote it, or
a colleague POSTed it).

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | The viewer had **no authentication** on any route; `--host 0.0.0.0` published every diagram to the LAN | High | **Fixed 0.2.2** — any non-loopback bind requires a bearer token (generated if absent); token accepted as `Authorization`, `?t=` or `HttpOnly; SameSite=Strict` cookie; `/health` stays open and exposes counts only |
| F2 | No `Content-Security-Policy`, no `nosniff`, no framing protection; a future inline script (or a crafted export) would have had nothing stopping it | Medium | **Fixed 0.2.2** — CSP `default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'`, plus `nosniff`, `no-referrer`, `X-Frame-Options: DENY` on every response |
| F3 | `--png` passed **`--no-sandbox`** to Chromium unconditionally, disabling the browser sandbox on a desktop that did not need it | Medium | **Fixed 0.2.2** — only passed when running as root (containers) |
| F4 | Layout cost is superlinear; a POST of a very large model (up to 2 MB) burns CPU for as long as it likes | Low | **Documented** in SECURITY.md; the 2 MB cap and the token are the current mitigation. A node-count ceiling would be the next step |
| F5 | The viewer token travels over plain HTTP and is stored in a cookie; on a shared network anyone reading traffic can read it | Low | **Documented** — put it behind a TLS-terminating proxy when exposing it beyond a trusted LAN. Not solved in-process on purpose: bundling TLS is a much bigger surface than the problem it fixes here |

Checked and **not** findings: SVG injection (all model strings pass through the escaping helper; a test
plants a `<script>` label), path traversal (`/d/../../etc/passwd` and encoded variants 404), the agent's
own model cannot execute (no `eval`, no dynamic import of model content, no template that renders HTML
from data), and store writes are confined to the configured root.

## Reproduce

```bash
# four keyless scanners over the same skill, three different rule corpora
docker build -f security/Dockerfile -t c4v-scanners .
docker run --rm -v "$PWD/skill:/skill:ro" c4v-scanners skillspector scan /skill --no-llm --format sarif --output -
docker run --rm -v "$PWD/skill:/skill:ro" c4v-scanners skill-scanner scan /skill --policy low-noise --format json
docker run --rm -v "$PWD/skill:/skill:ro" c4v-scanners agentscan scan /skill
docker run --rm -v "$PWD/skill:/skill:ro" c4v-scanners skillfrisk scan /skill --json

# package and history
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks detect --source /repo --redact
npm audit; npx tsc --noEmit; node tools/gate.mjs; node --test
```

### Why these four and not the other ten

Ten candidate scanners were surveyed; every license was read from the repo's own `LICENSE` file. The rule
was **keyless and offline**: `snyk/agent-scan` (Apache-2.0 code, but the scan calls Snyk's service and
refuses without `SNYK_TOKEN`), `NMitchem/SkillScan` (its sandbox is Docker-Desktop-only, explicitly not
available in CI), and `alexgreensh/repo-forensics` (**PolyForm Noncommercial** — not open source, and a
trap that "free scanner" lists walk into) were all excluded on that rule rather than on quality.

The four kept are three genuinely different engines over the same prose plus one for secrets: SkillSpector
(71 patterns, SARIF), cisco (typed CEL facts with published FPR numbers, then an optional judge), agentscan
(deterministic, no LLM at all, stable fingerprints for a baseline), skillfrisk (unicode-hiding and
permission checks). Agreement between four independent rule corpora is a much stronger claim than one
scanner reporting zero.

## Residual risk, stated plainly

The tool is designed to be run by one person on their own machine. Everything above is sized for that.
It is not a multi-tenant service and does not pretend to be: one token, one trust level, no audit log, no
per-user isolation. Anyone deploying it that way should put a real reverse proxy in front of it.
