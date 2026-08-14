const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRequire = createRequire(path.join(repoRoot, 'web', 'package.json'));
const { chromium } = webRequire('playwright');

const outputDir = path.join(__dirname, 'screenshots');
const baseUrl = 'https://horizon-zeldcraft.vercel.app';

const viewports = [
  { suffix: 'square', viewport: { width: 1080, height: 1080 } },
  { suffix: 'landscape', viewport: { width: 1920, height: 1080 } },
];

const scenes = [
  {
    slug: '01-welcome-screen',
    action: async () => {},
  },
  {
    slug: '02-language-switcher-en',
    action: async (page) => {
      await page.locator('select').first().selectOption('en');
      await page.waitForTimeout(1200);
    },
  },
  {
    slug: '03-demo-access-modal',
    action: async (page) => {
      await page.getByRole('button', { name: /accès démo|demo access/i }).click();
      await page.waitForTimeout(1200);
    },
  },
  {
    slug: '04-play-without-wallet-modal',
    action: async (page) => {
      await page.getByRole('button', { name: /jouer sans portefeuille|play without a wallet/i }).click();
      await page.waitForTimeout(1200);
    },
  },
  {
    slug: '05-administration-panel',
    action: async (page) => {
      await page.getByText('Administration').first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
    },
  },
];

async function loadHome(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);
}

async function captureScene(browser, scene, variant) {
  const context = await browser.newContext({
    viewport: variant.viewport,
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await loadHome(page);
  await scene.action(page);

  const fileName = `${scene.slug}-${variant.suffix}.png`;
  const targetPath = path.join(outputDir, fileName);

  await page.screenshot({
    path: targetPath,
    type: 'png',
  });

  console.log(`Saved ${fileName}`);
  await context.close();
}

async function captureFullPage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await loadHome(page);

  const fileName = '00-full-page-home-landscape.png';
  const targetPath = path.join(outputDir, fileName);

  await page.screenshot({
    path: targetPath,
    type: 'png',
    fullPage: true,
  });

  console.log(`Saved ${fileName}`);
  await context.close();
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    for (const scene of scenes) {
      for (const variant of viewports) {
        await captureScene(browser, scene, variant);
      }
    }

    await captureFullPage(browser);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
