import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Ship the exact standalone function we test, without runtime TypeScript tracing.
const output = resolve('.vercel/output');
const functionDir = resolve(output, 'functions/forge.func');
await mkdir(functionDir, { recursive: true });
await build({
  entryPoints: ['api/forge.ts'],
  outfile: resolve(functionDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __forgeCreateRequire } from 'node:module'; const require = __forgeCreateRequire(import.meta.url);",
  },
});
await writeFile(
  resolve(functionDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      maxDuration: 60,
    },
    null,
    2,
  ),
);
await cp('dist', resolve(output, 'static'), { recursive: true });
await writeFile(
  resolve(output, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/api/(.*)', dest: '/forge?__forge_path=/api/$1' },
        { src: '/media/(.*)', dest: '/forge?__forge_path=/media/$1' },
        { src: '/metadata/(.*)', dest: '/forge?__forge_path=/metadata/$1' },
        { src: '/healthz', dest: '/forge?__forge_path=/healthz' },
        { src: '/readyz', dest: '/forge?__forge_path=/readyz' },
        { handle: 'filesystem' },
        { src: '/.*', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel output ready: static frontend and bundled Node 24 API function.');
