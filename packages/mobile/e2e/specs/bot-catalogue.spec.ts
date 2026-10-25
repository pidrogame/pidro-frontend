import { test, expect } from '../fixtures';

test('catalogue metadata arriving after a snapshot updates the bot at the table', async ({
  page,
}) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/bots', async (route) => {
    await ready;
    await route.fulfill({
      json: {
        data: [
          {
            id: 'antti',
            name: 'Catalogue Antti',
            description: '',
            avatar_url: 'http://localhost:4000/images/bots/antti.svg',
          },
        ],
      },
    });
  });
  // Game over against bots shows no rematch row (PID-292), so the seat says who it is.
  await page.goto('/table-dev?fixture=bot-crew');
  await expect(page.getByRole('button', { name: /^View Antti’s profile/ })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: /^View Catalogue Antti’s profile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^View Antti’s profile/ })).toHaveCount(0);
});
