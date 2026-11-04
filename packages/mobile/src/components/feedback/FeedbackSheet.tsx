import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { localizedFieldErrors } from '@pidro/shared';
import { feedbackApi } from '@/api/feedback';
import { gradientBg } from '@/components/ui/Bevel';
import { BevelButton } from '@/components/ui/BevelButton';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroNote,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import {
  FEEDBACK_EMAIL,
  draft,
  feedbackNote,
  sendFailure,
  type TellStage,
} from '@/features/feedback';
import { playActionHaptic } from '@/game/useGameHaptics';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { feedbackDetails, openFeedbackMail } from '@/utils/feedbackMail';
import { playSuccessHaptic } from '@/utils/haptics';

const FLIP_MS = 300;
const LEAVE_MS = 360;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opened from the question about the last game. */
  chip?: boolean;
  /** Opened from Write back: the chip names the post, and the note answers it. */
  post?: { id: number; title: string } | null;
  fixture?: { stage: TellStage; body: string; email: string; emailOpen: boolean; chip: boolean };
}

/**
 * Tell us: a note to the team on a white card. Send turns the card over and it
 * lies face down while the note travels; it only leaves once the server has it,
 * and turns back with the words on it if not.
 */
export function FeedbackSheet({ open, onClose, chip = false, post, fixture }: Props) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height && height < PidroLayout.compactHeight;
  const tablet = Math.min(width, height) >= 700;
  const small = !tablet && !landscape && height < 700;
  const reduceMotion = useReducedMotion();
  const accountEmail = useAuthStore((state) => state.user?.email) ?? '';
  const [stage, setStage] = useState<TellStage | 'sending'>(fixture?.stage ?? 'write');
  const [body, setBody] = useState(fixture?.body ?? draft.body);
  const [email, setEmail] = useState(fixture?.email ?? draft.email);
  const [emailOpen, setEmailOpen] = useState(fixture?.emailOpen ?? draft.email !== '');
  const [emailError, setEmailError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [mailFailed, setMailFailed] = useState(false);
  const [sentTo, setSentTo] = useState(
    fixture?.stage === 'sent' ? (fixture.emailOpen ? fixture.email : accountEmail) : ''
  );
  const locked = useRef(false);
  const ink = useRef<TextInput>(null);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(leave.current), []);
  // The small print yields to the keyboard.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  // 0 face up, 1 face down while the note travels, 2 gone upward.
  const beat = useSharedValue(0);
  const lift = height;
  const replyTo = emailOpen ? email.trim() : accountEmail;
  const sending = stage === 'sending';
  // The server will not take this note now: for today, or from a guest (PID-348).
  const refused = stage === 'limit' || stage === 'account';
  const showChip = chip || Boolean(fixture?.chip) || Boolean(post);

  const card = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: interpolate(beat.value, [0, 1, 2], [1, 0.5, 0]) };
    const away = Math.max(beat.value - 1, 0);
    return {
      transform: [
        { translateY: -lift * away * away },
        { rotateZ: `${away * 4}deg` },
        { scale: 1 - away / 2 },
      ],
    };
  });
  const face = useAnimatedStyle(() =>
    reduceMotion
      ? {}
      : {
          opacity: beat.value < 0.5 ? 1 : 0,
          transform: [{ perspective: 900 }, { rotateY: `${Math.min(beat.value, 1) * 180}deg` }],
        }
  );
  const back = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: 0 }
      : {
          opacity: beat.value < 0.5 ? 0 : 1,
          transform: [
            { perspective: 900 },
            { rotateY: `${Math.min(beat.value, 1) * 180 - 180}deg` },
          ],
        }
  );
  const rest = useAnimatedStyle(() => ({
    opacity: interpolate(beat.value, [0, 0.4], [1, 0], 'clamp'),
  }));

  // Opening again starts from the words: a sent note, a failure or a refusal to a guest
  // (who may have an account by now) is over; the limit is not.
  // Reset on open, not on close, so the sheet keeps its face while it slides away.
  const [shown, setShown] = useState(open);
  if (open !== shown) {
    setShown(open);
    if (open && (stage === 'sent' || stage === 'failed' || stage === 'account')) {
      setStage('write');
      setMailFailed(false);
      setEmailError(undefined);
    }
  }

  const close = () => {
    if (locked.current || sending) return;
    Keyboard.dismiss();
    onClose();
    // Hidden by now in every stage that can close: the card is gone or face up.
    beat.set(0);
  };

  const send = async () => {
    if (locked.current || !body.trim() || refused) return;
    locked.current = true;
    Keyboard.dismiss();
    playActionHaptic();
    setStage('sending');
    setEmailError(undefined);
    beat.set(
      withTiming(1, {
        duration: FLIP_MS,
        easing: Easing.bezier(0.4, 0.1, 0.3, 1),
        reduceMotion: ReduceMotion.Never,
      })
    );
    try {
      await Promise.all([
        feedbackApi.send(feedbackNote(body, replyTo, feedbackDetails(), post?.id)),
        new Promise((resolve) => setTimeout(resolve, FLIP_MS)),
      ]);
      playSuccessHaptic();
      beat.set(
        withTiming(2, {
          duration: LEAVE_MS,
          easing: Easing.bezier(0.55, 0, 0.85, 0.4),
          reduceMotion: ReduceMotion.Never,
        })
      );
      draft.body = '';
      draft.email = '';
      setSentTo(replyTo);
      leave.current = setTimeout(() => {
        setBody('');
        setEmailOpen(false);
        setEmail('');
        setStage('sent');
      }, LEAVE_MS);
    } catch (error) {
      setEmailError(localizedFieldErrors(error).reply_email);
      beat.set(withTiming(0, { duration: FLIP_MS, reduceMotion: ReduceMotion.Never }));
      setStage(sendFailure(error));
    } finally {
      locked.current = false;
    }
  };

  const title = (
    <PidroText
      accessibilityRole="header"
      style={[
        styles.title,
        small && styles.titleSmall,
        tablet && styles.titleTablet,
        landscape && styles.titleLandscape,
      ]}>
      {t(stage === 'sent' ? 'tell.thanks' : 'tell.title')}
    </PidroText>
  );
  const alert =
    stage === 'failed' || refused ? (
      <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name="alert" size={20} strokeWidth={2.4} color={PidroColors.danger} />
        <PidroText role="body" style={styles.alertText}>
          {t(
            stage === 'limit' ? 'tell.limit' : stage === 'account' ? 'tell.account' : 'tell.failed'
          )}
        </PidroText>
      </View>
    ) : null;
  const reply = refused ? null : emailOpen ? (
    <Input
      label={t('tell.email')}
      value={email}
      onChangeText={(value) => {
        setEmail(value);
        draft.email = value;
        setEmailError(undefined);
      }}
      error={emailError}
      compact={landscape}
      editable={!sending}
      keyboardType="email-address"
      autoComplete="email"
      textContentType="emailAddress"
      autoCapitalize="none"
      autoCorrect={false}
      testID="feedback-email"
    />
  ) : accountEmail ? (
    <View style={styles.reply}>
      <Icon name="mail" size={18} color={PidroColors.cyanText} />
      <PidroText
        role="label"
        tone="soft"
        numberOfLines={landscape ? 2 : 1}
        style={styles.replyText}>
        {t('tell.reply', { email: accountEmail })}
      </PidroText>
      <TextLink
        label={t('tell.change')}
        size={15}
        accessibilityRole="button"
        onPress={() => {
          setEmail(accountEmail);
          setEmailOpen(true);
        }}
        style={styles.tight}
      />
    </View>
  ) : (
    <TextLink
      label={t('tell.addEmail')}
      size={15}
      accessibilityRole="button"
      onPress={() => setEmailOpen(true)}
      style={[styles.tight, styles.addEmail]}
    />
  );
  const mailApp =
    stage !== 'failed' ? null : mailFailed ? (
      <PidroText role="label" tone="cyan" align="center" selectable style={styles.address}>
        {FEEDBACK_EMAIL}
      </PidroText>
    ) : (
      <TextLink
        label={t('tell.mailApp')}
        size={15}
        accessibilityRole="button"
        onPress={async () => setMailFailed(!(await openFeedbackMail(body)))}
        style={[styles.tight, landscape && styles.addEmail]}
      />
    );
  const sendButton = (
    <BevelButton
      testID="feedback-send"
      label={t(
        stage === 'limit' ? 'tell.limitButton' : stage === 'failed' ? 'tell.retry' : 'tell.send'
      )}
      fullWidth={!landscape}
      disabled={!body.trim() || refused || sending}
      onPress={() => void send()}
      style={landscape && styles.sendLandscape}
    />
  );
  const note = (
    <Animated.View style={[styles.cardBox, card]}>
      <Animated.View
        style={[styles.note, tablet && styles.noteTablet, focused && styles.noteFocused, face]}>
        {showChip ? (
          <View style={styles.chip}>
            {post ? (
              <Icon name="reply" size={14} strokeWidth={2.6} color={PidroNote.chipInk} />
            ) : null}
            <PidroText role="label" numberOfLines={1} style={styles.chipText}>
              {post ? post.title : t('tell.chip')}
            </PidroText>
          </View>
        ) : null}
        <TextInput
          ref={ink}
          testID="feedback-body"
          multiline
          value={body}
          onChangeText={(value) => {
            setBody(value);
            draft.body = value;
          }}
          editable={!sending}
          placeholder={t('tell.placeholder')}
          placeholderTextColor={PidroNote.placeholder}
          accessibilityLabel={t('tell.ask')}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxFontSizeMultiplier={1.6}
          style={[
            styles.ink,
            (small || landscape) && styles.inkSmall,
            tablet && styles.inkTablet,
            Platform.OS === 'web' && styles.inkWeb,
          ]}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.note, styles.back, back]} />
    </Animated.View>
  );
  const dismiss = (
    <DismissButton accessibilityLabel={t('profile.close')} disabled={sending} onPress={close} />
  );

  let content;
  if (stage === 'sent') {
    content = (
      <Animated.View
        entering={FadeIn.duration(220).reduceMotion(ReduceMotion.Never)}
        accessibilityLiveRegion="polite"
        style={styles.sent}>
        <View style={styles.sentCopy}>
          {title}
          <PidroText role="body" tone="soft">
            {sentTo ? t('tell.afterEmail', { email: sentTo }) : t('tell.afterNone')}
          </PidroText>
        </View>
        <BevelButton label={t('tell.done')} fullWidth onPress={close} />
      </Animated.View>
    );
  } else if (landscape) {
    content = (
      <View style={styles.columns}>
        <View style={styles.words}>
          {title}
          {alert ?? (
            <PidroText role="body" tone="soft" style={styles.askLandscape}>
              {t('tell.ask')}
            </PidroText>
          )}
          <Animated.View style={[styles.wordsFoot, rest]}>
            {mailApp}
            {reply}
          </Animated.View>
        </View>
        {note}
        <View style={styles.side}>
          {dismiss}
          <Animated.View style={rest}>{sendButton}</Animated.View>
        </View>
      </View>
    );
  } else {
    content = (
      <>
        <View style={styles.head}>
          <View style={styles.headCopy}>
            {title}
            <PidroText
              role="body"
              tone="soft"
              style={[small && styles.askSmall, tablet && styles.askTablet]}>
              {t('tell.ask')}
            </PidroText>
          </View>
          {dismiss}
        </View>
        {note}
        <Animated.View style={[styles.foot, small && styles.footSmall, rest]}>
          {alert}
          {reply}
          {mailApp}
          {sendButton}
          {(stage === 'write' || sending) && !emailOpen && !keyboard ? (
            <PidroText role="metadata" tone="soft" align="center">
              {t('tell.fine')}
            </PidroText>
          ) : null}
        </Animated.View>
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
      // The sheet lands first; then the box takes focus and the keyboard rises. On web a
      // moment later, once a sheet under it (News) has handed over focus.
      onShow={() => {
        if (stage === 'write')
          setTimeout(() => ink.current?.focus(), Platform.OS === 'web' ? 50 : 0);
      }}
      onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityLabel={t('profile.close')}
            disabled={sending}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <KeyboardAvoidingView
            pointerEvents="box-none"
            style={[styles.keyboard, tablet && styles.keyboardTablet]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View
              testID="feedback-sheet"
              accessibilityViewIsModal
              style={[
                styles.sheet,
                small && styles.sheetSmall,
                tablet && styles.sheetTablet,
                landscape && styles.sheetLandscape,
                stage === 'sent' && styles.sheetSent,
              ]}>
              {landscape ? null : <View style={styles.grabber} />}
              {content}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PidroColors.backdrop },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  // On iPad the sheet floats in the middle and rises with the keyboard.
  keyboardTablet: { justifyContent: 'center', padding: PidroSpacing.lg },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    height: 520,
    maxHeight: '100%',
    flexShrink: 1,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: PidroSpacing.md,
    gap: PidroSpacing.sm,
  },
  sheetSmall: { height: 430, paddingHorizontal: PidroSpacing.md, gap: PidroSpacing.xs },
  sheetTablet: {
    maxWidth: 540,
    height: 600,
    borderRadius: PidroRadii.lg,
    borderBottomWidth: 1,
    paddingHorizontal: 28,
    paddingBottom: 28,
    gap: PidroSpacing.md,
  },
  sheetLandscape: {
    maxWidth: 760,
    height: 260,
    paddingHorizontal: PidroSpacing.md,
    paddingVertical: 10,
  },
  sheetSent: { height: 'auto' },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    flexShrink: 0,
    backgroundColor: PidroColors.borderStrong,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: PidroSpacing.sm, flexShrink: 0 },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 26,
    lineHeight: 32,
    color: PidroBevel.textGold,
  },
  titleSmall: { fontSize: 24, lineHeight: 30 },
  titleTablet: { fontSize: 30, lineHeight: 37 },
  titleLandscape: { fontSize: 21, lineHeight: 26 },
  askSmall: { fontSize: 15, lineHeight: 21 },
  askTablet: { fontSize: 18, lineHeight: 25 },
  askLandscape: { fontSize: 15, lineHeight: 20 },
  // The card is what gives way on a tight screen, never Send.
  cardBox: { flex: 1, minHeight: 0 },
  note: {
    ...StyleSheet.absoluteFill,
    gap: PidroSpacing.xxs,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PidroNote.edge,
    backgroundColor: PidroNote.face,
    boxShadow: PidroNote.shadow,
    paddingVertical: PidroSpacing.sm,
    paddingHorizontal: 14,
    backfaceVisibility: 'hidden',
  },
  noteTablet: { paddingVertical: PidroSpacing.md, paddingHorizontal: 18 },
  noteFocused: { boxShadow: PidroNote.focusShadow },
  back: {
    borderWidth: 3,
    borderColor: PidroNote.backEdge,
    boxShadow: PidroNote.backShadow,
    ...gradientBg(PidroNote.backGradient),
  },
  chip: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    maxWidth: '100%',
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroNote.chip,
  },
  chipText: { flexShrink: 1, fontSize: 13, lineHeight: 17, color: PidroNote.chipInk },
  ink: {
    flex: 1,
    minHeight: 0,
    padding: 0,
    margin: 0,
    textAlignVertical: 'top',
    fontFamily: PidroFonts.ui,
    fontWeight: '700',
    fontSize: 19,
    lineHeight: 27,
    color: PidroNote.ink,
  },
  inkSmall: { fontSize: 18, lineHeight: 25 },
  inkTablet: { fontSize: 21, lineHeight: 30 },
  inkWeb: { outlineStyle: 'none' } as object,
  foot: { flexShrink: 0, gap: PidroSpacing.sm },
  footSmall: { gap: PidroSpacing.xs },
  reply: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs, minHeight: 28 },
  replyText: { flex: 1, minWidth: 0, fontWeight: '700' },
  // The link keeps its 44pt target without making the line that tall.
  tight: { marginVertical: -8, paddingHorizontal: PidroSpacing.xxs },
  addEmail: { alignSelf: 'flex-start' },
  address: { paddingVertical: PidroSpacing.xxs },
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
  alertText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  sent: { gap: PidroSpacing.md, paddingTop: PidroSpacing.xxs },
  sentCopy: { gap: 6 },
  columns: { flex: 1, flexDirection: 'row', gap: 14 },
  words: { width: 230, flexShrink: 0, gap: 2 },
  wordsFoot: { marginTop: 'auto', gap: PidroSpacing.xxs },
  side: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'space-between' },
  sendLandscape: { minWidth: 104 },
});
