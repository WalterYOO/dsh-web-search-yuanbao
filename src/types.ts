/**
 * Wire types for the Tencent Yuanbao Search API (`POST https://api.wsa.cloud.tencent.com/SearchPro`).
 * Types only — no runtime code. The response wraps each result as a JSON string
 * inside `Response.Pages`; vertical results add a `display` envelope.
 *
 * @module dsh-web-search-yuanbao/types
 */

/** Request body sent to `/SearchPro`. */
export interface YuanbaoSearchRequest {
  /** Search keywords. */
  Query: string
  /** Result count; the service accepts 10, 20, 30, 40, or 50. */
  Cnt: number
}

/** One decoded entry of `Response.Pages`. Fields vary by result kind. */
export interface YuanbaoPage {
  /** Result URL. */
  url?: string
  /** Result title. */
  title?: string
  /** Publishing site name, which the web seam does not carry. */
  site?: string
  /** Publication time; the service formats it as `YYYY/MM/DD HH:mm:ss`. */
  date?: string
  /** Relevance score. */
  score?: number
  /** Result excerpt, used as the portable snippet. */
  passage?: string
  /** Vertical-result text, used when `passage` is absent. */
  content?: string
  /** True for a vertical-authority result (weather, prices, stocks). */
  vr?: boolean
  /** Display envelope carried by vertical results. */
  display?: {
    url?: string
    title?: string
    date?: string
  }
  /** Related images; the web seam does not carry them. */
  pics?: { caption?: string; origin_url?: string }[]
}

/** Error object in the response envelope. */
export interface YuanbaoError {
  /** Service error code. */
  Code?: string
  /** Human-readable failure message. */
  Message?: string
}

/** Response envelope. `Pages` entries arrive as JSON strings. */
export interface YuanbaoSearchResponse {
  Response?: {
    Pages?: unknown[]
    Error?: YuanbaoError
  }
}
