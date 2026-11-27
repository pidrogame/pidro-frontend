import { test, expect } from '@playwright/test';

test('a new player chooses language on Age and Marcel’s note, and Settings remembers', async ({
  page,
}) => {
  await page.goto('/');
  const age = page.getByTestId('age-screen');
  await expect(age).toBeVisible({ timeout: 30_000 });
  const switcher = page.getByTestId('language-switch');
  await expect(switcher.getByRole('radio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  // A new install saves the device's language once: Chromium here is en-US.
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settings-storage')!).state.language)
  ).toBe('en');
  await age.getByRole('radio', { name: '18 or older', exact: true }).click();
  await switcher.getByRole('radio', { name: 'Svenska' }).click();
  await expect(age.getByRole('radio', { name: '18 eller äldre', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.reload();
  await expect(switcher.getByRole('radio', { name: 'Svenska' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await switcher.getByRole('radio', { name: 'Svenska' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(switcher.getByRole('radio', { name: 'English' })).toBeFocused();
  await age.getByRole('radio', { name: '18 or older', exact: true }).click();
  await age.getByRole('button', { name: 'Continue', exact: true }).click();

  const note = page.getByTestId('welcome-sheet');
  await expect(note).toBeVisible();
  await switcher.getByRole('radio', { name: 'Svenska' }).click();
  await expect(note.getByText('Välkommen till nya Pidro', { exact: true })).toBeVisible();
  await note.getByRole('button', { name: 'Nu spelar vi', exact: true }).click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('welcome-window')).toBeVisible();
  await expect(note).toHaveCount(0);
  await page.goto('/device-settings');
  const language = page.getByTestId('settings-language');
  await expect(language.getByRole('radio', { name: 'Svenska' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(language.getByRole('radio')).toHaveCount(2);
});
