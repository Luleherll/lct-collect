import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  trailingSlash: 'always',
  integrations: [react()],
  server: { host: '0.0.0.0' },
  vite: { server: { allowedHosts: ['terminal.local'] } },
});
