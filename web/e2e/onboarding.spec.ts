import { test, expect, type Page } from '@playwright/test';

/**
 * The regression this exists for: a brand-new account with no calibration on
 * file clicks "Start" on the onboarding wizard and must land on a real C1 item.
 *
 * It previously failed silently — the button called the PCP-gated drill route,
 * got a 423, stashed the message in a store field nothing rendered, and left
 * the user staring at the same screen. An HTTP-level assertion on that route
 * returning 200 would not have caught it, so this drives the actual buttons.
 */

async function signUpFresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByPlaceholder('What should we call you?').fill('Fresh Candidate');
  const email = `fresh-${Date.now()}-${Math.floor(Math.random() * 1e6)}@forge.test`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('fresh-pass-123');
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('onboarding for a fresh, uncalibrated account', () => {
  test('Start reaches the first live C1 item', async ({ page }) => {
    // Any request the UI makes to the retired candidate-scoped surface is a
    // failure in its own right, so watch for it across the whole flow.
    const legacyCalls: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/candidates/')) legacyCalls.push(url.pathname);
    });

    await signUpFresh(page);

    // Uncalibrated accounts are routed into onboarding, not the dashboard.
    await expect(page.getByText('Let’s set up your profile')).toBeVisible();

    await page.getByRole('button', { name: 'Get started' }).click();

    // The step card must offer a Start button that is actually clickable.
    const start = page.getByRole('button', { name: 'Start' });
    await expect(start).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();

    // A real C1 item, not a status screen. C1 draws band-gated slot items, so
    // the card shows the frame, the swapped condition, and a 1-of-N counter.
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible({ timeout: 15_000 });

    const probe = await page.request.get('/api/calibration');
    expect(probe.ok()).toBe(true);

    // The item must be answerable. Address it by its accessible name, not a
    // CSS selector, so the test does not depend on how Input is built.
    const answer = page.getByLabel('Your answer');
    await expect(answer).toBeVisible();
    await answer.fill('anchor');
    await answer.press('Enter');

    // Advancing proves the item was live and wired to the run loop.
    await expect(page.getByText(/^2 of \d+$/)).toBeVisible({ timeout: 15_000 });

    expect(legacyCalls, `frontend still called ${legacyCalls.join(', ')}`).toEqual([]);
  });

  test('a failed probe surfaces an error instead of failing silently', async ({ page }) => {
    await signUpFresh(page);
    await expect(page.getByText('Let’s set up your profile')).toBeVisible();
    await page.getByRole('button', { name: 'Get started' }).click();

    // Break only the probe call, leaving the page otherwise healthy.
    await page.route('**/api/calibration/probe**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'probe unavailable' }),
      }),
    );

    await page.getByRole('button', { name: 'Start' }).click();

    // The old bug: this text never appeared, so the click looked inert.
    await expect(page.getByRole('alert')).toContainText('probe unavailable');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
