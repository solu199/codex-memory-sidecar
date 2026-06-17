import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/dashboard-app"),
  base: "/dashboard-assets/",
  build: {
    outDir: resolve("dist/dashboard-app"),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "assets",
  },
});
