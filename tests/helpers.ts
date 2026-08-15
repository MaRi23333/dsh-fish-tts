/**
 * Minimal mocks for exercising the plugin host (apply) end-to-end without a
 * real harness: a webServer stub capturing registered routes, a Context stub
 * tracking effect cleanups, and IncomingMessage/ServerResponse stand-ins.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface RouteSpec {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface MockWeb {
  routes: Map<string, RouteSpec>
  register: (spec: RouteSpec) => void
}

export function makeWeb(): MockWeb {
  const routes = new Map<string, RouteSpec>()
  return {
    routes,
    register(spec: RouteSpec): void {
      routes.set(spec.path, spec)
    },
  }
}

export interface MockCtx {
  cleanups: Array<() => void>
  get: (key: string) => unknown
  on: () => () => void
  effect: (fn: () => unknown) => void
}

export function makeCtx(web: MockWeb): MockCtx {
  const cleanups: Array<() => void> = []
  return {
    cleanups,
    get(key: string): unknown {
      return key === 'webServer' ? web : undefined
    },
    on(): () => void {
      return () => {}
    },
    effect(fn: () => unknown): void {
      const result = fn()
      if (typeof result === 'function') cleanups.push(result as () => void)
    },
  }
}

export interface ReqOptions {
  method?: string
  headers?: Record<string, string | undefined>
  remoteAddress?: string
  body?: string | Buffer
}

export function makeReq(options: ReqOptions = {}): IncomingMessage {
  const { method = 'GET', headers = {}, remoteAddress = '127.0.0.1', body = '' } = options
  const req = {
    method,
    headers,
    socket: { remoteAddress },
  } as IncomingMessage
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
  ;(req as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<Buffer> })[Symbol.asyncIterator] =
    async function* (): AsyncGenerator<Buffer> {
      if (buffer.length > 0) yield buffer
    }
  return req
}

export interface MockRes {
  status: number
  headers: Record<string, string | number>
  body: string
  writeHead: (status: number, headers: Record<string, string | number>) => void
  end: (body?: unknown) => void
}

export function makeRes(): MockRes {
  const record: MockRes = {
    status: 200,
    headers: {},
    body: '',
    writeHead(status: number, headers: Record<string, string | number>): void {
      record.status = status
      record.headers = headers
    },
    end(body?: unknown): void {
      record.body = typeof body === 'string' ? body : (body as Buffer | undefined)?.toString('utf8') ?? ''
    },
  }
  return record
}

export function jsonBody(res: MockRes): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>
}

export async function dispatch(
  web: MockWeb,
  path: string,
  reqOptions: ReqOptions = {},
): Promise<MockRes> {
  const spec = web.routes.get(path)
  if (spec === undefined) throw new Error(`route not mounted: ${path}`)
  const req = makeReq(reqOptions)
  const res = makeRes()
  await spec.handler(req, res as ServerResponse)
  return res
}
