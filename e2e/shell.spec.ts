import { expect, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

type CspWindow = Window & { __cspViolations?: string[] };

test.describe('app shell (production build, production headers)', () => {
  test.use({ colorScheme: 'dark' });

  test('loads with the strict CSP, no external requests and no errors (SEC-1, SEC-2)', async ({
    page,
  }) => {
    const external: string[] = [];
    const errors: string[] = [];

    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== ORIGIN) {
        external.push(request.url());
      }
    });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const w = window as CspWindow;
      w.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        w.__cspViolations?.push(
          `${event.violatedDirective} ${event.blockedURI} ${event.sample} @${event.sourceFile}:${String(event.lineNumber)}`,
        );
      });
    });

    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');

    await expect(page).toHaveTitle('Media Studio');
    await expect(page.getByRole('heading', { level: 1, name: 'Media Studio' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Start a project' })).toBeVisible();

    // Exercise more of the app under the CSP: dialog, tabs, workspace route.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/#/image');
    await expect(page.getByRole('heading', { name: 'Image workspace' })).toBeVisible();

    const violations = await page.evaluate(() => (window as CspWindow).__cspViolations ?? []);
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('theme switch changes the tokens app-wide and persists (PLAT-5)', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await background();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await background()).not.toBe(dark);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => window.localStorage.getItem('ms-theme'))).toBe('light');
  });

  test("Tailwind's default palette is removed so raw colours cannot exist", async ({ page }) => {
    await page.goto('/');
    const leaked = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ['--color-red-500', '--color-blue-500', '--color-gray-500'].filter(
        (name) => style.getPropertyValue(name) !== '',
      );
    });
    expect(leaked).toEqual([]);
  });
});

test.describe('theme defaults', () => {
  test.use({ colorScheme: 'light' });

  test('follows the OS light preference when nothing is stored', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
