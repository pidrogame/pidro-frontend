import type { Page } from '@playwright/test';
import { Screen } from './screen';
import { SettingsScreen } from './settings-screen';

export class ProfileScreen extends Screen {
  constructor(page: Page) {
    super(page, 'profile-screen');
  }

  /** One number of the record, where Classic and Pidro games add up. */
  stat(label: string) {
    return this.root.getByTestId('profile-record').getByLabel(`${label}: `);
  }

  /** Opens the save sheet from the profile. */
  async saveYourProgress() {
    await this.button('Save your progress').click();
  }

  /** The "Old Pidro" chip a Classic player wears under their name. */
  get classicChip() {
    return this.root.getByTestId('profile-classic-chip');
  }

  /** Opens the badge sheet from the Classic chip. */
  async openBadges() {
    await this.classicChip.click();
    const sheet = this.page.getByTestId('badge-sheet');
    await sheet.waitFor();
    return sheet;
  }

  /** Sign out and Delete account live in Settings, behind "Account and sign-in". */
  async openAccount() {
    // The row's title: Blocked players is a link of its own inside the row (PID-339).
    await this.button('Account and sign-in')
      .getByText('Account and sign-in', { exact: true })
      .click();
    const settings = new SettingsScreen(this.page);
    await settings.root.waitFor();
    return settings;
  }

  async signOut() {
    await (await this.openAccount()).signOut();
  }
}
