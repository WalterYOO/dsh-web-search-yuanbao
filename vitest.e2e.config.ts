import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sourceEntry = fileURLToPath(new URL('./src/index.ts', import.meta.url))

/**
 * Real-API smoke tests. They self-skip unless `$TENCENTCLOUD_WSA_APIKEY` is
 * exported, so this config is safe to run in CI without secrets.
 */
export default defineConfig({
  resolve: {
    alias: {
      'dsh-web-search-yuanbao': sourceEntry,
    },
  },
  test: {
    include: ['tests/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
