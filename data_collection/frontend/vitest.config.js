/**
 * Vitest config for the component tests.
 *
 * Separate from vite.config.js so the app build stays untouched. The pure-math
 * suite (scripts/test_pose_math.mjs) still runs under `node --test` — it needs
 * no DOM and there is no reason to slow it down with one.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
  define: {
    // The components read Supabase config through import.meta.env. Tests must
    // never reach a real project, so these are deliberately fake.
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://supabase.test'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
  },
});
