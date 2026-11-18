import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { RegisterScreen } from '../screens/register-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { api, register } from '../support/api';
import { newPlayer } from '../support/player';

test("PID-247: signing up through someone's link sends them a friend request they answer with one tap", async ({
  page,
  player,
}) => {
  const bertilPlayer = newPlayer();
  const bertil = (await register(bertilPlayer)) as Awaited<ReturnType<typeof register>> & {
    user: { share_slug: string };
  };
  expect(bertil.user.share_slug).toBeTruthy();

  // As the deferred answer leaves it on first open: Bertil's link, held until an account.
  await page.addInitScript(
    (pendingFriendLink) =>
      localStorage.setItem(
        'pending-friend-link-storage',
        JSON.stringify({ state: { pendingFriendLink }, version: 0 })
      ),
    { slug: bertil.user.share_slug, displayName: bertilPlayer.name, receivedAt: Date.now() }
  );
  await page.goto('/');
  await new WelcomeWindow(page).createAccount.click({ timeout: 30_000 });
  const registered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/auth/register'
  );
  await new RegisterScreen(page).createAccount(player);
  const response = await registered;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    friend_slug: bertil.user.share_slug,
  });
  const { data } = await response.json();
  expect(data.linked_friend).toMatchObject({ user_id: bertil.user.id });

  await expect(new HomeScreen(page).root).toBeVisible();
  await expect(page.getByTestId('friend-notice')).toContainText(
    `Request sent. You’ll be friends once ${bertilPlayer.name} accepts.`
  );

  const lists = async (token: string) => (await api('/api/v1/friends', { token })).payload.data;
  const ids = (players: { user_id: string }[]) => players.map((p) => p.user_id);
  const mine = await lists(data.token);
  expect(ids(mine.friends)).toEqual([]);
  expect(ids(mine.requested)).toEqual([bertil.user.id]);
  const bertils = await lists(bertil.token);
  expect(ids(bertils.friends)).toEqual([]);
  expect(ids(bertils.added_you)).toEqual([data.user.id]);

  // Bertil accepts, and the new player hears it even after the link's own notice.
  await api(`/api/v1/friends/${data.user.id}`, { method: 'PUT', token: bertil.token });
  await expect(page.getByTestId('friend-notice')).toContainText(
    `${bertilPlayer.name} accepted. You’re friends now.`
  );
  expect(ids((await lists(data.token)).friends)).toEqual([bertil.user.id]);

  // The link has done its work: it is not sent again.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('pending-friend-link-storage') ?? 'null')?.state
            ?.pendingFriendLink ?? null
      )
    )
    .toBeNull();
});
