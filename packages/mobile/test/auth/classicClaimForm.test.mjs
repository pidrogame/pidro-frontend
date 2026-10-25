import { describe, expect, it } from 'bun:test';
import {
  claimAccount,
  claimForm,
  claimNeedsDetails,
  refusedLogin,
} from '../../src/features/auth/classicClaimForm';

const typed = {
  username: ' typedname ',
  email: ' typed@example.com ',
  password: 'new-pidro-pass',
  displayName: ' Polite ',
};
const offered = { username: 'tiger', email: 'sonja@example.com' };
const sent = (form, nameAllowed = true) => claimAccount(form, typed, nameAllowed);

describe('what a Classic claim asks for and sends', () => {
  it('only skips details when every required value is already known', () => {
    for (const method of ['password', 'apple', 'facebook']) {
      for (const user of [null, { guest: true }, { guest: false }]) {
        for (const refused of [[], ['username'], ['email']]) {
          const form = claimForm({ method, user, newAccount: offered, refused });
          const expected = !user || (user.guest && method === 'password');
          expect(claimNeedsDetails(form, true)).toBe(expected);
          expect(claimNeedsDetails(form, false)).toBe(true);
        }
      }
    }
  });

  it('signed out with both offered: shows the Classic login and asks only for a password', () => {
    const form = claimForm({ method: 'password', user: null, newAccount: offered });
    expect(form).toEqual({
      asks: { username: false, email: false, password: true },
      kept: offered,
      fromClassic: true,
    });
    expect(sent(form)).toEqual({ password: 'new-pidro-pass' });
  });

  it('a guest with both offered sends only the password', () => {
    const form = claimForm({ method: 'password', user: { guest: true }, newAccount: offered });
    expect(form.asks).toEqual({ username: false, email: false, password: true });
    expect(form.kept).toEqual(offered);
    expect(sent(form)).toEqual({ password: 'new-pidro-pass' });
  });

  it('asks for the username when Classic could not offer one', () => {
    const form = claimForm({
      method: 'password',
      user: null,
      newAccount: { username: null, email: 'sonja@example.com' },
    });
    expect(form.asks).toEqual({ username: true, email: false, password: true });
    expect(form.kept).toEqual({ email: 'sonja@example.com' });
    expect(sent(form)).toEqual({ username: 'typedname', password: 'new-pidro-pass' });
  });

  it('a guest keeps their own username when Classic offers none', () => {
    const form = claimForm({
      method: 'password',
      user: { guest: true },
      newAccount: { username: null, email: 'sonja@example.com' },
    });
    expect(sent(form)).toEqual({ password: 'new-pidro-pass' });
  });

  it('asks for the email when Classic could not offer one', () => {
    const form = claimForm({
      method: 'password',
      user: null,
      newAccount: { username: 'tiger', email: null },
    });
    expect(form.asks).toEqual({ username: false, email: true, password: true });
    expect(form.kept).toEqual({ username: 'tiger' });
    expect(sent(form)).toEqual({ email: 'typed@example.com', password: 'new-pidro-pass' });
  });

  it('still explains the new password when Classic offers neither', () => {
    const form = claimForm({
      method: 'password',
      user: null,
      newAccount: { username: null, email: null },
    });
    expect(form.fromClassic).toBe(true);
    expect(form.kept).toEqual({});
    expect(sent(form)).toEqual({
      username: 'typedname',
      email: 'typed@example.com',
      password: 'new-pidro-pass',
    });
  });

  it('against a server without new_account, asks for all three as before', () => {
    for (const newAccount of [undefined, null]) {
      const form = claimForm({ method: 'password', user: null, newAccount });
      expect(form).toEqual({
        asks: { username: true, email: true, password: true },
        kept: {},
        fromClassic: false,
      });
      expect(sent(form)).toEqual({
        username: 'typedname',
        email: 'typed@example.com',
        password: 'new-pidro-pass',
      });
    }
    const guest = claimForm({ method: 'password', user: { guest: true } });
    expect(sent(guest)).toEqual({ email: 'typed@example.com', password: 'new-pidro-pass' });
  });

  it('an Apple claim signed out asks only for a username, whatever the server offers', () => {
    const form = claimForm({ method: 'apple', user: null, newAccount: offered });
    expect(form).toEqual({
      asks: { username: true, email: false, password: false },
      kept: {},
      fromClassic: false,
    });
    expect(sent(form)).toEqual({ username: 'typedname' });
  });

  it('a signed-in player sends nothing but a replacement name', () => {
    for (const method of ['password', 'facebook']) {
      const form = claimForm({ method, user: { guest: false }, newAccount: offered });
      expect(form.asks).toEqual({ username: false, email: false, password: false });
      expect(form.kept).toEqual({});
      expect(sent(form)).toEqual({});
      expect(sent(form, false)).toEqual({ display_name: 'Polite' });
    }
  });

  it('turns an offered value taken since the preview into that one input', () => {
    const form = claimForm({ method: 'password', user: null, newAccount: offered });
    expect(refusedLogin(form, 'EMAIL_TAKEN')).toBe('email');
    expect(refusedLogin(form, 'email')).toBe('email');
    expect(refusedLogin(form, 'username')).toBe('username');
    expect(refusedLogin(form, 'password')).toBeNull();

    const retry = claimForm({
      method: 'password',
      user: null,
      newAccount: offered,
      refused: ['email'],
    });
    expect(retry.asks).toEqual({ username: false, email: true, password: true });
    expect(retry.kept).toEqual({ username: 'tiger' });
    expect(sent(retry)).toEqual({ email: 'typed@example.com', password: 'new-pidro-pass' });

    const guest = claimForm({
      method: 'password',
      user: { guest: true },
      newAccount: offered,
      refused: ['username'],
    });
    expect(sent(guest)).toEqual({ username: 'typedname', password: 'new-pidro-pass' });
  });

  it('leaves an email the player typed to the usual field error', () => {
    const form = claimForm({ method: 'password', user: null });
    expect(refusedLogin(form, 'EMAIL_TAKEN')).toBeNull();
    expect(refusedLogin(form, 'username')).toBeNull();
  });
});
