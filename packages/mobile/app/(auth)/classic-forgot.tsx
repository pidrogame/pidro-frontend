import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { classicApi } from '@/api/classic';
import {
  AuthFlowButton,
  AuthFlowNotice,
  AuthFlowScreen,
  AuthFlowWindow,
  useAuthFlow,
} from '@/components/auth/AuthFlow';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import { PidroSpacing, PidroType } from '@/design/tokens';
import { isEmailAddress } from '@/features/auth/accountEmail';
import {
  isSignInCode,
  requestClassicSignInCode,
  verifyClassicSignInCode,
} from '@/features/auth/classicRecovery';
import { stash } from '@/features/auth/pendingClassicVerification';
import { getInstallId } from '@/features/invites/installId';
import { useFlowBack, useHardwareBack } from '@/hooks/useFlowBack';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/i18n';

type Fixture = 'code' | 'code-invalid' | 'unavailable' | 'not-found';

const PROBLEMS = {
  not_found: 'auth.classic_not_found',
  no_email: 'auth.classic_no_email',
  rate_limited: 'auth.rate_limited',
  unavailable: 'auth.links_unavailable',
  invalid: 'auth.classic_code_invalid',
} as const;

type Problem = keyof typeof PROBLEMS;

export default function ClassicForgotScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useFlowBack();
  const params = useLocalSearchParams<{ login?: string; fixture?: string; returnTo?: string }>();
  const fixture = (__DEV__ ? params.fixture : undefined) as Fixture | undefined;
  const { metrics, inputStyle } = useAuthFlow();
  const [login, setLogin] = useState(params.login ?? (fixture ? 'Bengt' : ''));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(
    fixture === 'unavailable'
      ? 'unavailable'
      : fixture === 'not-found'
        ? 'not_found'
        : fixture === 'code-invalid'
          ? 'invalid'
          : null
  );
  const [emailHint, setEmailHint] = useState<string | null>(
    fixture === 'code' || fixture === 'code-invalid' ? 'be•••••@gmail.com' : null
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const binding = useRef<{ login: string; token: string | null; installId?: string } | null>(null);

  const abandonRequest = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setBusy(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setBusy(false);
      return () => {
        generation.current += 1;
        inFlight.current = false;
        setFocused(false);
      };
    }, [])
  );

  useEffect(() => {
    if (focused && !busy && problem === 'invalid') codeRef.current?.focus();
  }, [busy, focused, problem]);

  const backToForm = useCallback(() => {
    abandonRequest();
    binding.current = null;
    setEmailHint(null);
    setCode('');
    setResent(false);
    setProblem(null);
  }, [abandonRequest]);
  useHardwareBack(focused && emailHint !== null, backToForm);

  const openHelp = useCallback(() => {
    abandonRequest();
    const value = login.trim();
    router.push({
      pathname: '/(auth)/classic-help',
      params: value ? (isEmailAddress(value) ? { email: value } : { name: value }) : {},
    });
  }, [abandonRequest, login, router]);

  const send = useCallback(async () => {
    if (inFlight.current) return;
    const value = login.trim();
    if (!value) {
      setFieldError('auth.enter_classic_identifier');
      inputRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    if (fixture) {
      setResent(emailHint !== null);
      setProblem(null);
      setCode('');
      return;
    }
    inFlight.current = true;
    const operation = ++generation.current;
    const token = useAuthStore.getState().accessToken;
    setBusy(true);
    setProblem(null);
    const result = await requestClassicSignInCode(value, async (requested) => {
      if (binding.current && binding.current.token !== token) throw new Error('Session changed');
      const installId = binding.current?.installId ?? (token ? undefined : await getInstallId());
      if (operation !== generation.current || useAuthStore.getState().accessToken !== token) {
        throw new Error('Recovery left');
      }
      binding.current = { login: requested, token, installId };
      return classicApi.requestSignInCode({ login: requested, install_id: installId });
    });
    if (operation !== generation.current) return;
    inFlight.current = false;
    setBusy(false);
    if (useAuthStore.getState().accessToken !== token || binding.current?.token !== token) {
      backToForm();
      setProblem('unavailable');
    } else if (result.status === 'sent') {
      setCode('');
      setResent(emailHint !== null);
      setEmailHint(result.emailHint);
    } else {
      setResent(false);
      setProblem(result.status);
    }
  }, [backToForm, emailHint, fixture, login]);

  const verify = useCallback(
    async (value: string) => {
      if (inFlight.current || !isSignInCode(value) || fixture) return;
      const attempt = binding.current;
      if (!attempt || attempt.token !== useAuthStore.getState().accessToken) {
        backToForm();
        setProblem('unavailable');
        return;
      }
      inFlight.current = true;
      const operation = ++generation.current;
      setBusy(true);
      setProblem(null);
      setResent(false);
      const result = await verifyClassicSignInCode(attempt.login, value, (requested, digits) =>
        classicApi.verifySignInCode({
          login: requested,
          code: digits,
          install_id: attempt.installId,
        })
      );
      if (operation !== generation.current) return;
      if (attempt.token !== useAuthStore.getState().accessToken) {
        backToForm();
        setProblem('unavailable');
        return;
      }
      if (result.status === 'verified') {
        Keyboard.dismiss();
        stash(result.verification);
        if (params.returnTo === 'claim' && router.canGoBack()) router.back();
        else router.replace('/(auth)/claim-classic');
        return;
      }
      inFlight.current = false;
      setBusy(false);
      setProblem(result.status);
      if (result.status === 'invalid') setCode('');
    },
    [backToForm, fixture, params.returnTo, router]
  );

  if (emailHint !== null) {
    return (
      <AuthFlowScreen
        testID="classic-forgot-screen"
        headerTitle={t('auth.classic')}
        onBack={backToForm}
        title={t('auth.check_inbox')}
        body={t('auth.code_instructions')}
        aside={<TextLink label={t('auth.email_help')} size={metrics.link} onPress={openHelp} />}>
        <AuthFlowWindow testID="classic-code-window">
          {problem ? <AuthFlowNotice>{t(PROBLEMS[problem])}</AuthFlowNotice> : null}
          <PidroText role="body" tone="soft" align="center" style={metrics.body}>
            {t('auth.code_sent_to', { email: emailHint })}
          </PidroText>
          <Input
            ref={codeRef}
            accessibilityLabel={t('auth.sign_in_code')}
            value={code}
            onChangeText={(next) => {
              setCode(next);
              setProblem(null);
              void verify(next);
            }}
            style={[inputStyle, styles.code]}
            editable={!busy}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoCorrect={false}
            keyboardAppearance="dark"
            returnKeyType="go"
            onSubmitEditing={() => void verify(code)}
          />
          <AuthFlowButton
            testID="classic-forward"
            label={t('auth.continue')}
            disabled={!isSignInCode(code)}
            loading={busy}
            onPress={() => void verify(code)}
          />
        </AuthFlowWindow>
        <TextLink
          label={t('auth.resend')}
          size={metrics.link}
          style={styles.centerLink}
          disabled={busy}
          onPress={send}
        />
        {resent ? (
          <PidroText
            role="metadata"
            tone="cyan"
            align="center"
            accessibilityLiveRegion="polite"
            style={metrics.note}>
            {t('auth.resent')}
          </PidroText>
        ) : null}
      </AuthFlowScreen>
    );
  }

  return (
    <AuthFlowScreen
      testID="classic-forgot-screen"
      headerTitle={t('auth.classic')}
      onBack={() => {
        abandonRequest();
        goBack();
      }}
      title={t('auth.forgot_title')}
      body={t('auth.classic_forgot_intro')}>
      <AuthFlowWindow testID="classic-forgot-window">
        {problem ? <AuthFlowNotice>{t(PROBLEMS[problem])}</AuthFlowNotice> : null}
        <Input
          ref={inputRef}
          label={t('auth.classic_identifier')}
          value={login}
          onChangeText={(next) => {
            setLogin(next);
            binding.current = null;
            setFieldError(null);
            setProblem(null);
          }}
          error={fieldError ? t('auth.enter_classic_identifier') : undefined}
          style={inputStyle}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          keyboardAppearance="dark"
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={send}
        />
        <AuthFlowButton
          testID="classic-forward"
          label={t('auth.email_code')}
          loading={busy}
          onPress={send}
        />
      </AuthFlowWindow>
      <TextLink
        label={t('auth.forgot_help')}
        size={metrics.link}
        style={styles.centerLink}
        onPress={openHelp}
      />
    </AuthFlowScreen>
  );
}

const styles = StyleSheet.create({
  centerLink: {
    alignSelf: 'center',
  },
  code: {
    ...PidroType.display,
    letterSpacing: PidroSpacing.xs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
