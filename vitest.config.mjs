import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,mjs}'],
    testTimeout: 20000,
  },
});
