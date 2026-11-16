// Chromium, one worker, and the one sanctioned exception to "an agent never
// starts the server": this runner owns the process for the length of the run
// and stops it after. Port 8090, never the developer's 8080.
import { defineConfig } from "@playwright/test";

const PORT = 8090;

export default defineConfig({
  testDir: "tests",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node ../server/src/app/main.mjs",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), APP_ENV: "e2e" },
  },
});
