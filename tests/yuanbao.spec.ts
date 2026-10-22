import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  YUANBAO_DEFAULT_BASE_URL,
  YUANBAO_PROVIDER_ID,
  YuanbaoSearchProvider,
  mapYuanbaoPage,
  mapYuanbaoResponse,
  normalizePublishedAt,
  resolveResultCount,
} from 'dsh-web-search-yuanbao'
import type { YuanbaoSearchProviderOptions } from 'dsh-web-search-yuanbao'
import * as yuanbaoPlugin from 'dsh-web-search-yuanbao'

const apiKeyEnv = credentialRef('TENCENTCLOUD_WSA_APIKEY')

const options: YuanbaoSearchProviderOptions = {
  apiKey: 'yuanbao-key',
  apiKeyEnv,
  baseURL: 'https://api.yuanbao.test',
  count: 10,
}

function searchProvider(overrides: Partial<YuanbaoSearchProviderOptions> = {}): YuanbaoSearchProvider {
  return new YuanbaoSearchProvider(() => ({ ...options, ...overrides }))
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function page(...entries: unknown[]): unknown {
  return { Response: { Pages: entries } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Yuanbao result count', () => {
  it('rounds a request bound up to the smallest accepted count', () => {
    expect(resolveResultCount(8, 10)).toBe(10)
    expect(resolveResultCount(10, 10)).toBe(10)
    expect(resolveResultCount(11, 10)).toBe(20)
    expect(resolveResultCount(50, 10)).toBe(50)
  })

  it('caps a bound above the service maximum', () => {
    expect(resolveResultCount(100, 10)).toBe(50)
  })

  it('uses the configured count when the request is unbounded', () => {
    expect(resolveResultCount(undefined, 30)).toBe(30)
  })
})

describe('Yuanbao publication-time normalization', () => {
  it('normalizes the service slash format', () => {
    expect(normalizePublishedAt('2025/07/02 00:00:00')).toBe('2025-07-02T00:00:00')
    expect(normalizePublishedAt('2025/7/2')).toBe('2025-07-02T00:00:00')
    expect(normalizePublishedAt('2025/07/02 5:03')).toBe('2025-07-02T05:03:00')
  })

  it('preserves an ISO-8601 date or date-time', () => {
    expect(normalizePublishedAt('2025-07-02')).toBe('2025-07-02')
    expect(normalizePublishedAt('2025-07-02T00:00:00Z')).toBe('2025-07-02T00:00:00Z')
    expect(normalizePublishedAt('2025-07-02T00:00:00.000+08:00')).toBe('2025-07-02T00:00:00.000+08:00')
  })

  it('omits an unparseable value', () => {
    expect(normalizePublishedAt('yesterday')).toBeUndefined()
    expect(normalizePublishedAt(undefined)).toBeUndefined()
  })
})

describe('Yuanbao page mapping', () => {
  it('maps a public-web page', () => {
    expect(mapYuanbaoPage({
      url: 'https://a.test',
      title: 'A',
      passage: 'excerpt',
      date: '2025/07/02 00:00:00',
      site: 'a.test',
      score: 0.95,
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'excerpt', publishedAt: '2025-07-02T00:00:00' })
  })

  it('prefers the display envelope of a vertical result', () => {
    expect(mapYuanbaoPage({
      vr: true,
      url: 'https://fallback.test',
      title: 'fallback',
      date: '2025/01/01',
      display: { url: 'https://display.test', title: 'Display', date: '2025/07/02 12:30:00' },
      content: 'vertical excerpt',
    })).toEqual({
      url: 'https://display.test',
      title: 'Display',
      snippet: 'vertical excerpt',
      publishedAt: '2025-07-02T12:30:00',
    })
  })

  it('prefers passage over content when both are present', () => {
    expect(mapYuanbaoPage({ url: 'https://a.test', passage: 'passage', content: 'content' }))
      .toEqual({ url: 'https://a.test', snippet: 'passage' })
  })

  it('falls back to the top-level excerpt when a vertical result has no display', () => {
    expect(mapYuanbaoPage({ vr: true, url: 'https://a.test', title: 'A', passage: 'excerpt' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'excerpt' })
  })

  it('omits a blank title and an unparseable date', () => {
    expect(mapYuanbaoPage({ url: 'https://a.test', title: '  ', passage: 'excerpt', date: 'unknown' }))
      .toEqual({ url: 'https://a.test', snippet: 'excerpt' })
  })

  it('drops an entry without a URL', () => {
    expect(mapYuanbaoPage({ title: 'A', passage: 'excerpt' })).toBeUndefined()
    expect(mapYuanbaoPage({ url: '   ', title: 'A', passage: 'excerpt' })).toBeUndefined()
  })

  it('drops an entry without an excerpt', () => {
    expect(mapYuanbaoPage({ url: 'https://a.test', title: 'A' })).toBeUndefined()
    expect(mapYuanbaoPage({ url: 'https://a.test', passage: '  ', content: '' })).toBeUndefined()
  })

  it('ignores a display envelope that is not an object', () => {
    expect(mapYuanbaoPage({ url: 'https://a.test', passage: 'excerpt', display: 'nope' }))
      .toEqual({ url: 'https://a.test', snippet: 'excerpt' })
  })
})

describe('Yuanbao response mapping', () => {
  it('decodes string and object page entries in order', () => {
    const result = mapYuanbaoResponse(page(
      JSON.stringify({ url: 'https://a.test', title: 'A', passage: 'one' }),
      { url: 'https://b.test', passage: 'two' },
      { url: 'https://c.test' },
    ))
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'one' },
        { url: 'https://b.test', snippet: 'two' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('treats a missing Pages array as a successful empty result', () => {
    expect(mapYuanbaoResponse({ Response: {} })).toEqual({ sources: [], truncated: false })
  })

  it('surfaces a provider error envelope', () => {
    expect(() => mapYuanbaoResponse({ Response: { Error: { Code: 'FailedOperation', Message: 'quota exceeded' } } }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'quota exceeded' }))
  })

  it('falls back to a stable message for an empty error envelope', () => {
    expect(() => mapYuanbaoResponse({ Response: { Error: { Message: '' } } }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Yuanbao search failed' }))
  })

  it('rejects an unprocessable envelope without returning a partial result', () => {
    for (const payload of [null, 'nope', {}, { Response: null }, { Response: { Pages: {} } }]) {
      expect(() => mapYuanbaoResponse(payload))
        .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Yuanbao returned an invalid response body' }))
    }
  })

  it('rejects a page entry that is not a JSON object', () => {
    expect(() => mapYuanbaoResponse(page('not json')))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(() => mapYuanbaoResponse(page(42)))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('YuanbaoSearchProvider availability', () => {
  it('is available with a literal key', () => {
    expect(searchProvider().available()).toBe(true)
  })

  it('is available with only a credential resolver', () => {
    expect(searchProvider({ apiKey: undefined, resolveApiKey: async () => 'stored' }).available()).toBe(true)
  })

  it('is unavailable without a key or resolver', () => {
    expect(searchProvider({ apiKey: undefined }).available()).toBe(false)
    expect(searchProvider({ apiKey: '', resolveApiKey: undefined }).available()).toBe(false)
  })

  it('is unavailable with an unparseable base URL', () => {
    expect(searchProvider({ baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is unavailable with a count the service does not accept', () => {
    expect(searchProvider({ count: 15 }).available()).toBe(false)
    expect(searchProvider({ count: 0 }).available()).toBe(false)
    expect(searchProvider({ count: 50 }).available()).toBe(true)
  })
})

describe('YuanbaoSearchProvider request mapping', () => {
  it('sends the query, resolved count and bearer credential', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page(JSON.stringify({ url: 'https://a.test', passage: 'hi' }))))
    vi.stubGlobal('fetch', fetchMock)

    await searchProvider({ count: 20 }).search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.yuanbao.test/SearchPro')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.headers).toMatchObject({
      authorization: 'Bearer yuanbao-key',
      'content-type': 'application/json; charset=utf-8',
      accept: 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({ Query: 'hello', Cnt: 10 })
  })

  it('uses the configured count when the request is unbounded', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    await searchProvider({ count: 30 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ Query: 'q', Cnt: 30 })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await searchProvider().search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('YuanbaoSearchProvider credentials', () => {
  it('prefers a literal key over the resolver', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const resolveApiKey = vi.fn(async () => 'stored-key')
    await searchProvider({ resolveApiKey }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer yuanbao-key' })
    expect(resolveApiKey).not.toHaveBeenCalled()
  })

  it('uses the resolver when no literal key is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    await searchProvider({ apiKey: undefined, resolveApiKey: async () => 'stored-key' }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored-key' })
  })

  it('fails with WEB_PROVIDER_CREDENTIAL_MISSING when no key resolves', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchProvider({ apiKey: undefined }).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    await expect(searchProvider({ apiKey: undefined, resolveApiKey: async () => '' }).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the credential reference in the missing-key message', async () => {
    const caught = await searchProvider({ apiKey: undefined }).search({ query: 'q' }).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('TENCENTCLOUD_WSA_APIKEY')
  })

  it('maps an abort raised by the credential resolver to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page())))
    await expect(searchProvider({
      apiKey: undefined,
      resolveApiKey: async () => { throw new DOMException('aborted', 'AbortError') },
    }).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a resolver failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page())))
    await expect(searchProvider({ apiKey: undefined, resolveApiKey: async () => { throw new Error('vault down') } }).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Yuanbao search credential resolution failed: Error: vault down' }))
  })

  it('does not start the request after the caller aborts before resolution', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort('stop')
    await expect(searchProvider().search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not start the request when the signal aborts during resolution', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const resolveApiKey = async (): Promise<string> => {
      controller.abort('stop')
      return 'key'
    }
    await expect(searchProvider({ apiKey: undefined, resolveApiKey }).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('YuanbaoSearchProvider error handling', () => {
  it('uses the provider error message from a non-success response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { Response: { Error: { Code: 'AuthFailure', Message: 'invalid api key' } } },
      { status: 401 },
    )))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'invalid api key' }))
  })

  it('keeps the status-line message when the error body carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 503 })))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Yuanbao API error (HTTP 503)' }))
  })

  it('falls back to the status line for error bodies without a readable message', async () => {
    for (const body of [[], { Response: 5 }, { Response: { Error: 'bad' } }, { Response: { Error: { Message: 42 } } }]) {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, { status: 500 })))
      await expect(searchProvider().search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ message: 'Yuanbao API error (HTTP 500)' }))
    }
  })

  it('keeps the status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Yuanbao API error (HTTP 502)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a fetch abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('passes a provider error envelope from a success response through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ Response: { Error: { Message: 'quota exceeded' } } })))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'quota exceeded' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(searchProvider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-yuanbao plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page())))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
    const fiber = await ctx.plugin(yuanbaoPlugin, { apiKey: 'yuanbao-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
    await ctx.fiber.dispose()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in yuanbaoPlugin).toBe(false)
  })

  it('uses the default base URL and count', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
    await ctx.plugin(yuanbaoPlugin, { apiKey: 'yuanbao-key' })
    await ctx.web.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${YUANBAO_DEFAULT_BASE_URL}/SearchPro`)
    expect(JSON.parse(init.body as string)).toEqual({ Query: 'q', Cnt: 10 })
    await ctx.fiber.dispose()
  })

  it('threads baseURL and count config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
    await ctx.plugin(yuanbaoPlugin, { apiKey: 'yuanbao-key', baseURL: 'https://gateway.test/wsa', count: 30 })
    await ctx.web.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gateway.test/wsa/SearchPro')
    expect(JSON.parse(init.body as string)).toEqual({ Query: 'q', Cnt: 30 })
    await ctx.fiber.dispose()
  })

  it('falls back to $TENCENTCLOUD_WSA_APIKEY from the launch environment', async () => {
    const previous = process.env.TENCENTCLOUD_WSA_APIKEY
    process.env.TENCENTCLOUD_WSA_APIKEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(page()))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
      await ctx.plugin(yuanbaoPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(init.headers).toMatchObject({ authorization: 'Bearer env-key' })
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.TENCENTCLOUD_WSA_APIKEY
      else process.env.TENCENTCLOUD_WSA_APIKEY = previous
    }
  })

  it('treats an empty environment value as a missing credential', async () => {
    const previous = process.env.TENCENTCLOUD_WSA_APIKEY
    process.env.TENCENTCLOUD_WSA_APIKEY = ''
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
      await ctx.plugin(yuanbaoPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.TENCENTCLOUD_WSA_APIKEY
      else process.env.TENCENTCLOUD_WSA_APIKEY = previous
    }
  })

  it('resolves a stored credential for each search', async () => {
    const previous = process.env.TENCENTCLOUD_WSA_APIKEY
    delete process.env.TENCENTCLOUD_WSA_APIKEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-yuanbao-'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(yuanbaoPlugin, {})
      await expect(ctx.web.search({ query: 'missing' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))

      await ctx.credentials.set(apiKeyEnv, 'stored-key')
      await ctx.web.search({ query: 'stored' })
      await ctx.credentials.set(apiKeyEnv, 'rotated-key')
      await ctx.web.search({ query: 'rotated' })

      const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
      expect(headers.map(value => value.authorization)).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.TENCENTCLOUD_WSA_APIKEY
      else process.env.TENCENTCLOUD_WSA_APIKEY = previous
    }
  })

  it('uses a custom credential reference', async () => {
    const previous = process.env.CUSTOM_WSA_KEY
    process.env.CUSTOM_WSA_KEY = 'custom-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(page()))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
      await ctx.plugin(yuanbaoPlugin, { apiKeyEnv: 'CUSTOM_WSA_KEY' })
      await ctx.web.search({ query: 'q' })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(init.headers).toMatchObject({ authorization: 'Bearer custom-key' })
      await ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.CUSTOM_WSA_KEY
      else process.env.CUSTOM_WSA_KEY = previous
    }
  })

  it('is unavailable when the configured base URL is unparseable', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: YUANBAO_PROVIDER_ID })
    await ctx.plugin(yuanbaoPlugin, { apiKey: 'yuanbao-key', baseURL: 'not a url' })
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    await ctx.fiber.dispose()
  })
})
