import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { APP_ORIGIN, CONTENT_SECURITY_POLICY, resolveAsset } from '../electron/assets.ts'

const dir = path.join('C:', 'app', 'public')

describe('the window\'s own address', () => {
  it('serves the page and its files by name', () => {
    assert.deepEqual(resolveAsset(dir, `${APP_ORIGIN}/`), { file: path.join(dir, 'index.html'), type: 'text/html; charset=utf-8' })
    assert.deepEqual(resolveAsset(dir, `${APP_ORIGIN}/app.js`), { file: path.join(dir, 'app.js'), type: 'text/javascript; charset=utf-8' })
    assert.equal(resolveAsset(dir, `${APP_ORIGIN}/style.css`)?.type, 'text/css; charset=utf-8')
    assert.equal(resolveAsset(dir, `${APP_ORIGIN}/classic.css`)?.type, 'text/css; charset=utf-8')
    assert.equal(resolveAsset(dir, `${APP_ORIGIN}/skin.js`)?.type, 'text/javascript; charset=utf-8')
    assert.equal(resolveAsset(dir, `${APP_ORIGIN}/favicon.svg`)?.type, 'image/svg+xml')
  })

  it('serves nothing else, however the address is written', () => {
    for (const bad of [
      '/package.json',
      '/../package.json',
      '/..%2Fpackage.json',
      '/%2e%2e/%2e%2e/Windows/win.ini',
      '/app.js/../../secret',
      '/data/airports.json',
      '/index.html%00.js',
      '/constructor',
      '/__proto__',
      '/toString',
      '//evil.example/app.js',
      '/APP.JS',
      '/app.js.map'
    ]) {
      assert.equal(resolveAsset(dir, `${APP_ORIGIN}${bad}`), null, bad)
    }
  })

  it('answers only for its own scheme and host', () => {
    assert.equal(resolveAsset(dir, 'https://example.com/app.js'), null)
    assert.equal(resolveAsset(dir, 'file:///C:/app/public/app.js'), null)
    assert.equal(resolveAsset(dir, 'autostep://other/app.js'), null)
    assert.equal(resolveAsset(dir, 'not a url'), null)
  })

  it('lets the page load only its own files and nothing from the web', () => {
    assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/)
    assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/)
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-|https?:/)
  })
})
