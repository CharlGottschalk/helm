// Local apps allowlist self-check (task 045) against the built server (run `npm run build:server` first):
//   npm run check:apps -w @usetdt/helm
// A launch names an id only: ids outside the allowlist, malformed ids and extra input are refused,
// and an allowlisted entry runs exactly its saved command and arguments, without a shell.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helm-apps-')))
process.env.HELM_HOME = join(tmp, 'home')
const apps = await import('../dist/apps.js')
const status = async (p) => p.then(() => 'ok', (e) => e.status ?? e.message)
const marker = join(tmp, 'ran.txt')
const pwned = join(tmp, 'pwned')

try {
  assert.deepEqual(apps.listApps(), { apps: [] })
  // nothing allowlisted: every launch is refused
  assert.equal(await status(apps.launchApp('node')), 404)
  // the entry writes its argv to a file, so the check sees exactly what ran
  const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(1)))`
  apps.saveApp({ id: 'writer', name: 'Writer', command: process.execPath, args: ['-e', script, `a b; touch ${pwned}`] })
  assert.equal(apps.listApps().apps.length, 1)

  // tampered ids: not on the list, shell syntax, path tricks, prototype keys
  for (const id of ['other', 'writer; touch x', '../writer', 'WRITER', '__proto__', 'constructor', 'toString', ''])
    assert.equal(await status(apps.launchApp(id)), 404, `launch of ${JSON.stringify(id)} must be refused`)

  // save rejects command lines with newlines and bad ids
  assert.equal(await status(Promise.resolve().then(() => apps.saveApp({ id: 'Bad Id', command: 'x' }))), 400)
  assert.equal(await status(Promise.resolve().then(() => apps.saveApp({ id: 'x', command: 'a\nb' }))), 400)
  assert.equal(await status(Promise.resolve().then(() => apps.saveApp({ id: 'x', command: 'a', args: 'not a list' }))), 400)

  assert.deepEqual(await apps.launchApp('writer'), { ok: true, name: 'Writer' })
  for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100))
  // the argument with shell syntax arrived as one literal argument and nothing ran it
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), [`a b; touch ${pwned}`])
  assert.equal(existsSync(pwned), false)

  // a missing program is reported, not thrown away
  apps.saveApp({ id: 'gone', command: join(tmp, 'no-such-program') })
  assert.match(String((await apps.launchApp('gone').catch((e) => e)).message), /program not found/)

  apps.removeApp('writer')
  assert.equal(await status(apps.launchApp('writer')), 404)
  console.log('apps-check: ok')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
