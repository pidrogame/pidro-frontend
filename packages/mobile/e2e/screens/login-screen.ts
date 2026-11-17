import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class LoginScreen extends Screen {
  constructor(page: Page) {
    super(page, 'login-screen');
  }

  get identifier() {
    return this.field('Username or email');
  }

  get forgotPassword() {
    return this.text('Forgot password?');
  }

  async signIn(identifier: string, password: string) {
    await this.identifier.fill(identifier);
    await this.field('Password').fill(password);
    await this.button('Sign in').click();
  }

  // A guest signing in to an account is asked before the guest is left behind.
  get switchPlayers() {
    return this.page.getByText('Switch players?');
  }

  cancelSwitch() {
    return this.page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  switchAccount() {
    return this.page.getByRole('button', { name: 'Switch account', exact: true }).click();
  }
}
