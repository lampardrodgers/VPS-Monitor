import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../packages/controller/src/bandwidth_monitor_controller/web",
    emptyOutDir: true,
  },
});
