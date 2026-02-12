import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "**/test/integration/**/*.test.ts",
      "**/test/integration/**/*.spec.ts",
    ],
    exclude: ["**/test/integration/setup.ts"],
    globals: true,
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 2 * 60 * 1000,
    setupFiles: ["test/integration/setup.ts"],
  },
});
