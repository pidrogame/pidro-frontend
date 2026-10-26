import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class HomeScreen extends Screen {
  constructor(page: Page) {
    super(page, 'home-screen');
  }

  get playOnline() {
    return this.root.getByTestId('home-play-online');
  }

  get signIn() {
    return this.root.getByRole('link', { name: 'Sign in' });
  }

  get classicPlaque() {
    return this.text(/Already play Pidro\?/i);
  }
}
