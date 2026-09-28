import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Server secrets and NODE_ENV in .env must not influence the browser build.
export default defineConfig({
  envDir: false,
  plugins: [react()],
  build: { outDir: "dist" },
});
