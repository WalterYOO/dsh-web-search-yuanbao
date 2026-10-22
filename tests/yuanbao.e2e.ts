import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  YUANBAO_DEFAULT_BASE_URL,
  YUANBAO_DEFAULT_COUNT,
  YuanbaoSearchProvider,
} from 'dsh-web-search-yuanbao'

/**
 * Real-API smoke for the Tencent Yuanbao search provider. Self-skips without
 * `$TENCENTCLOUD_WSA_APIKEY` (CI has no secrets), per the with-key e2e policy in
 * docs/testing.md.
 */
const apiKey = process.env.TENCENTCLOUD_WSA_APIKEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('YuanbaoSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new YuanbaoSearchProvider(() => ({
      apiKey: apiKey!,
      apiKeyEnv: credentialRef('TENCENTCLOUD_WSA_APIKEY'),
      baseURL: process.env.TENCENTCLOUD_WSA_BASE_URL ?? YUANBAO_DEFAULT_BASE_URL,
      count: YUANBAO_DEFAULT_COUNT,
    }))
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
