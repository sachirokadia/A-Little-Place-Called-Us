import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin proxy (spec Option B shape) so the HTTP-only
    // session cookie works in local development without a
    // cross-site cookie. Production cookie model is R1, UNDECIDED.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
