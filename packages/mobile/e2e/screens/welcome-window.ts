import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class WelcomeWindow extends Screen {
  constructor(page: Page) {
    super(page, 'welcome-window');
  }

  get haveAccount() {
    return this.root.getByTestId('welcome-have-account');
  }

  get quickGame() {
    return this.root.getByTestId('welcome-quick-game');
  }

  get createAccount() {
    return this.root.getByRole('link', { name: 'Create a free account', exact: true });
  }
}
