import { defineConfig } from "vite";

// GitHub Pages serves project sites under /<repo>/, so assets must resolve
// against that base. Override with BASE=/ for local/other hosting.
export default defineConfig({
  base: process.env.BASE ?? "/xray-scanner/",
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
});
