import { expect, test } from './fixtures';

/**
 * The match analysis panel is gated twice over: the viewer must own the log
 * (same check `Notes` uses) and must pass `isPremiumUser`, which today resolves
 * to a hardcoded admin list. The E2E user is neither an admin nor the owner of
 * an arbitrary log, so these specs assert the gate holds rather than driving the
 * generate flow.
 *
 * The rendered states — empty, success, stale, low grounding, rate limited,
 * double-click safety — are covered in `__tests__/ai/MatchAnalysis.test.tsx`,
 * which can mock the session and runs in CI without a browser.
 *
 * The analysis API is stubbed here so a stray request can never reach the model:
 * the E2E workflow has no AI_GATEWAY_API_KEY and must never need one.
 */
test.describe('battle log analysis gating', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/battle-logs/*/analysis', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'none',
          analysis: null,
          warnings: [],
          grounding: null,
          errorCode: null,
          stale: false,
        }),
      });
    });
  });

  test('does not render the analysis panel for a non-premium viewer', async ({ page }) => {
    await page.goto('/ptcg/logs');

    const firstLog = page.locator('a[href^="/ptcg/logs/"]').first();
    const hasLogs = await firstLog.isVisible().catch(() => false);
    test.skip(!hasLogs, 'test account has no battle logs to open');

    await firstLog.click();
    await page.waitForURL(/\/ptcg\/logs\/.+/);

    // The log body has rendered before we assert absence.
    await expect(page.locator('h2').first()).toBeVisible();
    await expect(page.getByTestId('match-analysis')).toHaveCount(0);
  });

  test('never calls the analysis API unprompted', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/analysis')) requests.push(request.method());
    });

    await page.goto('/ptcg/logs');
    await page.waitForLoadState('networkidle');

    expect(requests).toEqual([]);
  });
});
