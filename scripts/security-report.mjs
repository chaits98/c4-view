#!/usr/bin/env node
/**
 * Write the version's security section, from the scanners themselves.
 *
 * A report that describes a version nobody runs is a decoration, so this runs at the only moment a version
 * becomes real: `npm version <patch>` invokes it through the `version` lifecycle script, and the section it
 * writes is part of the very commit that carries the bump and the tag.
 *
 * Every row is measured here and now. A scanner that finds something exits non-zero, which stops the version
 * before it is tagged — a release with an unread finding is worse than a release that did not happen.
 *
 * Idempotent: running it twice for one version replaces the section instead of stacking a second copy.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const REPORT = join(ROOT, 'docs/security/REPORT.md')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const date = new Date().toISOString().slice(0, 10)

/** Run a command, keep its output, never throw: a scanner that is absent is a fact to report, not a crash. */
function run(cmd, args, { cwd = ROOT, json = false } = {}) {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: process.env })
    return { ok: true, out, data: json ? JSON.parse(out) : null }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    return { ok: false, out, data: json ? safeJson(out) : null }
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const have = (cmd) => run('sh', ['-c', `command -v ${cmd}`]).ok

const rows = []
const bad = []

/* ── gitleaks: the repo and its whole history ─────────────────────────────────── */
if (have('gitleaks')) {
  const r = run('gitleaks', ['detect', '--redact', '--no-banner', '--log-level', 'error'])
  const commits = run('git', ['rev-list', '--count', 'HEAD']).out.trim()
  const leaks = (r.out.match(/leaks found: (\d+)/) ?? [, r.ok ? '0' : '?'])[1]
  rows.push(['repo + full history', 'gitleaks 8 (working tree + history)', r.ok ? `**no leaks** — ${commits} commits scanned` : `**${leaks} leak(s)** — see the run output`])
  if (!r.ok) bad.push('gitleaks')
} else {
  rows.push(['repo + full history', 'gitleaks', 'not installed on this machine'])
  bad.push('gitleaks')
}

/* ── semgrep: the source tree ─────────────────────────────────────────────────── */
if (have('semgrep')) {
  const r = run('semgrep', ['--config', 'p/security-audit', '--config', 'p/typescript', '--quiet', '--json', 'src/'], { json: true })
  const found = r.data?.results?.length ?? (r.ok ? 0 : null)
  const files = r.data?.paths?.scanned?.length ?? '?'
  if (found === 0) rows.push(['package code', 'Semgrep `p/security-audit` + `p/typescript`', `**0 findings** over ${files} files in \`src/\``])
  else {
    rows.push(['package code', 'Semgrep `p/security-audit` + `p/typescript`', `**${found === null ? 'scan failed' : `${found} finding(s)`}** over ${files} files`])
    bad.push('semgrep')
  }
} else {
  rows.push(['package code', 'Semgrep', 'not installed on this machine'])
  bad.push('semgrep')
}

/* ── sonar: issues, coverage, the gate verdict ────────────────────────────────── */
// sonar's own CLI reads SONAR_HOST_URL; default it here so the curls below agree with what was analysed
process.env.SONAR_HOST_URL ??= 'http://127.0.0.1:9000'
// reading needs a browse-capable token: the analysis token can upload and cannot read
// handed to the curl subshells as a pre-computed Authorization header: the token stays out of argv, and
// `curl -u user:pass` — which secret scanners flag by shape, correctly — is never written
const reader = process.env.SONAR_READ_TOKEN ?? process.env.SONAR_TOKEN ?? ''
process.env.C4_AUTH = `Authorization: Basic ${Buffer.from(`${reader}:`).toString('base64')}`
const scanner = have('sonar-scanner')
  ? 'sonar-scanner'
  : existsSync(join(process.env.HOME ?? '', '.sonar/native-sonar-scanner/sonar-scanner-6.2.1.4610-linux-x64/bin/sonar-scanner'))
    ? join(process.env.HOME ?? '', '.sonar/native-sonar-scanner/sonar-scanner-6.2.1.4610-linux-x64/bin/sonar-scanner')
    : null
if (scanner && process.env.SONAR_TOKEN) {
  const analysed = run(scanner, ['-Dsonar.login=' + process.env.SONAR_TOKEN, '-Dsonar.qualitygate.wait=true', '-Dsonar.qualitygate.timeout=240'])
  const measures = run('sh', ['-c', `curl -s -H "$C4_AUTH" "$SONAR_HOST_URL/api/measures/component?component=c4-view&metricKeys=bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density,ncloc"`], { json: true })
  const gate = run('sh', ['-c', `curl -s -H "$C4_AUTH" "$SONAR_HOST_URL/api/qualitygates/project_status?projectKey=c4-view"`], { json: true })
  const m = Object.fromEntries((measures.data?.component?.measures ?? []).map((x) => [x.metric, x.value]))
  if (!measures.data?.component) console.error(`sonar measures unavailable: ${(measures.data?.errors?.[0]?.msg ?? measures.out).slice(0, 120)}`)
  const status = gate.data?.projectStatus?.status ?? 'unknown'
  const clean = analysed.ok && status === 'OK' && ['bugs', 'vulnerabilities', 'security_hotspots', 'code_smells'].every((k) => (m[k] ?? '0') === '0')
  rows.push([
    'package code',
    'SonarQube (self-hosted)',
    `${clean ? '' : '**' }${m.bugs ?? '?'} bugs, ${m.vulnerabilities ?? '?'} vulnerabilities, ${m.security_hotspots ?? '?'} hotspots, ${m.code_smells ?? '?'} code smells${clean ? '' : '**'}, ${m.duplicated_lines_density ?? '?'}% duplication, **${m.coverage ?? '?'}% coverage**, ${m.ncloc ?? '?'} ncloc, gate **${status}**`,
  ])
  if (!clean) bad.push('sonar')
} else {
  rows.push(['package code', 'SonarQube', scanner ? 'skipped — no `SONAR_TOKEN` in the environment' : 'skipped — scanner binary not installed'])
  bad.push('sonar')
}

/* ── dependencies ─────────────────────────────────────────────────────────────── */
const audit = run('npm', ['audit', '--omit=dev', '--json'], { json: true })
const vulns = audit.data?.metadata?.vulnerabilities?.total ?? null
const runtimeDeps = Object.keys(pkg.dependencies ?? {}).length
if (vulns === 0) rows.push(['dependencies', '`npm audit --omit=dev`', `**0 vulnerabilities**; ${runtimeDeps} runtime dependencies`])
else {
  rows.push(['dependencies', '`npm audit --omit=dev`', `**${vulns ?? 'unknown'} vulnerability(ies)**; ${runtimeDeps} runtime dependencies`])
  if (vulns !== 0) bad.push('npm audit')
}

/* ── the skill: the same three engines CI runs ───────────────────────────────── */
const skillRows = [
  ['skillspector', ['skillspector', 'scan', 'skill', '--no-llm', '--format', 'markdown']],
  ['cisco skill-scanner', ['skill-scanner', 'scan', 'skill', '--policy', 'low-noise', '--fail-on-severity', 'high']],
  ['skillfrisk', ['skillfrisk', 'scan', 'skill']],
]
const dockerImage = run('docker', ['image', 'inspect', 'c4v-scanners:0.2']).ok
const skillResults = skillRows.map(([name, args]) => {
  const local = have(args[0])
  const r = local
    ? run(args[0], args.slice(1))
    : dockerImage
      ? run('docker', ['run', '--rm', '-v', `${ROOT}skill:/work/skill:ro`, '-w', '/work', 'c4v-scanners:0.2', ...args])
      : null
  if (!r) return `${name}: not run (no binary, no scanner image)`
  if (!r.ok) bad.push(name)
  return `${name}: ${r.ok ? 'clean' : '**findings**'}`
})
rows.push(['skill instructions', 'skillspector, cisco skill-scanner, skillfrisk', skillResults.join('; ')])

/* ── write the section ───────────────────────────────────────────────────────── */
const header = `## Re-run at ${version} — ${date}`
const table = [
  header,
  '',
  '| layer | tool | result |',
  '|---|---|---|',
  ...rows.map(([layer, tool, result]) => `| ${layer} | ${tool} | ${result} |`),
  '',
].join('\n')

const text = readFileSync(REPORT, 'utf8')
const lines = text.split('\n')
const start = lines.findIndex((line) => line.startsWith(`## Re-run at ${version} — `))
let next
if (start >= 0) {
  // replace this version's section: from its heading to the next top-level section
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  next = lines.slice(0, start).join('\n') + '\n' + table + (end >= 0 ? '\n' + lines.slice(end).join('\n') : '')
} else {
  // the newest section sits directly under the introduction, above every older one
  const first = lines.findIndex((line) => line.startsWith('## Re-run at '))
  const at = first >= 0 ? first : lines.findIndex((line) => line.startsWith('## '))
  next = lines.slice(0, at).join('\n') + '\n' + table + (at >= 0 ? '\n' + lines.slice(at).join('\n') : '')
}
writeFileSync(REPORT, next.endsWith('\n') ? next : `${next}\n`)

// the README's test badge is a claim, and a claim nobody re-measures rots: count them here, where a release
// already runs the suite
const suite = run('node', ['--test'])
const passed = /^# pass (\d+)$/m.exec(suite.out)?.[1] ?? (/ℹ pass (\d+)/.exec(suite.out)?.[1] ?? null)
if (passed) {
  const readme = join(ROOT, 'README.md')
  const text = readFileSync(readme, 'utf8')
  const next = text.replace(/tests-\d+%20passing/, `tests-${passed}%20passing`)
  if (next !== text) writeFileSync(readme, next)
  console.log(`readme: tests badge → ${passed} passing`)
}

console.log(`security report: ${version} — ${rows.length} layers`)
for (const [layer, tool, result] of rows) console.log(`  ${layer.padEnd(20)} ${tool.slice(0, 42).padEnd(44)} ${result.replace(/\*\*/g, '')}`)
if (bad.length) {
  console.error(`\nnot releasable: ${bad.join(', ')} — the section is written, the version must not be tagged`)
  process.exit(1)
}
console.log(`\nwritten to docs/security/REPORT.md`)
