import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class ResetPasswordScreen extends Screen {
  constructor(page: Page) {
    super(page, 'reset-password-screen');
  }

  get newPassword() {
    return this.field('New password');
  }

  async setNewPassword(password: string) {
    await this.newPassword.fill(password);
    await this.button('Set new password').click();
  }
}
