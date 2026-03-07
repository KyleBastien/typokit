import { defineConfig } from "@rstest/core";

export default defineConfig({
  exclude: ["**/e2e.test.ts", "**/node_modules/**"],
});
