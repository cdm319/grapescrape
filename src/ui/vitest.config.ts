import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/ui/**/*.test.{ts,tsx}"],
    setupFiles: ["test/ui/setup.ts"],
    restoreMocks: true,
  },
});
