import type { Page } from '@playwright/test';
import { Screen } from './screen';

export class AgeScreen extends Screen {
  constructor(page: Page) {
    super(page, 'age-screen');
  }

  get continueButton() {
    return this.button('Continue');
  }

  choose(band: '18 or older' | 'Under 13') {
    return this.root.getByRole('radio', { name: band }).click();
  }

  get chosen() {
    return this.root
      .getByRole('radiogroup', { name: 'Age range' })
      .getByRole('radio', { checked: true });
  }
}
