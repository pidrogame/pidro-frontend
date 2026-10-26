import { test, expect } from '@playwright/test';

test('language choices apply immediately, persist and keep keyboard focus @responsive', async ({
  page,
}) => {
  // Real signed-out settings: fixture overrides must never stand in for persistence.
  await page.addInitScript(() => {
    localStorage.setItem(
      'age-gate-storage',
      JSON.stringify({
        state: { ageBand: '18_plus', termsVersion: '1' },
        version: 0,
      })
    );
    localStorage.setItem('news-seen:welcome', '1');
  });
  await page.goto('/device-settings');
  const swedish = page.getByRole('radio', { name: 'Svenska', exact: true });
  await swedish.click();
  await expect(page.getByRole('radiogroup', { name: 'Språk', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(swedish).toHaveAttribute('aria-checked', 'true');
  await expect(swedish).toBeFocused();
  await expect(page.getByRole('switch', { name: 'Ljud', exact: true })).toBeVisible();
  await expect(page.getByText('På', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Just nu:', { exact: false })).toHaveCount(0);

  const languageChoices = page.getByTestId('settings-language').getByRole('radio');
  for (const radio of await page.getByRole('radio').all()) {
    const box = await radio.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  await expect(page.getByRole('radio', { name: 'English', exact: true })).toHaveAttribute(
    'lang',
    'en'
  );
  await expect(swedish).toHaveAttribute('lang', 'sv');
  await page.reload();
  await expect(swedish).toHaveAttribute('aria-checked', 'true');

  await swedish.focus();
  await page.keyboard.press('ArrowLeft');
  const english = page.getByRole('radio', { name: 'English', exact: true });
  await expect(english).toHaveAttribute('aria-checked', 'true');
  await expect(english).toBeFocused();
  await expect(page.getByRole('switch', { name: 'Sound', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('ArrowLeft');
  const system = page.getByRole('radio', { name: 'System language', exact: true });
  await expect(system).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Currently: English', { exact: true })).toBeVisible();
  await expect(system).toBeFocused();
  await page.keyboard.press('Space');
  await expect(system).toHaveAttribute('aria-checked', 'true');
  expect(
    await languageChoices.evaluateAll(
      (nodes) => nodes.filter((node) => node.getAttribute('tabindex') === '0').length
    )
  ).toBe(1);
});
