import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-vendor";
          if (id.includes("/lightweight-charts/")) return "chart-vendor";
          if (id.includes("/@supabase/") || id.includes("/@supabase")) return "supabase-vendor";
          if (id.includes("/lucide-react/")) return "icons-vendor";
        },
      },
    },
  },
});
