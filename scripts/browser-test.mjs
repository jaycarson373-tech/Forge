import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = await mkdtemp(join(tmpdir(), 'forge-browser-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, APP_MODE: 'paper', PORT: '18788', DATA_PATH: join(temp, 'paper.sqlite') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Forge →')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}`));
    });
  });
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A warming/restarting API must recover without requiring a manual reload.
  let configAttempts = 0;
  await page.route('**/api/config', (route) => {
    configAttempts++;
    return configAttempts < 3
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      : route.continue();
  });
  await page.goto('http://127.0.0.1:18788');
  await page.getByText('Fresh signals').waitFor();
  if (configAttempts !== 3) throw new Error('Startup did not retry a temporarily unavailable API.');
  await page.unroute('**/api/config');

  // Static-host HTML must explain the missing API and recover after Retry.
  const recovery = await browser.newPage();
  await recovery.route('**/api/config', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><h1>Static host</h1>',
    }),
  );
  await recovery.goto('http://127.0.0.1:18788');
  await recovery.getByRole('heading', { name: 'Forge could not connect.' }).waitFor();
  await recovery.getByText('This address serves a webpage instead of the Forge API.').waitFor();
  await recovery.unroute('**/api/config');
  await recovery.getByRole('button', { name: 'Retry Forge' }).click();
  await recovery.getByText('Fresh signals').waitFor();
  await recovery.close();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Moon Circuit' }).click();
  await page.waitForFunction(() => !document.querySelector('.order-panel .primary')?.disabled);
  await page.getByRole('button', { name: 'Buy CIRCUIT with paper funds' }).click();
  await page.getByRole('status').filter({ hasText: 'Paper trade executed' }).waitFor();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.order-panel .primary')?.disabled);
  await page.getByRole('button', { name: 'Sell CIRCUIT with paper funds' }).click();
  await page.getByRole('status').filter({ hasText: 'Paper trade executed' }).waitFor();
  await page.getByRole('button', { name: 'Your portfolio' }).click();
  await page.getByRole('heading', { name: 'Your portfolio' }).waitFor();
  await page.getByRole('button', { name: 'Launch a coin' }).first().click();
  await page.getByLabel('Coin name').fill('Test Signal');
  await page.getByLabel('Ticker', { exact: true }).fill('SIG');
  await page.getByLabel('Description', { exact: true }).fill('A browser-tested paper launch.');
  await page.getByRole('button', { name: 'Launch paper coin' }).click();
  await page.getByRole('heading', { name: 'Test Signal', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Fee dashboard' }).click();
  await page.getByRole('heading', { name: 'Nothing behind the curtain.' }).waitFor();
  await page.getByRole('button', { name: 'Under the hood' }).click();
  await page.getByRole('heading', { name: 'The mechanics behind the signal.' }).waitFor();
  await page.getByRole('button', { name: 'Discover', exact: false }).first().click();
  await page.getByLabel('Search coins').fill('VOID');
  if ((await page.locator('.coin-card').count()) !== 1) throw new Error('Search filter failed');
  await page.getByLabel('Search coins').fill('');
  await page.waitForTimeout(4600);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Mobile horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'Browser checks passed: buy, sell, portfolio, launch, fee dashboard, research, search, mobile layout; no page errors.',
  );
} finally {
  await browser?.close();
  child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
  await rm(temp, { recursive: true, force: true });
}
