import { defineConfig } from 'vite-plus';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  pack: {
    clean: true,
    dts: true,
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    minify: isProduction,
    sourcemap: true,
    target: false,
  },
});
