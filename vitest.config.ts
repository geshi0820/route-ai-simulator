import { defineConfig } from 'vitest/config';

/* Node reports every import back over IPC when WATCH_REPORT_DEPENDENCIES is set,
   which is what `node --watch` does to its children. A shell that has run a watch
   -mode dev server keeps the variable, and vitest's fork pool then rejects the
   unexpected process.send() with a bare ERR_INVALID_ARG_TYPE — no test even runs.
   The workers inherit this process's env, so clearing it here is enough. */
delete process.env.WATCH_REPORT_DEPENDENCIES;

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',   // each test builds its own jsdom window from index.html
  },
});
