import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const temp = await mkdtemp(join(tmpdir(), 'forge-vercel-artifact-'));
let child;
try {
  const entry = join(temp, 'index.mjs');
  await copyFile(resolve('.vercel/output/functions/forge.func/index.mjs'), entry);
  // No node_modules or source tree exists beside this isolated function.
  const code = `import {createServer} from 'node:http';import handler from ${JSON.stringify(pathToFileURL(entry).href)};const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>String(input)==='https://rpc.forge-test.invalid/'?Promise.resolve(new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(init.body).id,result:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'}),{headers:{'Content-Type':'application/json'}})):nativeFetch(input,init);const server=createServer(handler);server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`;
  child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: temp,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://forge.example',
      FORGE_API_ORIGIN: '',
      SOLANA_CLUSTER: 'mainnet-beta',
      SOLANA_RPC_URL: 'https://rpc.forge-test.invalid/',
      PLATFORM_FEE_WALLET: '',
      DBC_CONFIG_ADDRESS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const port = await new Promise((resolvePort, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Bundled API startup timed out: ${logs}`)),
      15000,
    );
    child.stderr.on('data', (bytes) => {
      logs += bytes;
    });
    child.stdout.on('data', (bytes) => {
      for (const line of bytes.toString().split('\n')) {
        if (line.startsWith('{"port":')) {
          clearTimeout(timeout);
          resolvePort(JSON.parse(line).port);
        }
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bundled API exited ${code}: ${logs}`));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const config = await fetch(origin + '/api/forge?__forge_path=/api/config');
  if (!config.ok || !(await config.json()).backendRequired)
    throw new Error('Bundled API config failed.');
  if (!(await fetch(origin + '/healthz')).ok) throw new Error('Bundled API health failed.');
  const statusResponse = await fetch(origin + '/api/live/status');
  const status = await statusResponse.json();
  if (!statusResponse.ok || !status.rpcReady || !status.backendRequired || status.launchEnabled)
    throw new Error(`Bundled SDK status failed: ${JSON.stringify(status)}`);
  const auth = await fetch(origin + '/api/live/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://forge.example' },
    body: '{}',
  });
  if (auth.status !== 503 || (await auth.json()).code !== 'PERSISTENT_BACKEND_REQUIRED')
    throw new Error('Bundled API enabled ephemeral wallet authentication.');
  console.log(
    'Isolated Vercel function passed: imports, API config, health and transaction gating.',
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep))
    await rm(temp, { recursive: true, force: true });
}
