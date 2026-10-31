/**
 * `c4v service` — host the viewer as a systemd USER unit instead of a background command in
 * someone's shell.
 *
 * The unit is generated, not templated from a checkout: it names the exact Node binary and the
 * exact module that is running right now, so it keeps working when `c4v` came from npm, from a
 * tarball, or straight out of a clone — and it does not depend on the user's PATH, which systemd
 * user units do not inherit (an nvm install is invisible to them).
 *
 * Linux + systemd only, deliberately. macOS/launchd and Windows/Task Scheduler are different
 * supervisors with different failure modes; `c4v serve` remains the answer there, and a second
 * half-tested supervisor is worse than an honest "not supported".
 *
 * @module c4-view/service
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One unit name, one place to change it. */
export const UNIT = 'c4-view.service'

export interface ServiceOptions {
  port: string
  host: string
  root: string
}

export const unitPath = (): string => join(homedir(), '.config', 'systemd', 'user', UNIT)

/** systemd treats `"` as a quote, so quote anything with whitespace and escape the rest. */
const arg = (value: string): string => (/[\s"\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value)

/**
 * The CLI module to run — this file's sibling with the same extension (`cli.ts` in a checkout,
 * `cli.js` in the built package). Pointing the unit at THIS module instead was a live bug: node
 * started it, found no main, exited 0, and systemd reported a dead-but-clean service.
 */
const cliModuleOf = (): string => fileURLToPath(import.meta.url).replace(/service\.(ts|js)$/, 'cli.$1')

/** The unit text. Pure, so a test can assert on it without touching the system. */
export function unitText(opts: ServiceOptions, nodePath: string = process.execPath, modulePath: string = cliModuleOf()): string {
  const exec = [nodePath, modulePath, 'serve', '--port', opts.port, '--host', opts.host, '--root', opts.root]
    .map(arg)
    .join(' ')
  return `[Unit]
Description=c4-view — C4 diagram viewer (http://${opts.host}:${opts.port})
After=network.target

[Service]
Type=simple
ExecStart=${exec}
# optional: TOKEN=… or C4_VIEW_* settings; the leading dash makes a missing file harmless
EnvironmentFile=-%h/.config/c4-view/env
Restart=always
RestartSec=2
WorkingDirectory=%h

[Install]
WantedBy=default.target
`
}

/** Refuse politely on anything that is not a systemd user session. */
function assertSystemd(): void {
  if (process.platform !== 'linux') {
    throw new Error(`c4v service is Linux/systemd only (this is ${process.platform}); run \`c4v serve\` and use your platform's own supervisor.`)
  }
  try {
    execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'pipe' })
  } catch {
    throw new Error('no systemd user session found (systemctl --user failed); run `c4v serve` instead.')
  }
}

/**
 * A unit bound to a real interface must not generate a fresh token on every restart: the link the
 * user was given would stop working. So the token is written once to the env file the unit loads.
 */
export function ensureTokenFile(host: string, generate: () => string): string | null {
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return null
  const dir = join(homedir(), '.config', 'c4-view')
  const file = join(dir, 'env')
  if (existsSync(file)) return null
  mkdirSync(dir, { recursive: true })
  const token = generate()
  writeFileSync(file, `C4_VIEW_TOKEN=${token}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
  return token
}

/** Write the unit and bring it up. Returns the path written. */
export function installService(opts: ServiceOptions): string {
  assertSystemd()
  const file = unitPath()
  mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true })
  writeFileSync(file, unitText(opts))
  const run = (args: string[]): void => {
    execFileSync('systemctl', ['--user', ...args], { stdio: 'pipe' })
  }
  run(['daemon-reload'])
  run(['enable', '--now', UNIT])
  return file
}

/** Stop, disable, delete. Idempotent: a machine without the unit is not an error. */
export function uninstallService(): boolean {
  const file = unitPath()
  if (!existsSync(file)) return false
  const run = (args: string[]): void => {
    try {
      execFileSync('systemctl', ['--user', ...args], { stdio: 'pipe' })
    } catch {
      // disabling a unit that is already stopped is not a failure worth reporting
    }
  }
  run(['disable', '--now', UNIT])
  rmSync(file, { force: true })
  run(['daemon-reload'])
  return true
}

/** `systemctl status` verbatim, so the answer is the truth rather than a summary of it. */
export function serviceStatus(): number {
  if (process.platform !== 'linux' || !existsSync(unitPath())) {
    console.error(`no unit at ${unitPath()} — run: c4v service install`)
    return 1
  }
  try {
    process.stdout.write(execFileSync('systemctl', ['--user', 'status', UNIT, '--no-pager'], { encoding: 'utf8' }))
    return 0
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout
    if (stdout) process.stdout.write(stdout)
    return 1
  }
}

/** The hints that make the difference between "it runs" and "it survives a logout". */
export function serviceHints(port: string, host: string): string[] {
  return [
    `unit:    ${unitPath()}`,
    `logs:    journalctl --user -u ${UNIT} -f`,
    `url:     http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`,
    `survive logout (once):  loginctl enable-linger ${process.env.USER ?? '$USER'}`,
    `remove:  c4v service uninstall`,
  ]
}
