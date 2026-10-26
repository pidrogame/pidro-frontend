import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BevelButton } from '@/components/ui/BevelButton';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { STORAGE_KEYS } from '@/constants/config';
import { PidroBevel, PidroColors, PidroFonts, PidroLayout, PidroSpacing } from '@/design/tokens';
import { FEEDBACK_EMAIL } from '@/features/feedback';
import { useHardwareBack } from '@/hooks/useFlowBack';
import { formatDate, useTranslation, type TranslationKey } from '@/i18n';
import { needsAgeGate } from '@/navigation/initialRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useAuthStore } from '@/stores/auth';
import { openFeedbackMail } from '@/utils/feedbackMail';

/** The day Marcel wrote the note. */
const POSTED = new Date(2026, 9, 26);

// Read at launch, so the answer is in before anyone can reach PLAY.
const seenAtLaunch = AsyncStorage.getItem(STORAGE_KEYS.welcomeSeen).catch(() => null);

/**
 * Marcel's welcome, once per install. It lives in the root layout because that
 * is the one place above every screen: a new player meets it on Welcome right
 * after the age gate, before PLAY starts their first game; a tester updating
 * meets it on whatever screen they open to. It waits while they are at a table
 * (and on the dev fixture routes), and shows the moment they leave.
 */
export function WelcomeSheet() {
  const pathname = usePathname();
  const ageHydrated = useAgeGateStore((state) => state.hydrated);
  const ageBand = useAgeGateStore((state) => state.ageBand);
  const user = useAuthStore((state) => state.user);
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void seenAtLaunch.then((value) => active && setSeen(value != null));
    return () => {
      active = false;
    };
  }, []);

  const open =
    seen === false &&
    ageHydrated &&
    !needsAgeGate(ageBand, user) &&
    !pathname.startsWith('/game') &&
    !pathname.endsWith('-dev');

  const play = useCallback(() => {
    setSeen(true);
    void AsyncStorage.setItem(STORAGE_KEYS.welcomeSeen, '1');
  }, []);

  return open ? <WelcomeSheetView onPlay={play} /> : null;
}

const LINES: { icon: IconName; color: string; title: TranslationKey; body: TranslationKey }[] = [
  { icon: 'check', color: PidroColors.success, title: 'news.today', body: 'news.todayBody' },
  { icon: 'clock', color: PidroColors.iconOnGlass, title: 'news.notYet', body: 'news.notYetBody' },
  { icon: 'mail', color: PidroColors.goldLight, title: 'news.tell', body: 'news.tellBody' },
];

export function WelcomeSheetView({ onPlay }: { onPlay: () => void }) {
  const { t, locale } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height && height < PidroLayout.compactHeight;
  const tablet = Math.min(width, height) >= 700;
  // Under 700pt tall (an SE, a small Android) the rhythm tightens so it still fits.
  const short = !landscape && height < 700;

  // Android back closes it the same way "Let's play" does.
  useHardwareBack(true, onPlay);
  // Screen readers start on the note, not on the screen it covers.
  const title = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' && title.current)
      AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
  }, []);

  const intro = (
    <View style={styles.intro}>
      <View style={styles.from}>
        <View style={styles.ring}>
          <View style={styles.ringFace}>
            <PidroText style={styles.initial}>M</PidroText>
          </View>
        </View>
        <View>
          <PidroText role="label" style={styles.fromName}>
            {t('news.from')}
          </PidroText>
          <PidroText role="metadata" tone="muted">
            {t('news.posted', { date: formatDate(POSTED, { day: 'numeric', month: 'long' }) })}
          </PidroText>
        </View>
      </View>
      <View ref={title} nativeID="welcome-sheet-title" accessible accessibilityRole="header">
        <PidroText
          style={[
            styles.title,
            short && styles.titleShort,
            landscape && styles.titleLandscape,
            tablet && styles.titleTablet,
          ]}>
          {t('news.welcomeTitle')}
        </PidroText>
      </View>
      <PidroText role="body" tone="soft">
        {t('news.welcomeBody')}
      </PidroText>
    </View>
  );

  const lines = (
    <View style={styles.lines}>
      {LINES.map((line) => {
        const content = (
          <>
            <View style={styles.disc}>
              <Icon name={line.icon} size={20} color={line.color} />
            </View>
            <View style={styles.lineCopy}>
              <PidroText role="label" style={styles.lineTitle}>
                {t(line.title)}
              </PidroText>
              <PidroText role="body" tone="soft" style={styles.lineBody}>
                {line.body === 'news.tellBody'
                  ? t(line.body, { email: '\uFFF0' })
                      .split('\uFFF0')
                      .flatMap((part, index) =>
                        index === 0
                          ? [part]
                          : [
                              <PidroText key={index} tone="cyan" style={styles.email}>
                                {FEEDBACK_EMAIL}
                              </PidroText>,
                              part,
                            ]
                      )
                  : t(line.body)}
              </PidroText>
            </View>
          </>
        );
        // The address is too small a target on its own; the whole line opens the mail.
        return line.body === 'news.tellBody' ? (
          <PressableFX
            key={line.title}
            accessibilityRole="link"
            accessibilityLabel={`${t(line.title)}. ${FEEDBACK_EMAIL}`}
            onPress={() => void openFeedbackMail()}
            testID="welcome-sheet-mail"
            style={styles.line}>
            {content}
          </PressableFX>
        ) : (
          <View key={line.title} style={styles.line}>
            {content}
          </View>
        );
      })}
    </View>
  );

  const button = (
    <BevelButton
      label={t('news.play')}
      material="wood"
      size={landscape ? 'md' : 'lg'}
      fullWidth
      testID="welcome-sheet-play"
      onPress={onPlay}
    />
  );

  const classic = (
    <PidroText role="metadata" tone="muted" style={styles.classic}>
      {t('news.classic')}
    </PidroText>
  );

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.backdrop]}
      testID="welcome-sheet"
      role="dialog"
      aria-modal
      aria-labelledby="welcome-sheet-title"
      accessibilityViewIsModal
      accessibilityLanguage={locale}>
      <SafeAreaView
        edges={['top', 'right', 'bottom', 'left']}
        style={[styles.safe, tablet && styles.safeTablet]}>
        <View
          style={[
            styles.column,
            landscape && styles.columnLandscape,
            tablet && styles.columnTablet,
            short && styles.columnShort,
          ]}>
          {landscape ? (
            // Sideways the button stays under the note, so the three lines get the full height.
            <View style={styles.sideBySide}>
              <View style={styles.half}>
                <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                  {intro}
                  {classic}
                </ScrollView>
                {button}
              </View>
              <ScrollView style={styles.half} contentContainerStyle={styles.content}>
                {lines}
              </ScrollView>
            </View>
          ) : (
            <>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                  styles.content,
                  short && styles.contentShort,
                  tablet && styles.contentTablet,
                ]}
                showsVerticalScrollIndicator={false}>
                {intro}
                {lines}
                {classic}
              </ScrollView>
              {button}
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { zIndex: 100, backgroundColor: PidroColors.panelStrong },
  safe: { flex: 1 },
  safeTablet: { justifyContent: 'center' },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 436,
    alignSelf: 'center',
    gap: PidroSpacing.md,
    paddingHorizontal: PidroSpacing.md,
    paddingTop: PidroSpacing.lg,
    paddingBottom: PidroSpacing.md,
  },
  columnLandscape: {
    maxWidth: 860,
    gap: PidroSpacing.sm,
    paddingHorizontal: PidroSpacing.lg,
    paddingTop: PidroSpacing.md,
    paddingBottom: PidroSpacing.sm,
  },
  columnTablet: { maxHeight: 760, maxWidth: 520, paddingVertical: PidroSpacing.xl },
  columnShort: { paddingTop: PidroSpacing.md },
  scroll: { flex: 1 },
  content: { gap: PidroSpacing.lg },
  contentShort: { gap: PidroSpacing.md },
  contentTablet: { flexGrow: 1, justifyContent: 'center' },
  sideBySide: { flex: 1, flexDirection: 'row', gap: PidroSpacing.xl },
  half: { flex: 1, minWidth: 0, gap: PidroSpacing.sm },
  intro: { gap: PidroSpacing.sm },
  from: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm },
  ring: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 2.5,
    ...gradientBg(PidroBevel.goldRimGradient),
    boxShadow: PidroBevel.dropShadow,
  },
  ringFace: {
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroBevel.panelMid,
  },
  initial: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 22,
    lineHeight: 28,
    color: PidroBevel.textGold,
  },
  fromName: { fontSize: 16, lineHeight: 21 },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 34,
    lineHeight: 42,
    color: PidroBevel.textGold,
  },
  titleShort: { fontSize: 30, lineHeight: 38 },
  titleLandscape: { fontSize: 26, lineHeight: 33 },
  titleTablet: { fontSize: 36, lineHeight: 45 },
  lines: { gap: PidroSpacing.md },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: PidroSpacing.sm },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PidroColors.cyanBorder,
    backgroundColor: PidroColors.glass,
  },
  lineCopy: { flex: 1, minWidth: 0, gap: 2 },
  lineTitle: { fontSize: 16, lineHeight: 21 },
  lineBody: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  email: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  classic: { fontSize: 13, lineHeight: 18 },
});
