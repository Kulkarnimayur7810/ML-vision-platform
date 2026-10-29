import { defineConfig, devices } from "@playwright/test";
const PORT = 3100;
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/wv_e2e";
export default defineConfig({
  testDir: "tests/e2e", globalSetup: "./tests/e2e/global-setup.ts", timeout: 45000, fullyParallel: false, workers: 1, retries: 0,
  expect: { timeout: 8000 },
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`, port: PORT, reuseExistingServer: false, timeout: 60000,
    env: { DATABASE_URL: DB, APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-00", NODE_ENV: "production", STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: "/tmp/claude-0/wv-e2e-store" },
  },
});
