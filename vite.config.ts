import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['libheif-js'] },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
