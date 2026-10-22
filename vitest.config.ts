import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Tests import the package by name, so the alias points that name at the
 * TypeScript source instead of requiring a build first.
 */
const sourceEntry = fileURLToPath(new URL('./src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'dsh-web-search-yuanbao': sourceEntry,
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
