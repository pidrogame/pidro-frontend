import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class WelcomeWindow extends Screen {
  constructor(page: Page) {
    super(page, 'welcome-window');
  }

  get quickGame() {
    return this.root.getByTestId('welcome-quick-game');
  }

  get playOnline() {
    return this.root.getByTestId('welcome-play-online');
  }

  get classicPlaque() {
    return this.text(/Already play Pidro\?/i);
  }
}
