import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class ClassicForgotScreen extends Screen {
  constructor(page: Page) {
    super(page, 'classic-forgot-screen');
  }

  get login() {
    return this.field('Username or email');
  }

  get getHelp() {
    return this.text(/Don.t remember either\? Get help/);
  }
}
