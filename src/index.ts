/**
 * Tencent Yuanbao Search-backed `WebSearchProvider` plugin. It contributes to
 * the `ctx.web` registry without owning the service; each search is one direct
 * request to the Yuanbao Search API, resolved with the session's stored
 * credential or the launching environment.
 *
 * @module dsh-web-search-yuanbao
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  YUANBAO_ALLOWED_COUNTS,
  YUANBAO_DEFAULT_API_KEY_ENV,
  YUANBAO_DEFAULT_BASE_URL,
  YUANBAO_DEFAULT_COUNT,
  YuanbaoSearchProvider,
} from './provider.ts'

export {
  YUANBAO_ALLOWED_COUNTS,
  YUANBAO_DEFAULT_API_KEY_ENV,
  YUANBAO_DEFAULT_BASE_URL,
  YUANBAO_DEFAULT_COUNT,
  YUANBAO_MAX_COUNT,
  YUANBAO_PROVIDER_ID,
  YUANBAO_SEARCH_PATH,
  YuanbaoSearchProvider,
  mapYuanbaoPage,
  mapYuanbaoResponse,
  normalizePublishedAt,
  resolveResultCount,
} from './provider.ts'
export type { YuanbaoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-yuanbao'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Settings read by the next search without re-registering the provider. */
export interface Config {
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search; defaults to `TENCENTCLOUD_WSA_APIKEY`. */
  apiKeyEnv: Volatile<string>
  /** Endpoint base; `/SearchPro` is appended. */
  baseURL: Volatile<string>
  /** Results per search when the request carries no bound; 10, 20, 30, 40, or 50. */
  count: Volatile<number>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string()
    .role('credential-ref')
    .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default(YUANBAO_DEFAULT_API_KEY_ENV)
    .volatile(),
  baseURL: z.string().default(YUANBAO_DEFAULT_BASE_URL).volatile(),
  count: z.union(YUANBAO_ALLOWED_COUNTS).default(YUANBAO_DEFAULT_COUNT).volatile(),
})

/**
 * Register the Yuanbao search provider with `ctx.web`. Credential resolution
 * stays per search so a stored or rotated key reaches the next operation
 * without a restart.
 *
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - live settings, read once per operation.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new YuanbaoSearchProvider(() => {
    const literalApiKey = config.apiKey.get()
    const apiKeyEnv = credentialRef(config.apiKeyEnv.get())
    return {
      ...literalApiKey !== undefined && literalApiKey.length > 0 ? { apiKey: literalApiKey } : {},
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        // Without the seam the launch environment is the whole credential plane.
        const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv,
      baseURL: config.baseURL.get(),
      count: config.count.get(),
    }
  }))
}
