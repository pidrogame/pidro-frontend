import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class ForgotPasswordScreen extends Screen {
  constructor(page: Page) {
    super(page, 'forgot-password-screen');
  }

  get identifier() {
    return this.field('Username or email');
  }

  async requestLink() {
    await this.button('Email me a link').click();
    await this.text('Check your email').waitFor();
  }
}
