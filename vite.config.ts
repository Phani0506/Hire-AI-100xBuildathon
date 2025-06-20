import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";Add commentMore actions
import path from "path";
import { componentTagger } from "lovable-tagger";

More actions
// https://vitejs.dev/config/
server: {Add commentMore actions
    host: "::",
    port: 8080,
export default defineConfig(({ mode }) => ({
},
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {Add commentMore actions
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
},Add commentMore actions
}));
