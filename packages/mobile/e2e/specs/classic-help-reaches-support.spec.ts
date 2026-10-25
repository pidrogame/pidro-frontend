import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { supportMailAbout } from '../support/mailbox';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ClassicForgotScreen } from '../screens/classic-forgot-screen';
import { ClassicHelpScreen } from '../screens/classic-help-screen';

async function openHelp(page: Page, login: string) {
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.button('Username and password').click();
  await claim.field('Username or email').fill(login);
  await claim.text('Forgot your password?').click();
  const forgot = new ClassicForgotScreen(page);
  await forgot.getHelp.click();
  const help = new ClassicHelpScreen(page);
  await expect(help.root).toBeVisible();
  await expect(help.name).toHaveValue(login);
  return help;
}

test('a Classic player who cannot sign in asks for help and support receives it', async ({
  page,
  player,
}) => {
  const help = await openHelp(page, player.classicLogin);
  await help.email.fill(player.email);
  await help.button('Send to support').click();
  await expect(help.text('Message sent')).toBeVisible();

  const mail = await supportMailAbout(player.classicLogin);
  expect(JSON.stringify(mail.reply_to)).toContain(player.email);
  expect(mail.text_body).toContain(player.classicLogin);
});

test('the help form catches what it can and puts the server’s refusal on the field', async ({
  page,
  player,
}) => {
  let sent = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/classic/help')) sent += 1;
  });
  const help = await openHelp(page, player.classicLogin);
  // A field's error is the form's only alert: no general notice beside it.
  const alerts = help.root.getByRole('alert');

  await help.name.fill('');
  await help.button('Send to support').click();
  await expect(alerts).toHaveText([
    'Enter the name you played as.',
    'Enter an email we can reply to.',
  ]);
  await help.name.fill(player.classicLogin);
  await help.button('Send to support').click();
  await expect(alerts).toHaveText(['Enter an email we can reply to.']);
  await help.email.fill('not-an-email');
  await help.button('Send to support').click();
  await expect(alerts).toHaveText(['Check that email address.']);
  expect(sent).toBe(0);

  // Looks like an address, but mail cannot be sent to it: the server says so with a 422.
  await help.email.fill('a,b@example.com');
  const answered = page.waitForResponse((response) =>
    response.url().includes('/api/v1/classic/help')
  );
  await help.button('Send to support').click();
  expect((await answered).status()).toBe(422);
  await expect(alerts).toHaveText(['Check that email address.']);
  await expect(help.email).toHaveValue('a,b@example.com');
  await expect(help.text('Almost there')).toBeHidden();

  await help.email.fill(player.email);
  await help.button('Send to support').click();
  await expect(help.text('Message sent')).toBeVisible();
});

test.describe('support unavailable', () => {
  test.use({ unavailableExpected: true });

  test('when support cannot be reached the player gets a mail draft instead', async ({
    page,
    player,
  }) => {
    await page.route('**/api/v1/classic/help', (route) => route.fulfill({ status: 503 }));
    const help = await openHelp(page, player.classicLogin);
    await help.email.fill(player.email);
    await help.button('Send to support').click();
    await expect(help.text('Almost there')).toBeVisible();
  });
});
