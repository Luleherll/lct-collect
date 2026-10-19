import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  server: { host: '0.0.0.0' },
  vite: { server: { allowedHosts: ['terminal.local'] } },
});
