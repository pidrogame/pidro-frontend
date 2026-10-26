import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import {
  classicApi,
  facebookCredentialRequest,
  type ClassicClaimMethod,
  type ClassicVerification,
} from '@/api/classic';
import * as authApi from '@/api/auth';
import { profileApi } from '@/api/profile';
import { AuthProviderButtons } from '@/components/auth/AuthProviderButtons';
import {
  AuthFlowButton,
  AuthFlowNotice,
  AuthFlowScreen,
  AuthFlowWindow,
  useAuthFlow,
} from '@/components/auth/AuthFlow';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroSpacing } from '@/design/tokens';
import { useFlowBack, useHardwareBack } from '@/hooks/useFlowBack';
import { getInstallId } from '@/features/invites/installId';
import { requestNativeSocialCredential } from '@/features/auth/socialProviders';
import { takePendingClassicClaim } from '@/features/auth/classicFound';
import { take } from '@/features/auth/pendingClassicVerification';
import {
  alreadyClaimedView,
  claimAccount,
  claimForm,
  claimNeedsDetails,
  refusedLogin,
  type LoginField,
} from '@/features/auth/classicClaimForm';
import { runGuestSave } from '@/features/auth/saveGuest';
import { storedAgeTerms } from '@/features/onboarding/ageTerms';
import { authenticatedEntryDestination } from '@/navigation/initialRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useAuthStore } from '@/stores/auth';
import { queueLinkedFriend } from '@/stores/friends';
import { pendingFriendSlug } from '@/stores/pendingFriendLink';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { apiErrorInfo } from '@/utils/apiErrors';
import { formatNumber, useTranslation, type TranslationKey } from '@/i18n';
import { localizedError } from '@pidro/shared';

// Ticket errors a retry can't fix: start over with a fresh verification.
const DEAD_TICKET_CODES = new Set([
  'CLAIM_TICKET_EXPIRED',
  'INVALID_CLAIM_TICKET',
  'CLAIM_TICKET_BINDING_MISMATCH',
]);

type Field = 'login' | 'classicPassword' | 'username' | 'email' | 'password' | 'displayName';
type Fixture =
  | 'method'
  | 'preview'
  | 'login'
  | 'password'
  | 'rename'
  | 'already-claimed'
  | 'already-claimed-apple'
  | 'details'
  | 'rename-details'
  | 'taken';

const FIXTURE_PREVIEW: ClassicVerification = {
  ticket: 'fixture-ticket',
  expires_at: '2099-01-01T00:00:00Z',
  classic: {
    name: 'ThunderThor88',
    games_played: 1284,
    level: 42,
    member_since: '2012-04-03T00:00:00Z',
    name_allowed: true,
    new_account: { username: 'ThunderThor88', email: 'sonja.lindqvist@example.com' },
  },
  already_claimed: null,
};

function memberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return String(date.getUTCFullYear());
}

export default function ClaimClassicScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { fixture: fixtureParam, from } = useLocalSearchParams<{
    fixture?: string;
    from?: string;
  }>();
  const fixture = (__DEV__ ? fixtureParam : undefined) as Fixture | undefined;
  const { layout, metrics, inputStyle } = useAuthFlow();
  const goBack = useFlowBack();
  const focused = useIsFocused();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const [providerHandoff] = useState(takePendingClassicClaim);
  const fixtureVerification = useMemo(() => {
    if (!fixture || fixture === 'method' || fixture === 'login') return null;
    return {
      ...FIXTURE_PREVIEW,
      classic: {
        ...FIXTURE_PREVIEW.classic,
        ...(fixture === 'rename' || fixture === 'rename-details'
          ? { name: 'Old Name', name_allowed: false }
          : {}),
        ...(fixture === 'details' || fixture === 'rename-details' ? { new_account: null } : {}),
      },
      ...(fixture === 'already-claimed'
        ? { already_claimed: { sign_in_method: 'password' as const } }
        : fixture === 'already-claimed-apple'
          ? { already_claimed: { sign_in_method: 'apple' as const } }
          : {}),
    };
  }, [fixture]);
  const [method, setMethod] = useState<ClassicClaimMethod | null>(
    providerHandoff?.method ?? (fixtureVerification || fixture === 'login' ? 'password' : null)
  );
  const [verification, setVerification] = useState<ClassicVerification | null>(
    providerHandoff?.verification ?? fixtureVerification
  );
  const [step, setStep] = useState<'check' | 'details'>(
    fixture && ['password', 'rename', 'details', 'rename-details', 'taken'].includes(fixture)
      ? 'details'
      : 'check'
  );
  const [login, setLogin] = useState('');
  // The Classic login the shown verification came from; a recovery or provider has none.
  const [verifiedLogin, setVerifiedLogin] = useState(
    fixture === 'already-claimed' ? 'ThunderThor88' : ''
  );
  const [guestGames, setGuestGames] = useState(fixture === 'already-claimed' ? 12 : 0);
  const [classicPassword, setClassicPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fields, setFields] = useState<Partial<Record<Field, string>>>(
    fixture === 'taken' ? { username: 'auth.name_taken', email: 'auth.email_taken' } : {}
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [requestFailure, setRequestFailure] = useState<{
    error: unknown;
    fallback: TranslationKey;
  } | null>(null);
  const [errorProvider, setErrorProvider] = useState('');
  const [canSignIn, setCanSignIn] = useState(false);
  const [refused, setRefused] = useState<LoginField[]>(
    fixture === 'taken' ? ['username', 'email'] : []
  );
  const alreadyClaimed = verification?.already_claimed ?? null;
  const claimed = alreadyClaimedView({ alreadyClaimed, user, guestGames, login: verifiedLogin });
  const guestId = user?.guest ? user.id : null;
  // A guest's password claim sets the email and password the account is recovered with.
  const guestCredentials = Boolean(user?.guest) && method === 'password';
  const form = useMemo(
    () => claimForm({ method, user, newAccount: verification?.classic.new_account, refused }),
    [method, refused, user, verification]
  );

  const clearField = useCallback((field: Field) => {
    setFields((current) => ({ ...current, [field]: undefined }));
    setError(null);
    setRequestFailure(null);
    setCanSignIn(false);
  }, []);

  // Only a guest who played loses something by signing in, so only they are told.
  useEffect(() => {
    if (fixture || !alreadyClaimed || !guestId) return;
    let active = true;
    profileApi
      .getIdentity()
      .then((identity) => {
        if (active && identity.user_id === guestId) setGuestGames(identity.games_played ?? 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [alreadyClaimed, fixture, guestId]);

  const signIn = useCallback(
    (email?: string) =>
      router.replace({ pathname: '/(auth)/login', params: email ? { email } : {} }),
    [router]
  );

  const finishVerification = useCallback(
    (result: ClassicVerification, nextMethod: ClassicClaimMethod, verifiedAs = '') => {
      setMethod(nextMethod);
      setVerification(result);
      setVerifiedLogin(verifiedAs);
      setGuestGames(0);
      setStep('check');
      setDisplayName(result.classic.name_allowed ? (result.classic.name ?? '') : '');
      setUsername('');
      setEmail('');
      setPassword('');
      setFields({});
      setCanSignIn(false);
      setRefused([]);
      setError(null);
      setRequestFailure(null);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      const recovered = take();
      if (!recovered) return;
      setFields({});
      setCanSignIn(false);
      finishVerification(recovered, 'password');
    }, [finishVerification])
  );

  const reportRequestError = useCallback(
    (requestError: unknown, fallback: TranslationKey, provider?: 'apple' | 'facebook') => {
      const info = apiErrorInfo(requestError);
      if (fallback === 'auth.classic_claim_failed') setStep('details');
      setError(null);
      setRequestFailure(null);
      setErrorProvider(provider === 'apple' ? 'Apple' : 'Facebook');
      // Signing in from here replaces a guest (the login screen says their games stay
      // behind), but never a saved account.
      setCanSignIn(
        (!user || Boolean(user.guest)) &&
          info.code === 'ALREADY_CLAIMED' &&
          info.action?.type === 'sign_in'
      );
      // An offered username or email taken since the preview becomes that one input.
      const taken = refusedLogin(form, info.code);
      if (taken === 'username') {
        setRefused((current) => [...current, taken]);
        setUsername(form.kept.username ?? '');
        setFields({ username: 'auth.name_taken' });
      } else if (taken === 'email') {
        setRefused((current) => [...current, taken]);
        setEmail(form.kept.email ?? '');
        setFields({ email: 'auth.email_taken' });
      } else if (info.code === 'PROVIDER_UNAVAILABLE') {
        setError('auth.provider_unavailable');
      } else if (DEAD_TICKET_CODES.has(info.code ?? '')) {
        setVerification(null);
        setStep('check');
        setError('auth.verification_invalid');
      } else if (provider && info.code === 'INVALID_CREDENTIALS') {
        setError('auth.classic_provider_missing');
      } else if (info.code === 'email' || info.code === 'EMAIL_TAKEN') {
        setFields({ email: 'auth.valid_email' });
      } else if (info.code === 'password') {
        setFields({ password: 'auth.password_min' });
      } else if (info.code === 'ALREADY_CLAIMED' && user) {
        setError('auth.classic_linked_other');
      } else {
        setRequestFailure({ error: requestError, fallback });
      }
    },
    [form, user]
  );

  const verifyPassword = useCallback(async () => {
    if (busy || fixture) return;
    const nextFields: Partial<Record<Field, string>> = {};
    if (!login.trim()) nextFields.login = 'auth.enter_classic_identifier';
    if (!classicPassword) nextFields.classicPassword = 'auth.enter_classic_password';
    setFields(nextFields);
    if (Object.keys(nextFields).length) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    setRequestFailure(null);
    try {
      const installId = user ? undefined : await getInstallId();
      const result = await classicApi.verify({
        method: 'password',
        login: login.trim(),
        password: classicPassword,
        install_id: installId,
      });
      finishVerification(result, 'password', login.trim());
    } catch (requestError) {
      reportRequestError(requestError, 'auth.classic_verify_failed');
    } finally {
      setBusy(false);
    }
  }, [busy, classicPassword, finishVerification, fixture, login, reportRequestError, user]);

  const verifyProvider = useCallback(
    async (provider: 'apple' | 'facebook') => {
      if (busy || fixture) return;
      setBusy(true);
      setError(null);
      setRequestFailure(null);
      try {
        const credential = await requestNativeSocialCredential(provider);
        if (credential.status === 'cancelled') return;
        if (credential.status === 'failure') {
          setError(credential.messageKey ?? 'auth.social_failed');
          setErrorProvider(provider === 'apple' ? 'Apple' : 'Facebook');
          return;
        }
        const installId = user ? undefined : await getInstallId();
        const result = await classicApi.verify(
          credential.provider === 'apple'
            ? { method: 'apple', identity_token: credential.token, install_id: installId }
            : {
                method: 'facebook',
                ...facebookCredentialRequest(credential.credential),
                install_id: installId,
              }
        );
        finishVerification(result, provider);
      } catch (requestError) {
        reportRequestError(requestError, 'auth.classic_verify_failed', provider);
      } finally {
        setBusy(false);
      }
    },
    [busy, finishVerification, fixture, reportRequestError, user]
  );

  const confirmClaim = useCallback(async () => {
    if (!verification || !method || fixture || busy || verification.already_claimed) return;
    const nextFields: Partial<Record<Field, string>> = {};
    if (form.asks.username && username.trim().length < 3) nextFields.username = 'auth.username_min';
    if (form.asks.email && !email.trim()) nextFields.email = 'auth.enter_an_email';
    if (form.asks.password && password.length < 8) nextFields.password = 'auth.password_min';
    if (!verification.classic.name_allowed && displayName.trim().length < 2) {
      nextFields.displayName = 'auth.public_name_min';
    }
    setFields(nextFields);
    if (Object.keys(nextFields).length) {
      setStep('details');
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    setRequestFailure(null);
    try {
      const installId = user ? undefined : await getInstallId();
      const account = claimAccount(
        form,
        { username, email, password, displayName },
        verification.classic.name_allowed
      );
      const claim = () =>
        classicApi.claim({
          ticket: verification.ticket,
          install_id: installId,
          ...(Object.keys(account).length ? { account } : {}),
          ...storedAgeTerms(),
          ...pendingFriendSlug(),
        });
      if (guestCredentials) {
        // This claim saves the guest as Save your progress does, retiring the guest's token,
        // so an answer lost after the server saved is recovered by signing in.
        let refusal: unknown = null;
        const saved = await runGuestSave({
          original: useAuthStore.getState(),
          displayName: '',
          email: form.kept.email ?? email.trim(),
          password,
          upgrade: () =>
            claim().catch((claimError: unknown) => {
              refusal = claimError;
              throw claimError;
            }),
          login: (identifier, accountPassword) =>
            authApi.login(identifier, accountPassword, storedAgeTerms()),
          getSession: useAuthStore.getState,
          install: (response) => {
            setSession({ accessToken: response.token, user: response.user });
            queueLinkedFriend(response.linked_friend);
          },
          setSessionPreservation: (preserve) =>
            useAuthStore.getState().setPreserveSessionOnUnauthorized(preserve),
        });
        if (!saved.ok) {
          setStep('details');
          if (refusal && !saved.error.uncertain) {
            reportRequestError(refusal, 'auth.classic_claim_failed');
          } else {
            setError(saved.error.uncertain ? 'auth.save_uncertain' : 'auth.save_failed');
          }
          return;
        }
      } else {
        const result = await claim();
        setSession({ accessToken: result.token, user: result.user });
        queueLinkedFriend(result.linked_friend);
      }
      const claimed = useAuthStore.getState().user;
      if (!claimed) return;
      const pendingInvite = usePendingInviteStore.getState().pendingInvite;
      const destination = authenticatedEntryDestination(
        pendingInvite,
        useAgeGateStore.getState().ageBand,
        claimed
      );
      if (destination !== '/home') {
        router.replace(destination as Href);
      } else if (from === 'friends' && !claimed.guest) {
        router.replace('/friends');
      } else {
        router.replace({
          pathname: '/profile',
          params: { classicClaimed: claimed.guest ? 'guest' : 'yes' },
        });
      }
    } catch (requestError) {
      reportRequestError(requestError, 'auth.classic_claim_failed');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    displayName,
    email,
    fixture,
    form,
    from,
    guestCredentials,
    method,
    password,
    reportRequestError,
    router,
    setSession,
    user,
    username,
    verification,
  ]);

  const resetVerification = () => {
    if (busy) return;
    setVerification(null);
    setVerifiedLogin('');
    setMethod(null);
    setStep('check');
    setFields({});
    setRefused([]);
    setClassicPassword('');
    setUsername('');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setError(null);
    setRequestFailure(null);
    setCanSignIn(false);
  };

  const onBack = () => {
    if (busy) return;
    if (verification && step === 'details') {
      setStep('check');
      setError(null);
      setRequestFailure(null);
    } else if (verification || method) resetVerification();
    else goBack();
  };
  useHardwareBack(focused, onBack);

  const details = verification && !alreadyClaimed && step === 'details';
  const fieldCount =
    Object.values(form.asks).filter(Boolean).length +
    (verification && !verification.classic.name_allowed ? 1 : 0);
  const pairedFields = fieldCount >= 3;
  const title = !verification
    ? method === 'password'
      ? 'auth.claim_login_title'
      : 'auth.claim_method'
    : alreadyClaimed
      ? 'auth.already_in_pidro'
      : !details
        ? 'auth.classic_found'
        : !verification.classic.name_allowed
          ? 'auth.pick_name'
          : form.asks.password
            ? 'auth.new_pidro_password'
            : claimNeedsDetails(form, true)
              ? 'auth.create_your_account'
              : 'auth.classic_found';
  const notice = requestFailure
    ? localizedError(requestFailure.error, requestFailure.fallback)
    : error
      ? t(error, { provider: errorProvider })
      : null;

  return (
    <AuthFlowScreen
      testID="claim-classic-screen"
      headerTitle={t('auth.classic')}
      onBack={onBack}
      title={t(title)}
      body={
        details
          ? !verification.classic.name_allowed
            ? t('auth.classic_rename')
            : form.asks.password
              ? t('auth.claim_password_body')
              : undefined
          : undefined
      }
      note={
        details && form.kept.username && verification.classic.name_allowed
          ? t('auth.claim_name_stays', { name: form.kept.username })
          : undefined
      }
      aside={
        !verification ? (
          <TextLink
            label={t(method === 'password' ? 'auth.claim_other_method' : 'auth.claim_help')}
            size={metrics.link}
            style={styles.centerLink}
            disabled={busy}
            onPress={
              method === 'password' ? resetVerification : () => router.push('/(auth)/classic-help')
            }
          />
        ) : claimed ? (
          <View style={layout === 'landscape' ? styles.sideLinks : styles.links}>
            {claimed.forgot ? (
              <TextLink
                label={t('auth.forgot')}
                size={metrics.link}
                onPress={() =>
                  router.push({
                    pathname: '/(auth)/forgot-password',
                    params: claimed.login ? { identifier: claimed.login } : {},
                  })
                }
              />
            ) : null}
            <TextLink label={t('auth.back')} size={metrics.link} onPress={resetVerification} />
          </View>
        ) : !details ? (
          <TextLink
            label={t('auth.claim_no')}
            size={metrics.link}
            style={styles.centerLink}
            disabled={busy}
            onPress={resetVerification}
          />
        ) : undefined
      }>
      <AuthFlowWindow
        testID="classic-claim-window"
        style={details && pairedFields && layout === 'landscape' && styles.denseWindow}>
        {notice ? (
          <AuthFlowNotice
            action={
              !verification && canSignIn ? (
                <TextLink label={t('auth.sign_in')} size={metrics.link} onPress={() => signIn()} />
              ) : undefined
            }>
            {notice}
          </AuthFlowNotice>
        ) : null}
        {!verification ? (
          method === 'password' ? (
            <>
              <Input
                label={t('auth.claim_identifier')}
                value={login}
                style={inputStyle}
                error={fields.login ? t(fields.login as TranslationKey) : undefined}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => {
                  setLogin(value);
                  clearField('login');
                }}
              />
              <Input
                label={t('auth.password')}
                value={classicPassword}
                style={inputStyle}
                error={
                  fields.classicPassword ? t(fields.classicPassword as TranslationKey) : undefined
                }
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                revealPassword
                returnKeyType="go"
                onSubmitEditing={() => void verifyPassword()}
                onChangeText={(value) => {
                  setClassicPassword(value);
                  clearField('classicPassword');
                }}
              />
              <TextLink
                label={t('auth.forgot_title')}
                size={metrics.link}
                style={styles.forgot}
                disabled={busy}
                onPress={() =>
                  router.push({
                    pathname: '/(auth)/classic-forgot',
                    params: { login: login.trim(), returnTo: 'claim' },
                  })
                }
              />
              <AuthFlowButton
                testID="classic-forward"
                label={t('auth.classic_verify')}
                loading={busy}
                onPress={() => void verifyPassword()}
              />
            </>
          ) : (
            <>
              <AuthProviderButtons
                showEmail={false}
                availability={fixture ? { apple: true, facebook: true } : undefined}
                onApple={() => void verifyProvider('apple')}
                onFacebook={() => void verifyProvider('facebook')}
              />
              <AuthFlowButton
                label={t('auth.classic_credentials')}
                material="glass"
                disabled={busy}
                onPress={() => setMethod('password')}
              />
            </>
          )
        ) : details ? (
          <>
            <View
              style={[
                {
                  columnGap: metrics.windowGap,
                  rowGap: pairedFields ? PidroSpacing.xs : metrics.windowGap,
                },
                pairedFields && styles.fieldGrid,
              ]}>
              {!verification.classic.name_allowed ? (
                <View style={pairedFields && styles.halfField}>
                  <Input
                    label={t('auth.new_public_name')}
                    value={displayName}
                    style={inputStyle}
                    error={fields.displayName ? t(fields.displayName as TranslationKey) : undefined}
                    maxLength={20}
                    editable={!busy}
                    onChangeText={(value) => {
                      setDisplayName(value);
                      clearField('displayName');
                    }}
                  />
                </View>
              ) : null}
              {form.asks.username ? (
                <View style={pairedFields && styles.halfField}>
                  <Input
                    label={t('auth.username')}
                    value={username}
                    style={inputStyle}
                    error={fields.username ? t(fields.username as TranslationKey) : undefined}
                    maxLength={20}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setUsername(value);
                      clearField('username');
                    }}
                  />
                </View>
              ) : null}
              {form.asks.email ? (
                <View style={pairedFields && styles.halfField}>
                  <Input
                    label={t('auth.email')}
                    value={email}
                    style={inputStyle}
                    error={fields.email ? t(fields.email as TranslationKey) : undefined}
                    editable={!busy}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setEmail(value);
                      clearField('email');
                    }}
                  />
                </View>
              ) : null}
              {form.asks.password ? (
                <View
                  style={[
                    styles.passwordField,
                    pairedFields && (fieldCount === 3 ? styles.fullField : styles.halfField),
                  ]}>
                  <Input
                    label={t('auth.new_pidro_password')}
                    value={password}
                    style={inputStyle}
                    error={
                      fields.password
                        ? t(fields.password as TranslationKey, { count: 8 })
                        : undefined
                    }
                    editable={!busy}
                    secureTextEntry
                    revealPassword
                    onChangeText={(value) => {
                      setPassword(value);
                      clearField('password');
                    }}
                  />
                  <PidroText role="metadata" tone="muted" style={metrics.note}>
                    {t('auth.claim_password_hint')}
                  </PidroText>
                </View>
              ) : null}
            </View>
            {guestCredentials && !canSignIn ? (
              <PidroText role="metadata" tone="muted" style={metrics.note}>
                {t('auth.guest_games')}
              </PidroText>
            ) : null}
            <AuthFlowButton
              testID="classic-forward"
              label={t(canSignIn ? 'auth.sign_in' : 'auth.claim_save')}
              loading={busy}
              onPress={canSignIn ? () => signIn() : () => void confirmClaim()}
            />
          </>
        ) : (
          <>
            <Surface variant="subtle" padded style={styles.preview}>
              {verification.classic.name_allowed && verification.classic.name ? (
                <PidroText role="title" align="center">
                  {verification.classic.name}
                </PidroText>
              ) : (
                <PidroText role="label" tone="muted" align="center">
                  {t('auth.classic_private')}
                </PidroText>
              )}
              <View style={styles.stats}>
                <Stat
                  label={t('auth.claim_games')}
                  value={formatNumber(verification.classic.games_played)}
                />
                <Stat
                  label={t('auth.classic_level')}
                  value={formatNumber(verification.classic.level)}
                />
                {verification.classic.member_since ? (
                  <Stat
                    label={t('auth.member_since')}
                    value={memberSince(verification.classic.member_since)}
                  />
                ) : null}
              </View>
            </Surface>
            {claimed ? (
              <>
                {claimed.hint ? (
                  <PidroText role="body" tone="soft" align="center" style={metrics.body}>
                    {t(claimed.hint)}
                  </PidroText>
                ) : null}
                {claimed.signedInAs ? (
                  <PidroText role="body" tone="soft" align="center" style={metrics.body}>
                    {t('auth.signed_in_other', { name: claimed.signedInAs })}
                  </PidroText>
                ) : null}
                {claimed.guestGamesLost ? (
                  <PidroText role="metadata" tone="muted" align="center" style={metrics.note}>
                    {t('auth.guest_games_left')}
                  </PidroText>
                ) : null}
                {claimed.signIn ? (
                  <AuthFlowButton
                    testID="classic-forward"
                    label={t('auth.sign_in')}
                    onPress={() => signIn(claimed.login)}
                  />
                ) : null}
              </>
            ) : (
              <AuthFlowButton
                testID="classic-forward"
                label={t('auth.claim_yes')}
                loading={busy}
                onPress={() => {
                  if (claimNeedsDetails(form, verification.classic.name_allowed))
                    setStep('details');
                  else void confirmClaim();
                }}
              />
            )}
          </>
        )}
      </AuthFlowWindow>
    </AuthFlowScreen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <PidroText role="title" tone="gold" align="center" numberOfLines={1}>
        {value}
      </PidroText>
      <PidroText role="body" tone="soft" align="center">
        {label}
      </PidroText>
    </View>
  );
}

const styles = StyleSheet.create({
  denseWindow: {
    paddingVertical: PidroSpacing.xs,
    gap: PidroSpacing.xs,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  halfField: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 0,
  },
  fullField: {
    width: '100%',
  },
  passwordField: {
    gap: PidroSpacing.xxs,
  },
  centerLink: {
    alignSelf: 'center',
  },
  links: {
    alignItems: 'center',
  },
  sideLinks: {
    alignItems: 'flex-start',
  },
  forgot: {
    width: '100%',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
    marginVertical: -PidroSpacing.xs,
  },
  preview: {
    gap: PidroSpacing.md,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: PidroSpacing.xs,
  },
  stat: {
    minWidth: 0,
    flex: 1,
    justifyContent: 'center',
    gap: PidroSpacing.xxs,
  },
});
