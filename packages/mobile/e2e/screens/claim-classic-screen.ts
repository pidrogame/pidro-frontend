import type { Page } from '@playwright/test';
import { Screen } from './screen';

type NewAccount = { username: string | null; email: string | null } | null;

export class ClaimClassicScreen extends Screen {
  /** The Classic login the last verify offered the new account (`new_account`), if any. */
  private offered: Promise<NewAccount> = Promise.resolve(null);

  constructor(page: Page) {
    super(page, 'claim-classic-screen');
  }

  get found() {
    return this.text('Is this you?');
  }

  /** A figure on the preview, e.g. "games". */
  stat(label: string) {
    return this.root.getByLabel(`${label}: `);
  }

  /** A login value the claim keeps from Classic, shown but not editable. */
  kept(label: string, value: string) {
    return this.root.getByLabel(`${label}: ${value}`, { exact: true });
  }

  async verify(login: string, password: string) {
    await this.root.waitFor();
    if (!(await this.field('Username or email').isVisible())) {
      await this.button('Username and password').click();
    }
    await this.field('Username or email').fill(login);
    await this.field('Password').fill(password);
    const answered = this.page.waitForResponse((response) =>
      response.url().includes('/api/v1/classic/verify')
    );
    this.offered = answered.then(async (response) =>
      response.ok() ? ((await response.json()).data.classic.new_account ?? null) : null
    );
    await this.button('Find my account').click();
    return answered;
  }

  /** Explicitly accepts the preview, opening details or claiming directly. */
  async confirmIdentity() {
    await this.button("Yes, that's me").click();
  }

  /** What the last verify offered from Classic; null from a server that offers nothing. */
  newAccount() {
    return this.offered;
  }

  /**
   * Fills what a password claim asks for: the username and email only where the
   * server did not offer the Classic ones. Returns the login the account gets.
   */
  async fillLogin(account: { username?: string; email: string; password: string }) {
    const offered = await this.offered;
    if (account.username && (await this.field('Username').isVisible())) {
      await this.field('Username').fill(account.username);
    }
    if (await this.field('Email').isVisible()) await this.field('Email').fill(account.email);
    await this.field('New password').fill(account.password);
    return {
      username: offered?.username ?? account.username,
      email: offered?.email ?? account.email,
    };
  }

  /** The "create your account" form a claim with nobody signed in asks for. */
  async createAccountAndClaim(account: { username: string; email: string; password: string }) {
    const login = await this.fillLogin(account);
    await this.button('Save and play').click();
    return login;
  }
}
