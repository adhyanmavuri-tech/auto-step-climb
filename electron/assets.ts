import path from 'node:path'

/**
 * The window's pages come from the app itself, not from the web: the app answers `autostep://app/...` by reading
 * a file from its public folder. Only the page's own files are served, by name, so nothing else on the disk can
 * be reached through it, whatever address a page asks for.
 */

export const APP_ORIGIN = 'autostep://app'

const FILES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'skin.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'classic.css': 'text/css; charset=utf-8',
  'favicon.svg': 'image/svg+xml'
}

/** The rules the window's page is held to: its own files only, no frames, no plug-ins, no forms sent anywhere. */
export const CONTENT_SECURITY_POLICY = "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** The file and type to answer an address with, or null when the app has nothing by that name. */
export function resolveAsset(publicDir: string, url: string): { file: string; type: string } | null {
  let pathname: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'autostep:' || parsed.host !== 'app') return null
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  const name = pathname === '/' ? 'index.html' : pathname.slice(1)
  const type = Object.hasOwn(FILES, name) ? FILES[name] : undefined
  return type ? { file: path.join(publicDir, name), type } : null
}
