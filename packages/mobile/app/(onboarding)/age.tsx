import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { TERMS_VERSION, type DeclaredAgeBand } from '@pidro/shared';
import { getMe, setAge } from '@/api/auth';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { PidroLogo } from '@/components/ui/PidroLogo';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { ScreenShell } from '@/components/ui/ScreenShell';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroSpacing,
  PidroSwitchTokens,
} from '@/design/tokens';
import { reconcileAge } from '@/features/onboarding/reconcileAge';
import { entryDestination, needsAgeGate } from '@/navigation/initialRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useAuthStore } from '@/stores/auth';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Background } from '@/components/ui/Background';

const TERMS_URL = 'https://www.pidro.online/terms-of-use';
const PRIVACY_URL = 'https://www.pidro.online/privacy-policy';

const OPTIONS: { value: DeclaredAgeBand; label: TranslationKey }[] = [
  { value: 'under_13', label: 'auth.age_under' },
  { value: '13_17', label: 'auth.age_teen' },
  { value: '18_plus', label: 'auth.age_adult' },
];

type Fixture = 'unanswered' | 'selected' | 'under13';

function HelpLink({
  label,
  onPress,
  punctuation = '',
}: {
  label: string;
  onPress: () => void;
  punctuation?: string;
}) {
  return (
    <PressableFX
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.helpLink}>
      <PidroText role="metadata" tone="cyan" style={styles.helpLinkText}>
        {label}
        {punctuation}
      </PidroText>
    </PressableFX>
  );
}

export default function AgeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { fixture: fixtureParam } = useLocalSearchParams<{ fixture?: string }>();
  const fixture = (__DEV__ ? fixtureParam : undefined) as Fixture | undefined;
  const { width, height } = useWindowDimensions();
  const compact = height < PidroLayout.compactHeight;
  const landscape = width > height && compact;
  const storedBand = useAgeGateStore((state) => state.ageBand);
  const storedTermsVersion = useAgeGateStore((state) => state.termsVersion);
  const setAnswer = useAgeGateStore((state) => state.setAnswer);
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const setSession = useAuthStore((state) => state.setSession);
  const pendingInvite = usePendingInviteStore((state) => state.pendingInvite);
  const [selection, setSelection] = useState<DeclaredAgeBand | null>(
    fixture === 'selected'
      ? '18_plus'
      : !fixture && (storedBand === '13_17' || storedBand === '18_plus')
        ? storedBand
        : null
  );
  const [stopped, setStopped] = useState(
    fixture === 'under13' || (!fixture && storedBand === 'under_13')
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmitStarted = useRef(false);

  const finish = useCallback(
    (resolvedUser = user, resolvedBand = storedBand) => {
      router.replace(
        entryDestination(
          resolvedUser ? 'authenticated' : 'unauthenticated',
          pendingInvite,
          resolvedBand,
          resolvedUser
        ) as Href
      );
    },
    [pendingInvite, router, storedBand, user]
  );

  const submitEligibleAnswer = useCallback(
    async (ageBand: '13_17' | '18_plus', termsVersion: string) => {
      setSubmitting(true);
      const result = await reconcileAge(
        { age_band: ageBand, terms_version: termsVersion },
        { setAge, getMe }
      );
      if (result.status === 'saved') {
        if (accessToken) setSession({ accessToken, user: result.user });
        finish(result.user, ageBand);
      } else if (result.status === 'not_eligible') {
        setAnswer('under_13', termsVersion);
        setStopped(true);
      } else {
        setError(result.messageKey);
      }
      setSubmitting(false);
    },
    [accessToken, finish, setAnswer, setSession]
  );

  useEffect(() => {
    if (
      fixture ||
      autoSubmitStarted.current ||
      (storedBand !== '13_17' && storedBand !== '18_plus') ||
      !storedTermsVersion ||
      !user ||
      (user.age_band !== 'unknown' && user.age_band != null)
    )
      return;
    autoSubmitStarted.current = true;
    void submitEligibleAnswer(storedBand, storedTermsVersion);
  }, [fixture, storedBand, storedTermsVersion, submitEligibleAnswer, user]);

  const continueWithSelection = useCallback(async () => {
    if (!selection || submitting) return;
    setError(null);
    setAnswer(selection, TERMS_VERSION);
    if (selection === 'under_13') {
      setStopped(true);
      return;
    }
    if (!user || (user.age_band !== 'unknown' && user.age_band != null)) {
      finish(user, selection);
      return;
    }
    await submitEligibleAnswer(selection, TERMS_VERSION);
  }, [finish, selection, setAnswer, submitEligibleAnswer, submitting, user]);

  if (!fixture && storedBand !== 'under_13' && !needsAgeGate(storedBand, user)) {
    return (
      <Background>
        <Redirect
          href={
            entryDestination(
              user ? 'authenticated' : 'unauthenticated',
              pendingInvite,
              storedBand,
              user
            ) as Href
          }
        />
      </Background>
    );
  }

  if (stopped) {
    return (
      <ScreenShell scroll testID="age-stop-screen" contentStyle={styles.screen}>
        <LanguageSwitch />
        {!compact ? (
          <View style={styles.logoStage} pointerEvents="none">
            <PidroLogo size="compact" />
          </View>
        ) : null}
        <View style={[styles.stopCopy, compact && styles.stopCopyCompact]}>
          <PidroText role="display" tone="gold" align="center" style={styles.stopTitle}>
            {t('auth.age_stop')}
          </PidroText>
          <PidroText role="body" align="center">
            {t('auth.age_thanks')}
          </PidroText>
        </View>
        <View accessibilityLabel={t('auth.help')} style={styles.stopLinks}>
          <HelpLink
            label={t('auth.privacy')}
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
          />
          <View style={styles.dot} />
          <HelpLink
            label={t('auth.support')}
            onPress={() => Linking.openURL('mailto:support@pidro.net')}
          />
        </View>
      </ScreenShell>
    );
  }

  const terms = (
    <View style={styles.termsLine}>
      {t('auth.terms_agreement', { terms: '\uFFF0', privacy: '\uFFF1' })
        .split(/(\uFFF0|\uFFF1)/)
        .map((part, index) =>
          part === '\uFFF0' || part === '\uFFF1' ? (
            <HelpLink
              key={index}
              label={t(part === '\uFFF0' ? 'auth.terms' : 'auth.privacy')}
              onPress={() =>
                WebBrowser.openBrowserAsync(part === '\uFFF0' ? TERMS_URL : PRIVACY_URL)
              }
            />
          ) : (
            <PidroText key={index} role="metadata" tone="soft" style={styles.termsText}>
              {part}
            </PidroText>
          )
        )}
    </View>
  );

  return (
    <ScreenShell
      scroll
      testID="age-screen"
      contentStyle={[styles.screen, landscape && styles.screenLandscape]}>
      <LanguageSwitch />
      {height >= 700 ? (
        <View style={styles.logoStage} pointerEvents="none">
          <PidroLogo size="compact" />
        </View>
      ) : null}

      <View style={[styles.body, landscape && styles.bodyLandscape]}>
        <View style={[styles.copy, landscape && styles.half]}>
          <View style={styles.intro}>
            <PidroText role="display" tone="gold" align="center" style={styles.title}>
              {t('auth.age_title')}
            </PidroText>
            <PidroText role="body" align="center">
              {t('auth.age_body')}
            </PidroText>
          </View>
          {landscape ? terms : null}
        </View>

        <View style={[styles.actions, landscape && styles.half]}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('auth.age_range')}
            style={styles.options}>
            {OPTIONS.map((option) => {
              const checked = selection === option.value;
              return (
                <BevelButton
                  key={option.value}
                  label={t(option.label)}
                  material="glass"
                  size="lg"
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  aria-checked={checked}
                  leadingIcon={
                    checked ? (
                      <Icon name="check" size={20} color={PidroColors.cyanText} />
                    ) : undefined
                  }
                  onPress={() => setSelection(option.value)}
                  style={[styles.option, checked && styles.optionSelected]}
                />
              );
            })}
          </View>

          {error ? (
            <PidroText accessibilityRole="alert" role="metadata" tone="danger" align="center">
              {t(error as TranslationKey)}
            </PidroText>
          ) : null}

          <BevelButton
            accessibilityLabel={t('auth.continue')}
            material="wood"
            size="lg"
            weight="hero"
            fullWidth
            disabled={!selection}
            loading={submitting}
            onPress={continueWithSelection}
            style={[styles.continueButton, landscape && styles.continueLandscape]}>
            <PidroText style={styles.continueLabel}>{t('auth.continue')}</PidroText>
          </BevelButton>
        </View>
      </View>
      {!landscape ? terms : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    gap: PidroSpacing.sm,
    maxWidth: 390,
  },
  screenLandscape: { maxWidth: 860 },
  body: { width: '100%', gap: PidroSpacing.sm },
  bodyLandscape: { flexDirection: 'row', gap: PidroSpacing.xl, flexGrow: 1, alignItems: 'center' },
  copy: { alignItems: 'center', gap: PidroSpacing.sm },
  actions: { alignItems: 'center', gap: PidroSpacing.sm },
  half: { flex: 1, minWidth: 0 },
  logoStage: {
    width: '100%',
    minHeight: 150,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    width: '100%',
    maxWidth: 340,
    flexShrink: 0,
    alignItems: 'center',
    gap: PidroSpacing.xs,
    marginBottom: PidroSpacing.xs,
  },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
  },
  options: {
    width: '100%',
    maxWidth: 340,
    gap: PidroSpacing.sm,
  },
  option: {
    width: '100%',
    height: 56,
  },
  optionSelected: {
    boxShadow: `${PidroSwitchTokens.focusShadow}, ${PidroBevel.glassDropShadow}`,
  },
  continueButton: {
    width: '100%',
    maxWidth: 340,
    marginTop: PidroSpacing.xs,
  },
  // A short landscape phone has no room for the extra step above the label-sized button.
  continueLandscape: { marginTop: 0 },
  continueLabel: {
    fontFamily: PidroFonts.display,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '400',
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
    transform: [{ translateY: -1 }],
  },
  termsLine: {
    width: '100%',
    maxWidth: 340,
    minHeight: PidroLayout.touchTarget,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsText: {
    fontSize: 13,
    lineHeight: 20,
  },
  helpLink: {
    minWidth: PidroLayout.touchTarget,
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpLinkText: {
    fontSize: 13,
    lineHeight: 20,
  },
  stopCopy: {
    width: '100%',
    maxWidth: 340,
    flexShrink: 0,
    alignItems: 'center',
    gap: PidroSpacing.sm,
    marginBottom: 138,
  },
  stopCopyCompact: {
    flexGrow: 1,
    justifyContent: 'center',
    marginBottom: PidroSpacing.lg,
  },
  stopTitle: {
    fontFamily: PidroFonts.display,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '400',
  },
  stopLinks: {
    minHeight: PidroLayout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: PidroSpacing.xs,
  },
  dot: {
    width: PidroSpacing.xxs,
    height: PidroSpacing.xxs,
    borderRadius: PidroSpacing.xxs,
    backgroundColor: PidroColors.textMuted,
  },
});
