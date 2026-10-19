import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { AutoStepCore } from '../src/core.ts'
import { smallOfp } from './helpers.ts'

const root = path.resolve(import.meta.dirname, '..')

describe('the core builds a bug report', () => {
  it('describes the run, and leaves out the SimBrief name and ID, the Windows user name and the folders under it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostep-report-'))
    // Never started, so it never reaches for the sim, the ATC program or the network.
    let core: AutoStepCore | null = null
    try {
      fs.writeFileSync(path.join(dir, 'ofp.json'), JSON.stringify(smallOfp('EGLL', 'KJFK')))
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ planFile: 'ofp.json', simbrief: { username: 'examplepilot', userId: '424242' } }))
      core = await AutoStepCore.create({
        host: 'app',
        version: '9.9.9',
        simulated: null,
        live: 'config',
        configFile: path.join(dir, 'config.json'),
        profileDirs: [path.join(root, 'profiles')],
        logDir: path.join(dir, 'logs'),
        persistSettings: true,
        echo: false
      })
      core.log('info', 'SimBrief username set to examplepilot, id 424242, folder C:\\Users\\Someone\\Documents\\x')
      await core.loadPlan()

      const text = core.buildReport({ os: 'Windows 11 (test)', electron: '31', node: '20', userName: 'Someone', homeDir: 'C:\\Users\\Someone', now: Date.UTC(2026, 9, 17, 12, 0, 0) })

      assert.match(text, /9\.9\.9 \(installed app\)/)
      assert.match(text, /Mode +Watching only/)
      assert.match(text, /Plan +simbrief, EGLL to KJFK/)
      assert.match(text, /1\. A FL360 \(FL340 to FL360\): pending/)
      assert.match(text, /SimBrief username set to <SimBrief username>, id <SimBrief ID>, folder %USERPROFILE%\\Documents\\x/)
      assert.doesNotMatch(text, /examplepilot|424242|Someone/i)
    } finally {
      core?.stop()
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })
})
