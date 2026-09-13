import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Hold detection is off by default (no permissively-licensed model exists —
 * see src/services/holdDetector.js). When it is off, the flag folds to false
 * and the `import('onnxruntime-web')` calls become unreachable, but Vite would
 * still resolve the package and emit its ~28 MB wasm as an orphan asset that
 * nothing references.
 *
 * Marking it external in that case keeps it out of the build entirely. It is
 * safe precisely because the only code that imports it is unreachable; turning
 * the flag on puts the package back in the graph and bundles it properly.
 */
const holdDetection = process.env.VITE_ENABLE_HOLD_DETECTION === 'true';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: holdDetection ? {} : { exclude: ['onnxruntime-web'] },
  build: {
    rollupOptions: {
      external: holdDetection ? [] : ['onnxruntime-web'],
    },
  },
});
