import { defineConfig, devices } from '@playwright/test';

/* The app is one static file, so there is no server to start: every test opens
   index.html over file://. Chromium only — the change under test is SVG and
   CSS custom properties, which do not differ by engine here. */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 900 },
    colorScheme: 'light',
  },
});
