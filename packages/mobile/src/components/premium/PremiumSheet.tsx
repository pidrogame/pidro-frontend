import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { KeepProgressPrompt } from '@/components/auth/KeepProgressPrompt';
import { BevelButton } from '@/components/ui/BevelButton';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { TextLink } from '@/components/ui/TextLink';
import { LEGAL_URLS } from '@/constants/config';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { buyPremium, premiumDate, restorePremium } from '@/features/premium/premium';
import {
  doneKey,
  premiumPlans,
  sheetAfter,
  type Plan,
  type PlanId,
  type PremiumSheetFixture,
  type SheetDoor,
  type SheetNotice,
  type SheetStep,
} from '@/features/premium/premiumSheet';
import { getOfferings } from '@/features/premium/purchases';
import { getLocale, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

const STORE = Platform.OS === 'android' ? 'Google Play' : 'App Store';

interface Props {
  open: boolean;
  door: SheetDoor;
  onClose: () => void;
  /** The ad ticket's solo game, dealt once the player is Premium. */
  onDeal?: () => void;
  fixture?: PremiumSheetFixture | null;
}

/**
 * Pidro Premium (PID-126): what it is, two plans, one wood button. The store sells it and
 * the server says when the player has it; this sheet only asks and shows the answer.
 */
export function PremiumSheet({ open, door, onClose, onDeal, fixture }: Props) {
  const { t, locale } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height && height < PidroLayout.compactHeight;
  const small = !landscape && height < 700;
  const reduceMotion = useReducedMotion();
  const user = useAuthStore((state) => state.user);
  const [step, setStep] = useState<SheetStep>(fixture?.step ?? 'loading');
  const [plans, setPlans] = useState<Plan[]>(() =>
    fixture ? premiumPlans(fixture.offerings, getLocale()) : []
  );
  const [chosen, setChosen] = useState<PlanId>('yearly');
  const [notice, setNotice] = useState<SheetNotice>(null);
  const [keep, setKeep] = useState(Boolean(fixture?.guest));
  const [saving, setSaving] = useState(false);
  // One purchase, restore or deal at a time, even from two taps before a render.
  const inFlight = useRef(false);
  const offered = useRef(Boolean(fixture?.guest));
  const busy = step === 'buying' || step === 'restoring';
  const plan = plans.find((item) => item.id === chosen) ?? plans[0];

  // Each opening starts from the plans, yearly chosen.
  const [shown, setShown] = useState(open);
  if (open !== shown) {
    setShown(open);
    if (open && !fixture) {
      setStep('loading');
      setChosen('yearly');
      setNotice(null);
      setKeep(false);
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open || fixture) return;
    offered.current = false;
    inFlight.current = false;
    captureAnalytics('premium_sheet_opened', { door });
    let live = true;
    void getOfferings().then((offerings) => {
      if (!live) return;
      const next = premiumPlans(offerings, getLocale());
      setPlans(next);
      // A restore may have answered first; only the loading sheet moves on.
      setStep((now) => (now === 'loading' ? (next.length ? 'choose' : 'empty') : now));
    });
    return () => {
      live = false;
    };
  }, [open, fixture, door]);

  const close = () => {
    if (!busy) onClose();
  };

  const answer = (kind: 'buy' | 'restore', outcome: Parameters<typeof sheetAfter>[1]) => {
    const next = sheetAfter(kind, outcome);
    setStep(next.step);
    setNotice(next.notice);
    // A guest's purchase stands either way; keeping it on an account is offered once (Apple 5.1.1).
    if (user?.guest && !offered.current && (next.step === 'bought' || next.step === 'waiting')) {
      offered.current = true;
      setKeep(true);
    }
  };

  const buy = async () => {
    if (!plan || inFlight.current || fixture) return;
    inFlight.current = true;
    setNotice(null);
    setStep('buying');
    const outcome = await buyPremium(plan.pkg);
    inFlight.current = false;
    captureAnalytics('premium_purchase', { plan: plan.id, outcome });
    answer('buy', outcome);
  };

  const restore = async () => {
    if (inFlight.current || fixture) return;
    inFlight.current = true;
    setNotice(null);
    setStep('restoring');
    const outcome = await restorePremium();
    inFlight.current = false;
    answer('restore', outcome);
  };

  const done = () => {
    if (inFlight.current) return;
    // Held until the sheet opens again, so a second tap cannot deal twice.
    inFlight.current = true;
    onClose();
    if (door === 'ad') onDeal?.();
  };

  const until = fixture?.until ?? user?.premium_until;
  const title = (text: string) => (
    <PidroText
      accessibilityRole="header"
      style={[styles.title, (small || landscape) && styles.titleSmall]}>
      {text}
    </PidroText>
  );
  const dismiss = (
    <DismissButton accessibilityLabel={t('premium.sheet.close')} disabled={busy} onPress={close} />
  );
  const head = (
    <View style={styles.head}>
      {title(t('premium.sheet.title'))}
      {dismiss}
    </View>
  );
  const plus = (
    <View style={[styles.plus, small && styles.plusSmall]}>
      {(['noAds', 'themes', 'keeps'] as const).map((line) => (
        <View key={line} style={styles.plusLine}>
          <Icon name="check" size={20} strokeWidth={2.8} color={PidroBevel.textGold} />
          <PidroText role="body" style={styles.plusText}>
            {t(`premium.sheet.${line}`)}
          </PidroText>
        </View>
      ))}
    </View>
  );
  const rows = (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('premium.sheet.plans')}
      style={styles.rows}>
      {plans.map((item) => {
        const checked = item.id === plan?.id;
        return (
          <PressableFX
            key={item.id}
            testID={`premium-plan-${item.id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: busy }}
            aria-checked={checked}
            disabled={busy}
            onPress={() => {
              setChosen(item.id);
              if (step === 'failed') setStep('choose');
            }}
            style={[styles.row, landscape && styles.rowLandscape, checked && styles.rowOn]}
            pressedStyle={styles.rowPressed}>
            <View style={[styles.radio, checked && styles.radioOn]}>
              {checked ? <View style={styles.dot} /> : null}
            </View>
            <View style={styles.rowCopy}>
              <PidroText role="label" style={styles.planName}>
                {t(`premium.sheet.${item.id}`)}
              </PidroText>
              {item.perMonth ? (
                <PidroText role="metadata" tone="soft" style={styles.note}>
                  {t('premium.sheet.perMonth', { price: item.perMonth })}
                </PidroText>
              ) : null}
            </View>
            <View style={styles.price}>
              <PidroText role="title" style={styles.priceText}>
                {item.price}
              </PidroText>
              <PidroText role="metadata" tone="soft">
                {t(item.id === 'yearly' ? 'premium.sheet.aYear' : 'premium.sheet.aMonth')}
              </PidroText>
            </View>
          </PressableFX>
        );
      })}
    </View>
  );
  const alert =
    step === 'failed' ? (
      <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name="alert" size={20} strokeWidth={2.4} color={PidroColors.danger} />
        <PidroText role="body" style={styles.alertText}>
          {t('premium.sheet.failed')}
        </PidroText>
      </View>
    ) : notice ? (
      <PidroText role="body" tone="soft" align="center" accessibilityLiveRegion="polite">
        {notice === 'notFound'
          ? t('premium.notFound', { store: STORE })
          : t('premium.restoreFailed')}
      </PidroText>
    ) : null;
  const subscribe = (
    <View style={styles.buy}>
      <BevelButton
        testID="premium-subscribe"
        label={t(step === 'failed' ? 'premium.sheet.retry' : 'premium.sheet.subscribe')}
        size={small || landscape ? 'md' : 'lg'}
        fullWidth
        loading={busy || step === 'loading'}
        onPress={() => void buy()}
      />
      {plan ? (
        <PidroText role="metadata" tone="soft" align="center" style={styles.renews}>
          {t(plan.id === 'yearly' ? 'premium.sheet.renewsYearly' : 'premium.sheet.renewsMonthly', {
            price: plan.price,
            store: STORE,
          })}
        </PidroText>
      ) : null}
    </View>
  );
  const links = (
    <View style={[styles.links, landscape && styles.linksLandscape]}>
      <TextLink
        testID="premium-restore"
        label={t('premium.restore')}
        size={14}
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void restore()}
      />
      <TextLink
        label={t('auth.terms')}
        size={14}
        disabled={busy}
        onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}
      />
      <TextLink
        label={t('premium.sheet.privacy')}
        size={14}
        disabled={busy}
        onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.privacy)}
      />
    </View>
  );

  let content;
  if (step === 'bought') {
    content = (
      <>
        <View style={styles.bought} accessibilityLiveRegion="polite">
          <View style={styles.disc}>
            <Icon name="check" size={30} strokeWidth={2.8} color={PidroColors.success} />
          </View>
          {title(t('premium.sheet.boughtTitle'))}
          <PidroText role="body" tone="soft" align="center">
            {until
              ? t('premium.sheet.boughtUntil', {
                  date: premiumDate(new Date(until), locale),
                  store: STORE,
                })
              : t('premium.lifetime')}
          </PidroText>
        </View>
        <BevelButton
          testID="premium-done"
          label={t(doneKey(door))}
          size={small || landscape ? 'md' : 'lg'}
          fullWidth
          onPress={done}
        />
      </>
    );
  } else if (step === 'waiting' || step === 'empty') {
    const waiting = step === 'waiting';
    content = (
      <>
        <View style={styles.words} accessibilityLiveRegion="polite">
          {waiting ? title(t('premium.sheet.waitingTitle')) : head}
          <PidroText role="body" tone="soft">
            {t(
              !waiting
                ? 'premium.sheet.empty'
                : Platform.OS === 'android'
                  ? 'premium.sheet.waitingGoogle'
                  : 'premium.sheet.waitingApple'
            )}
          </PidroText>
        </View>
        <BevelButton
          testID="premium-close"
          label={t('premium.sheet.close')}
          material="glass"
          size={small || landscape ? 'md' : 'lg'}
          fullWidth
          onPress={close}
        />
      </>
    );
  } else if (landscape) {
    content = (
      <View style={styles.columns}>
        <View style={styles.column}>
          {title(t('premium.sheet.title'))}
          {plus}
          {links}
        </View>
        <View style={[styles.column, styles.side]}>
          {rows}
          {alert}
          {subscribe}
        </View>
        <View style={styles.corner}>{dismiss}</View>
      </View>
    );
  } else {
    content = (
      <>
        {head}
        {plus}
        {rows}
        {alert}
        {subscribe}
        {links}
      </>
    );
  }

  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={open}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityLabel={t('premium.sheet.close')}
            disabled={busy}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID="premium-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, landscape && styles.sheetLandscape]}>
            <View style={styles.grabber} />
            {/* Taller than the screen, the sheet scrolls and Subscribe stays in reach. */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.scrolled,
                small && styles.scrolledSmall,
                landscape && styles.scrolledLandscape,
              ]}
              bounces={false}>
              {content}
            </ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
      {/* Inside the sheet's Modal: iOS presents them from the sheet, not beside it. */}
      <KeepProgressPrompt
        isOpen={open && keep}
        onClose={() => setKeep(false)}
        onSave={() => {
          setKeep(false);
          setSaving(true);
        }}
      />
      <AuthSheet
        isOpen={open && saving}
        reason="save"
        showClaimClassic={false}
        onClaimClassic={() => setSaving(false)}
        onClose={() => setSaving(false)}
        onSaved={() => setSaving(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.backdrop },
  sheet: {
    alignSelf: 'center',
    flexShrink: 1,
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingTop: 10,
  },
  sheetLandscape: { maxWidth: 760 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  scroll: { flexGrow: 0 },
  scrolled: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: PidroSpacing.xs,
    paddingBottom: PidroSpacing.lg,
  },
  scrolledSmall: { gap: 10, paddingBottom: PidroSpacing.md },
  scrolledLandscape: { paddingHorizontal: PidroSpacing.lg, paddingBottom: PidroSpacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: PidroSpacing.sm,
  },
  title: {
    flexShrink: 1,
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 28,
    lineHeight: 36,
    color: PidroBevel.textGold,
  },
  titleSmall: { fontSize: 25, lineHeight: 32 },
  plus: { gap: PidroSpacing.xs },
  plusSmall: { gap: 5 },
  plusLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  plusText: { flex: 1, minWidth: 0, fontWeight: '700', lineHeight: 22 },
  rows: { gap: 10 },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: PidroSpacing.sm,
    paddingHorizontal: 14,
    borderRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  rowLandscape: { minHeight: 62, paddingVertical: PidroSpacing.xs },
  // The chosen plan: a gold edge on a warm wash, the edge drawn inside so nothing shifts.
  rowOn: {
    borderColor: PidroBevel.rim,
    backgroundColor: PidroColors.chosenBg,
    boxShadow: `inset 0px 0px 0px 1px ${PidroBevel.rim}`,
  },
  rowPressed: { backgroundColor: PidroColors.actionPill },
  radio: {
    width: 22,
    height: 22,
    borderRadius: PidroRadii.full,
    borderWidth: 2,
    borderColor: PidroColors.radioOff,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: PidroBevel.textGold },
  dot: {
    width: 10,
    height: 10,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroBevel.textGold,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  planName: { fontSize: 17, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 17 },
  price: { alignItems: 'flex-end', gap: 1, flexShrink: 0 },
  priceText: { fontWeight: '900', fontSize: 20, lineHeight: 24, fontVariant: ['tabular-nums'] },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: PidroSpacing.sm,
    borderRadius: PidroRadii.panel,
    borderWidth: 1,
    borderColor: PidroColors.dangerBorder,
    backgroundColor: PidroColors.dangerBg,
  },
  alertText: { flex: 1, minWidth: 0, fontWeight: '700', lineHeight: 20 },
  buy: { gap: PidroSpacing.xs },
  // Two lines held for either plan, so choosing one does not move the links.
  renews: { fontSize: 13, lineHeight: 18, minHeight: 36 },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: -PidroSpacing.xs,
  },
  linksLandscape: { justifyContent: 'flex-start', marginTop: 0, marginLeft: -PidroSpacing.xs },
  bought: { alignItems: 'center', gap: 10, paddingTop: 10 },
  disc: {
    width: 56,
    height: 56,
    borderRadius: PidroRadii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: PidroColors.success,
    backgroundColor: PidroColors.successBg,
  },
  words: { gap: PidroSpacing.xs, paddingTop: PidroSpacing.xs },
  columns: { flexDirection: 'row', gap: 28 },
  column: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 14 },
  // Clear of the close button above the plans.
  side: { gap: PidroSpacing.xs, paddingTop: 34 },
  corner: { position: 'absolute', top: -6, right: -8 },
});
