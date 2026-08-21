import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node18',
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  banner: ({ format }) => (format === 'esm' ? { js: '' } : {}),
});
