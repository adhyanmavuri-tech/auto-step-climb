import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export type Action = (body: Record<string, unknown>) => unknown | Promise<unknown>

export interface ServerApi {
  getState: () => unknown
  /** What the tray icon shows (GET /api/tray): a colour, a hover text and a status line. */
  getTray?: () => unknown
  actions: Record<string, Action>
}

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  '/classic.css': { file: 'classic.css', type: 'text/css; charset=utf-8' },
  '/skin.js': { file: 'skin.js', type: 'text/javascript; charset=utf-8' },
  '/favicon.svg': { file: 'favicon.svg', type: 'image/svg+xml' }
}

const MAX_BODY = 10_000

/**
 * The dashboard server. Bound to 127.0.0.1 only. Because it can operate an aircraft, it also
 * refuses requests whose Host header isn't ours (DNS rebinding) and POSTs that don't carry our
 * custom header (which a web page on another origin can't send without a CORS preflight).
 */
export function startServer(port: number, api: ServerApi, publicDir: string): Promise<http.Server> {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const clients = new Set<http.ServerResponse>()

  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'"
  }

  const send = (res: http.ServerResponse, status: number, body: string | Buffer, type: string): void => {
    res.writeHead(status, { ...baseHeaders, 'Content-Type': type })
    res.end(body)
  }
  const sendJson = (res: http.ServerResponse, status: number, value: unknown): void =>
    send(res, status, JSON.stringify(value), 'application/json; charset=utf-8')

  const broadcast = (): void => {
    if (clients.size === 0) return
    const frame = `data: ${JSON.stringify(api.getState())}\n\n`
    for (const c of clients) c.write(frame)
  }

  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY) {
          reject(new Error('request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (size === 0) return resolve({})
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {})
        } catch {
          reject(new Error('body is not valid JSON'))
        }
      })
      req.on('error', reject)
    })

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host ?? '')) return sendJson(res, 403, { ok: false, error: 'forbidden host' })
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (req.method === 'GET') {
        const file = FILES[url.pathname]
        if (file) return send(res, 200, fs.readFileSync(path.join(publicDir, file.file)), file.type)
        if (url.pathname === '/api/state') return sendJson(res, 200, api.getState())
        if (url.pathname === '/api/tray' && api.getTray) return sendJson(res, 200, api.getTray())
        if (url.pathname === '/api/stream') {
          res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
          res.write(`retry: 2000\n\ndata: ${JSON.stringify(api.getState())}\n\n`)
          clients.add(res)
          req.on('close', () => clients.delete(res))
          return
        }
        return sendJson(res, 404, { ok: false, error: 'not found' })
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['x-autostep'] !== '1' || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
          return sendJson(res, 403, { ok: false, error: 'missing required headers' })
        }
        const action = api.actions[url.pathname.slice('/api/'.length)]
        if (!action) return sendJson(res, 404, { ok: false, error: 'unknown action' })
        const result = await action(await readBody(req))
        broadcast()
        return sendJson(res, 200, { ok: true, result })
      }

      sendJson(res, 405, { ok: false, error: 'method not allowed' })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  setInterval(broadcast, 1000).unref()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
