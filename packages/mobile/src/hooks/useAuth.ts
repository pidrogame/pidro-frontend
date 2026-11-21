import { useState, useCallback, useRef } from 'react';
import { AxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth';
import * as authApi from '@/api/auth';
import {
  clearGuestCreationToken,
  getGuestCreationToken,
  getInstallId,
} from '@/features/invites/installId';
import { invitePlatform } from '@/features/invites/platform';
import type { SocialCredentialResult } from '@/features/auth/socialCredentials';
import { requestNativeSocialCredential } from '@/features/auth/socialProviders';
import type { AuthProvider, PasswordLoginResponse, ProviderLoginResponse } from '@/api/auth';
import { signingInWith } from '@/features/auth/knownPlayer';
import { guestSaveFailure, runGuestSave, type GuestSaveResult } from '@/features/auth/saveGuest';
import { storedAgeTerms } from '@/features/onboarding/ageTerms';
import { queueLinkedFriend } from '@/stores/friends';
import { pendingFriendSlug } from '@/stores/pendingFriendLink';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';
import { useTranslation, type TranslationKey, type TranslationValues } from '@/i18n';

export type { GuestSaveField, GuestSaveFailure, GuestSaveResult } from '@/features/auth/saveGuest';

type AuthFailure = { cause?: unknown; key: TranslationKey; values?: TranslationValues };

export type PasswordSignInOutcome = PasswordLoginResponse | { status: 'failure'; code?: string };

export type SocialSignInOutcome =
  ProviderLoginResponse | Extract<SocialCredentialResult, { status: 'cancelled' | 'failure' }>;

function getSafeAxiosErrorDetails(error: AxiosError) {
  const { baseURL, method, url } = error.config ?? {};

  return {
    message: error.message,
    code: error.code,
    status: error.response?.status,
    method: method?.toUpperCase(),
    url: `${baseURL ?? ''}${url ?? ''}` || undefined,
  };
}

export function useAuth() {
  const { t } = useTranslation();
  const { status, user, setSession, clearSession, hydrated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setError] = useState<AuthFailure | null>(null);
  const error = failure
    ? failure.cause === undefined
      ? t(failure.key, failure.values)
      : localizedError(failure.cause, failure.key)
    : null;
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const requestInFlight = useRef(false);

  const signIn = useCallback(
    async (username: string, password: string): Promise<PasswordSignInOutcome | null> => {
      if (requestInFlight.current) return null;
      requestInFlight.current = true;

      try {
        setIsLoading(true);
        setError(null);
        // With the install, a name and password only the old Pidro knows find that account.
        const installId = await getInstallId().catch(() => undefined);
        const answer = await authApi.passwordLogin(username, password, installId, storedAgeTerms());
        if (answer.status === 'signed_in') {
          signingInWith('password');
          setSession({
            accessToken: answer.session.token,
            user: answer.session.user,
          });
        }
        return answer;
      } catch (e) {
        if (e instanceof AxiosError) {
          console.warn('[Auth] Sign in request failed:', getSafeAxiosErrorDetails(e));
        } else {
          console.warn('[Auth] Sign in failed with a non-API error');
        }
        setError({ cause: e, key: 'auth.login_failed' });
        return { status: 'failure', code: apiErrorInfo(e).code };
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession]
  );

  const signInWithProvider = useCallback(
    async (provider: AuthProvider): Promise<SocialSignInOutcome> => {
      if (requestInFlight.current) {
        return { status: 'cancelled', provider };
      }
      requestInFlight.current = true;

      try {
        setIsLoading(true);
        setError(null);
        const credential = await requestNativeSocialCredential(provider);
        if (credential.status === 'cancelled') return credential;
        if (credential.status === 'failure') {
          setError({
            key: credential.messageKey ?? 'auth.social_failed',
            values: { provider: provider === 'apple' ? 'Apple' : 'Facebook' },
          });
          return credential;
        }

        const installId = await getInstallId();
        const outcome = await authApi.providerLogin(
          provider,
          credential.provider === 'apple'
            ? {
                type: 'identity_token',
                token: credential.token,
                authorizationCode: credential.authorizationCode,
              }
            : credential.credential,
          installId,
          { ...storedAgeTerms(), ...pendingFriendSlug() }
        );
        if (outcome.status === 'signed_in') {
          signingInWith(provider);
          setSession({
            accessToken: outcome.session.token,
            user: outcome.session.user,
          });
          queueLinkedFriend(outcome.session.linked_friend);
        }
        return outcome;
      } catch (e) {
        if (e instanceof AxiosError) {
          console.warn('[Auth] Provider sign in request failed:', getSafeAxiosErrorDetails(e));
        } else {
          console.warn('[Auth] Provider sign in failed before reaching the API');
        }
        const failure = {
          status: 'failure' as const,
          provider,
          message: localizedError(e, 'auth.login_failed'),
          messageKey: 'auth.login_failed' as const,
        };
        setError({ cause: e, key: 'auth.login_failed' });
        return failure;
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession]
  );

  // Registration for the pick-your-name step: the same field-level answers as
  // saving a guest, so a taken name or email lands on the right step.
  const createAccount = useCallback(
    async (displayName: string, email: string, password: string): Promise<GuestSaveResult> => {
      if (requestInFlight.current) {
        return {
          ok: false,
          error: { message: t('auth.account_busy'), messageKey: 'auth.account_busy' },
        };
      }
      requestInFlight.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const response = await authApi.register(displayName, email, password, {
          ...storedAgeTerms(),
          ...pendingFriendSlug(),
        });
        signingInWith('password');
        setSession({ accessToken: response.token, user: response.user });
        queueLinkedFriend(response.linked_friend);
        return { ok: true };
      } catch (e) {
        if (e instanceof AxiosError) {
          console.warn('[Auth] Account creation request failed:', getSafeAxiosErrorDetails(e));
        }
        return { ok: false, error: guestSaveFailure(e) };
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession, t]
  );

  const saveGuest = useCallback(
    async (displayName: string, email: string, password: string): Promise<GuestSaveResult> => {
      if (requestInFlight.current) {
        return {
          ok: false,
          error: { message: t('auth.account_busy'), messageKey: 'auth.account_busy' },
        };
      }
      const original = useAuthStore.getState();
      requestInFlight.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const result = await runGuestSave({
          original,
          displayName,
          email,
          password,
          upgrade: (name, accountEmail, accountPassword) =>
            authApi.upgradeGuest(name, accountEmail, accountPassword, {
              ...storedAgeTerms(),
              ...pendingFriendSlug(),
            }),
          login: (identifier, accountPassword) =>
            authApi.login(identifier, accountPassword, storedAgeTerms()),
          getSession: useAuthStore.getState,
          install: (response) => {
            signingInWith('password');
            setSession({ accessToken: response.token, user: response.user });
            queueLinkedFriend(response.linked_friend);
          },
          setSessionPreservation: (preserve) =>
            useAuthStore.getState().setPreserveSessionOnUnauthorized(preserve),
        });
        if (!result.ok)
          setError({
            cause: result.error.originalError,
            key: result.error.messageKey ?? 'auth.save_failed',
          });
        return result;
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession, t]
  );

  const continueAsGuest = useCallback(
    async (displayName?: string) => {
      if (requestInFlight.current) return null;
      requestInFlight.current = true;

      try {
        setIsLoading(true);
        setError(null);
        const [creationToken, installId] = await Promise.all([
          getGuestCreationToken(),
          getInstallId().catch(() => undefined),
        ]);
        const response = await authApi.createGuest({
          ...(displayName ? { display_name: displayName } : {}),
          creation_token: creationToken,
          platform: invitePlatform(),
          ...(installId ? { install_id: installId } : {}),
          ...storedAgeTerms(),
        });
        setSession({ accessToken: response.token, user: response.user });
        await clearGuestCreationToken().catch(() => undefined);
        return response;
      } catch (e) {
        if (e instanceof AxiosError) {
          console.warn('[Auth] Guest creation request failed:', getSafeAxiosErrorDetails(e));
        } else {
          console.warn('[Auth] Guest creation failed with a non-API error');
        }
        setError({ cause: e, key: 'invite.error.guest' });
        return null;
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession]
  );

  const requestPasswordReset = useCallback(async (identifier: string) => {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    try {
      setIsLoading(true);
      setError(null);
      await authApi.requestPasswordReset(identifier);
      return true;
    } catch (e) {
      setError({ cause: e, key: 'auth.reset_request_failed' });
      return false;
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }, []);

  const resetPassword = useCallback(
    async (token: string, password: string) => {
      if (requestInFlight.current) return false;
      requestInFlight.current = true;
      try {
        setIsLoading(true);
        setError(null);
        const response = await authApi.resetPassword(token, password);
        signingInWith('password');
        setSession({ accessToken: response.token, user: response.user });
        return true;
      } catch (e) {
        setError({ cause: e, key: 'auth.reset_failed' });
        setErrorCode(apiErrorInfo(e).code);
        return false;
      } finally {
        requestInFlight.current = false;
        setIsLoading(false);
      }
    },
    [setSession]
  );

  const signOut = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(undefined);
  }, []);

  return {
    user,
    status,
    isLoading,
    error,
    errorCode,
    isAuthenticated: status === 'authenticated',
    isHydrated: hydrated,
    signIn,
    signInWithProvider,
    createAccount,
    saveGuest,
    continueAsGuest,
    requestPasswordReset,
    resetPassword,
    signOut,
    clearError,
  };
}
