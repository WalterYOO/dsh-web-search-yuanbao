/**
 * `YuanbaoSearchProvider`: a `WebSearchProvider` backed by the Tencent Yuanbao
 * Search API (`POST /SearchPro`). Each search is one direct HTTP request. Results
 * arrive as JSON strings inside `Response.Pages`; the provider maps each usable
 * entry to a portable source, normalizes the service's `YYYY/MM/DD HH:mm:ss`
 * publication time to ISO-8601, and drops entries without a URL or excerpt.
 * @module dsh-web-search-yuanbao/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const YUANBAO_PROVIDER_ID = 'yuanbao'

/** Default Yuanbao Search API base; `/SearchPro` is the operation. */
export const YUANBAO_DEFAULT_BASE_URL = 'https://api.wsa.cloud.tencent.com'

/** Default credential reference read from the launch environment. */
export const YUANBAO_DEFAULT_API_KEY_ENV = 'TENCENTCLOUD_WSA_APIKEY'

/** Operation path appended to the endpoint base. */
export const YUANBAO_SEARCH_PATH = '/SearchPro'

/** Result counts the service accepts. */
export const YUANBAO_ALLOWED_COUNTS = [10, 20, 30, 40, 50] as const

/** Default result count used when a request carries no bound. */
export const YUANBAO_DEFAULT_COUNT = YUANBAO_ALLOWED_COUNTS[0]

/** Largest result count the service accepts. */
export const YUANBAO_MAX_COUNT: (typeof YUANBAO_ALLOWED_COUNTS)[number] = 50

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** `YYYY/MM/DD`, optionally followed by a time. */
const SLASH_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** An ISO-8601 date or date-time, preserved as the provider supplied it. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** Resolved provider options (the plugin's `apply` supplies defaults per operation). */
export interface YuanbaoSearchProviderOptions {
  /** Literal API key; when non-empty it wins over {@link resolveApiKey}. */
  apiKey?: string | undefined
  /** Resolve the current API key for one search. */
  resolveApiKey?: (() => Promise<string | undefined>) | undefined
  /** Credential reference named by missing-key diagnostics. */
  apiKeyEnv: CredentialRef
  /** Endpoint base; {@link YUANBAO_SEARCH_PATH} is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  count: number
}

/**
 * Resolve the `Cnt` value for one search: the smallest accepted count that
 * covers the request's bound, falling back to the configured count when the
 * request is unbounded.
 *
 * @param maxResults - the consumer's upper bound, when it set one.
 * @param configured - the deployment's default count.
 * @returns a count the service accepts.
 */
export function resolveResultCount(maxResults: number | undefined, configured: number): number {
  const requested = maxResults ?? configured
  return YUANBAO_ALLOWED_COUNTS.find(count => count >= requested) ?? YUANBAO_MAX_COUNT
}

/**
 * Normalize a provider-supplied publication time to ISO-8601. Values already in
 * ISO form pass through; `YYYY/MM/DD HH:mm:ss` gains dashes and a `T`; anything
 * else is omitted rather than emitted as a non-ISO value.
 *
 * @param value - the service's date string.
 * @returns the ISO-8601 value, or `undefined` when it cannot be normalized.
 */
export function normalizePublishedAt(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (ISO_DATE.test(value)) return value
  const match = SLASH_DATE.exec(value)
  if (match === null) return undefined
  const [, year = '', month = '', day = '', hours = '00', minutes = '00', seconds = '00'] = match
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

/**
 * Map one decoded page to a normalized source. The result keeps the excerpt the
 * service supplies (vertical results use `content` when `passage` is absent),
 * and drops an entry with no URL or excerpt because the seam has no other field
 * to derive one from.
 *
 * @param page - one decoded entry of `Response.Pages`.
 * @returns the normalized source, or `undefined` when the entry is unusable.
 */
export function mapYuanbaoPage(page: Record<string, unknown>): WebSearchSource | undefined {
  const display = isRecord(page.display) ? page.display : undefined
  const url = firstNonBlankString(display?.url, page.url)
  if (url === undefined) return undefined
  const snippet = firstNonBlankString(page.passage, page.content)
  if (snippet === undefined) return undefined
  const title = firstNonBlankString(display?.title, page.title)
  const publishedAt = normalizePublishedAt(firstNonBlankString(display?.date, page.date))
  return {
    url,
    ...title !== undefined ? { title } : {},
    snippet,
    ...publishedAt !== undefined ? { publishedAt } : {},
  }
}

/**
 * Map a parsed response envelope to a normalized search result. Page entries
 * may be JSON strings or decoded objects; a malformed envelope fails loudly
 * instead of returning a partial result.
 *
 * @param payload - the parsed response body.
 * @returns the normalized result, with `truncated: false` because the web
 *   service owns the final `maxResults` truncation.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` for an error envelope or an
 *   unprocessable body.
 */
export function mapYuanbaoResponse(payload: unknown): WebSearchResult {
  if (!isRecord(payload)) throw invalidResponse()
  const response = payload.Response
  if (!isRecord(response)) throw invalidResponse()
  const error = response.Error
  if (isRecord(error)) {
    const message = typeof error.Message === 'string' && error.Message.length > 0
      ? error.Message
      : 'Yuanbao search failed'
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }
  const pages = response.Pages
  if (pages === undefined) return { sources: [], truncated: false }
  if (!Array.isArray(pages)) throw invalidResponse()
  const sources: WebSearchSource[] = []
  for (const entry of pages) {
    const decoded = decodePage(entry)
    if (!isRecord(decoded)) throw invalidResponse()
    const source = mapYuanbaoPage(decoded)
    if (source !== undefined) sources.push(source)
  }
  return { sources, truncated: false }
}

/** The Yuanbao-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class YuanbaoSearchProvider implements WebSearchProvider {
  readonly id = YUANBAO_PROVIDER_ID

  constructor(private readonly resolveOptions: () => YuanbaoSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && isAllowedCount(options.count)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One settings snapshot for the whole operation: the credential and the
    // endpoint it is sent to must come from the same section.
    const options = this.resolveOptions()
    const endpoint = `${options.baseURL}${YUANBAO_SEARCH_PATH}`
    const apiKey = await resolveApiKey(options, signal)
    throwIfAborted(signal)
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json; charset=utf-8',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          Query: request.query,
          Cnt: resolveResultCount(request.maxResults, options.count),
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error)
      throw new WebError(`Yuanbao search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Yuanbao API error (HTTP ${status})`
      try {
        const detail = responseErrorMessage(await response.json())
        if (detail !== undefined) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw searchAborted(error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed or non-JSON error body can only cost a richer provider
        // message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapYuanbaoResponse(await response.json())
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error)
      if (error instanceof WebError) throw error
      throw new WebError(`Yuanbao returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `value` is a count the service accepts. */
function isAllowedCount(value: number): boolean {
  return YUANBAO_ALLOWED_COUNTS.some(count => count === value)
}

/** True for a plain object, the only container the response fields may have. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return the first value that is a string with non-blank content. */
function firstNonBlankString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

/** Left-pad a month, day, or time field to two digits. */
function pad2(value: string): string {
  return value.padStart(2, '0')
}

/** Decode one `Pages` entry; object entries pass through unchanged. */
function decodePage(entry: unknown): unknown {
  if (typeof entry !== 'string') return entry
  try {
    return JSON.parse(entry)
  } catch (error: unknown) {
    throw invalidResponse(error)
  }
}

/** Read a provider error message from an error-response body. */
function responseErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const response = payload.Response
  if (!isRecord(response)) return undefined
  const error = response.Error
  if (!isRecord(error)) return undefined
  return typeof error.Message === 'string' && error.Message.length > 0 ? error.Message : undefined
}

/** Build the stable error for a body the provider cannot interpret. */
function invalidResponse(cause?: unknown): WebError {
  return new WebError(
    'Yuanbao returned an invalid response body',
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Resolve the operation's API key without retaining it on the provider.
 *
 * @param options - the operation's settings snapshot.
 * @param signal - the caller's cancellation signal.
 * @returns the resolved literal or stored key.
 * @throws {@link WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when no key exists,
 *   `WEB_PROVIDER_ERROR` when resolution fails, `WEB_ABORTED` on cancellation.
 */
async function resolveApiKey(options: YuanbaoSearchProviderOptions, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
  const { resolveApiKey } = options
  let resolved: string | undefined
  try {
    resolved = resolveApiKey === undefined ? undefined : await resolveApiKey()
  } catch (error: unknown) {
    if (isAbortError(error)) throw searchAborted(error)
    throw new WebError(`Yuanbao search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  throwIfAborted(signal)
  if (resolved !== undefined && resolved.length > 0) return resolved
  throw new WebError(
    `Yuanbao search has no API key for "${options.apiKeyEnv}"; store it through the credentials service,`
      + ' export it in the launching environment, or set a literal "apiKey" in the web-search-yuanbao config',
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal.reason)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(cause: unknown): WebError {
  return new WebError('Yuanbao search aborted', 'WEB_ABORTED', { cause })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
