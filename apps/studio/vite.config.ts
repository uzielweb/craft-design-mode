import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkgPath = (rel: string) =>
  decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design-mode/vector-core': pkgPath('../../packages/vector-core/src/index.ts'),
      '@design-mode/host-bridge': pkgPath('../../packages/host-bridge/src/index.ts'),
      '@design-mode/ui-panels': pkgPath('../../packages/ui-panels/src/index.ts'),
    },
  },
});
