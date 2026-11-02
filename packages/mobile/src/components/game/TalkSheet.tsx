import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextInput,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { localizedError } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import { SAY_MAX, TALK_COINS, TALK_WORDS, type Said, type TalkItem } from '@/features/game/talk';
import type { ReportReason, TalkSheet as Sheet } from '@/game/useTableTalk';
import { t, useTranslation } from '@/i18n';
import { TalkBand, TalkCoin, TalkWord, talkText } from './TableTalk';

/**
 * The hand of words, and what was said this game. A sheet from below, as
 * FriendSheet is; in landscape it comes in from the right. The table stays
 * visible above it, and a tap outside closes it.
 */
export function TalkSheet({
  sheet,
  log,
  who,
  onSend,
  onOpen,
  person,
  onHush,
  onReport,
  onBlock,
  typing,
  draft = '',
  onDraft,
  onSay,
  unread = [],
  onAccount,
  onDock,
}: {
  sheet: Sheet | null;
  log: Said[];
  who: (said: Said) => { name: string; color: string };
  onSend: (item: TalkItem) => void;
  onOpen: (sheet: Sheet | null) => void;
  /** The face tapped (PID-329), and what you may do about them. */
  person?: { name: string; avatar?: string | null; quiet: boolean; canBlock: boolean };
  onHush?: () => void;
  onReport?: (reason: ReportReason) => Promise<void>;
  onBlock?: () => Promise<void>;
  /** PID-318: a guest is asked to make an account; an adult's band opens the composer. */
  typing?: 'type' | 'guest' | null;
  draft?: string;
  onDraft?: (draft: string) => void;
  onSay?: () => Promise<'sent' | 'filtered' | 'failed'>;
  /** Who is seated with you and will not see what you type. */
  unread?: string[];
  onAccount?: () => void;
  /** Where the docked composer's top edge sits on screen, so the table can fit above it. */
  onDock?: (top: number) => void;
}) {
  useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const [busy, setBusy] = useState(false);
  // A report or block on its way holds the sheet: nothing closes it under the answer.
  const locked = useRef(false);
  const draftBox = useRef<TextInput>(null);
  const sheetBox = useRef<View>(null);
  // iOS presents the account sheet only once this one has gone.
  const handoff = useRef(false);
  const close = () => {
    if (!locked.current) onOpen(null);
  };
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filtered, setFiltered] = useState(false);
  // Each opening starts clean.
  const [opened, setOpened] = useState(sheet);
  if (sheet !== opened) {
    setOpened(sheet);
    setBlocking(false);
    setError(null);
    setFiltered(false);
  }
  // Refused words stay in the box, and say so; a send that fails stays quietly.
  const sendDraft = async () => {
    if (locked.current || !onSay || !draft.trim()) return;
    locked.current = true;
    setBusy(true);
    const result = await onSay();
    locked.current = false;
    setBusy(false);
    setFiltered(result === 'filtered');
    if (result === 'filtered') AccessibilityInfo.announceForAccessibility(t('talk.filtered'));
  };
  const run = async (action: () => Promise<void>, next: Sheet | null) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpen(next);
    } catch (caught) {
      setError(caught ?? true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const cancelBlock = () => {
    setBlocking(false);
    setError(null);
  };
  // Typing docks to the keyboard, a bar and no card, as a chat app's composer does.
  const docked = sheet === 'typing';
  const side = wide && !docked;
  const lines = (said: Said[]) =>
    said.map((one, i) => {
      const { name, color } = who(one);
      return (
        <PidroText key={i} role="body" style={styles.line}>
          <PidroText role="body" style={[styles.lineWho, { color }]}>
            {name}
          </PidroText>{' '}
          {talkText(one)}
        </PidroText>
      );
    });
  const label =
    sheet === 'log'
      ? t('talk.title')
      : sheet === 'words'
        ? t('talk.say')
        : sheet === 'typing'
          ? t('talk.type')
          : sheet === 'report'
            ? t('talk.report_title')
            : sheet === 'reported'
              ? t('talk.reported')
              : person?.name;
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={sheet != null}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : wide ? 'fade' : 'slide'}
      onRequestClose={close}
      // Straight from the band, the box focuses once the sheet has landed.
      onShow={() => sheet === 'typing' && draftBox.current?.focus()}
      onDismiss={() => {
        if (!handoff.current) return;
        handoff.current = false;
        onAccount?.();
      }}>
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.safe, side && styles.safeWide, docked && styles.safeDocked]}
          edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.close')}
            disabled={busy}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <KeyboardAvoidingView
            pointerEvents="box-none"
            style={side ? styles.keyboardWide : styles.keyboard}
            // This modal draws under the system bars, so Android will not resize it for us.
            behavior="padding">
            <View
              ref={sheetBox}
              onLayout={() =>
                docked && sheetBox.current?.measureInWindow((_x, top) => onDock?.(top))
              }
              testID={`talk-sheet-${sheet}`}
              accessibilityViewIsModal
              onAccessibilityEscape={blocking ? cancelBlock : close}
              accessibilityLabel={label}
              style={[styles.sheet, side && styles.sheetWide, docked && styles.composer]}>
              {wide || docked ? null : <View style={styles.grabber} />}
              {sheet === 'person' && person ? (
                <>
                  <View style={styles.who}>
                    <PlayerAvatar uri={person.avatar ?? undefined} size={56} />
                    <PidroText role="title" accessibilityRole="header" style={styles.whoName}>
                      {person.name}
                    </PidroText>
                  </View>
                  {blocking ? (
                    <>
                      <PidroText role="label" accessibilityRole="header">
                        {t('friend_sheet.block_title', { name: person.name })}
                      </PidroText>
                      <PidroText role="body">
                        {t('friend_sheet.block_body', { name: person.name })}
                      </PidroText>
                      {error ? (
                        <PidroText role="body" tone="danger" accessibilityRole="alert">
                          {localizedError(error, 'blocks.block_failed')}
                        </PidroText>
                      ) : null}
                      <BevelButton
                        testID="talk-block-confirm"
                        label={t('blocks.block')}
                        fullWidth
                        loading={busy}
                        onPress={() => onBlock && void run(onBlock, null)}
                      />
                      <BevelButton
                        label={t('common.cancel')}
                        material="glass"
                        fullWidth
                        disabled={busy}
                        onPress={cancelBlock}
                      />
                    </>
                  ) : (
                    <>
                      <PersonAction
                        testID="talk-quiet"
                        label={t(person.quiet ? 'talk.unquiet' : 'talk.quiet')}
                        onPress={() => {
                          onHush?.();
                          close();
                        }}
                      />
                      <PersonAction
                        testID="talk-report"
                        label={t('talk.report')}
                        onPress={() => onOpen('report')}
                      />
                      {person.canBlock ? (
                        <PersonAction
                          testID="talk-block"
                          label={t('friend_sheet.block', { name: person.name })}
                          warn
                          onPress={() => setBlocking(true)}
                        />
                      ) : null}
                    </>
                  )}
                </>
              ) : sheet === 'report' ? (
                <>
                  <PidroText role="title" accessibilityRole="header">
                    {t('talk.report_title')}
                  </PidroText>
                  {(['rude', 'bothering', 'other'] as const).map((reason) => (
                    <BevelButton
                      key={reason}
                      testID={`talk-report-${reason}`}
                      label={t(`talk.report_${reason}`)}
                      material="glass"
                      fullWidth
                      disabled={busy}
                      onPress={() => onReport && void run(() => onReport(reason), 'reported')}
                    />
                  ))}
                  {error ? (
                    <PidroText role="body" tone="danger" accessibilityRole="alert">
                      {t('talk.report_failed')}
                    </PidroText>
                  ) : null}
                </>
              ) : sheet === 'reported' ? (
                <>
                  <PidroText role="body" accessibilityRole="alert">
                    {t('talk.reported')}
                  </PidroText>
                  <BevelButton label={t('profile.close')} fullWidth onPress={close} />
                </>
              ) : sheet === 'typing' ? (
                <>
                  {log.length > 0 && !wide ? (
                    <ScrollView
                      ref={scroll}
                      style={styles.recent}
                      contentContainerStyle={styles.recentLines}
                      keyboardShouldPersistTaps="always"
                      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
                      {lines(log)}
                    </ScrollView>
                  ) : null}
                  {/* One tap says it, keyboard up or not. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    style={styles.quick}
                    contentContainerStyle={styles.quickRow}>
                    {TALK_COINS.map((item) => (
                      <TalkCoin key={item} item={item} size={44} onPress={() => onSend(item)} />
                    ))}
                    {TALK_WORDS.map((item) => (
                      <TalkWord
                        key={item}
                        item={item}
                        onPress={() => onSend(item)}
                        style={styles.quickWord}
                      />
                    ))}
                  </ScrollView>
                  {unread.length > 0 ? (
                    <PidroText role="metadata" tone="soft" testID="talk-unread">
                      {t(unread.length === 1 ? 'talk.typed_except' : 'talk.typed_except_many', {
                        names:
                          unread.length === 1
                            ? unread[0]
                            : `${unread.slice(0, -1).join(', ')} ${t('talk.and')} ${unread.at(-1)}`,
                      })}
                    </PidroText>
                  ) : null}
                  {filtered ? (
                    <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                      {t('talk.filtered')}
                    </PidroText>
                  ) : null}
                  <View style={styles.field}>
                    <Input
                      ref={draftBox}
                      testID="talk-draft"
                      compact
                      autoFocus
                      editable={!busy}
                      submitBehavior="submit"
                      value={draft}
                      maxLength={SAY_MAX}
                      placeholder={t('talk.type')}
                      accessibilityLabel={t('talk.type')}
                      returnKeyType="send"
                      onSubmitEditing={() => void sendDraft()}
                      onChangeText={(text) => {
                        setFiltered(false);
                        onDraft?.(text);
                      }}
                      containerClassName="w-auto flex-1"
                    />
                    <PressableFX
                      testID="talk-say"
                      accessibilityRole="button"
                      accessibilityLabel={t('talk.send')}
                      accessibilityState={{ disabled: !draft.trim() || busy, busy }}
                      disabled={!draft.trim() || busy}
                      onPress={() => void sendDraft()}
                      style={[styles.send, !draft.trim() && styles.sendEmpty]}>
                      {busy ? (
                        <ActivityIndicator color={PidroColors.leagueCardInk} />
                      ) : (
                        <View style={styles.sendArrow}>
                          <Icon
                            name="arrow-left"
                            size={20}
                            strokeWidth={2.6}
                            color={draft.trim() ? PidroColors.leagueCardInk : PidroColors.textMuted}
                          />
                        </View>
                      )}
                    </PressableFX>
                  </View>
                </>
              ) : sheet === 'log' ? (
                <>
                  <ScrollView
                    ref={scroll}
                    style={styles.log}
                    contentContainerStyle={styles.logLines}
                    // The newest line first in view.
                    onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
                    {lines(log)}
                  </ScrollView>
                  <PidroText role="metadata" tone="soft">
                    {t('talk.only_this_game')}
                  </PidroText>
                  <TalkBand place="band" line={null} lineName="" onOpen={() => onOpen('words')} />
                </>
              ) : (
                <>
                  <View style={styles.coins}>
                    {TALK_COINS.map((item) => (
                      <TalkCoin
                        key={item}
                        item={item}
                        size={wide ? 52 : 58}
                        onPress={() => onSend(item)}
                      />
                    ))}
                  </View>
                  {[0, 3, 6].map((row) => (
                    <View key={row} style={styles.words}>
                      {TALK_WORDS.slice(row, row + 3).map((item, i) => (
                        <TalkWord
                          key={item}
                          item={item}
                          index={row + i}
                          onPress={() => onSend(item)}
                          style={[styles.wordCard, { height: wide ? 52 : 60 }]}
                        />
                      ))}
                    </View>
                  ))}
                  {typing === 'guest' && onAccount ? (
                    <View style={styles.guest}>
                      <PidroText role="metadata" tone="soft">
                        {t('talk.guest_type')}
                      </PidroText>
                      <TextLink
                        testID="talk-account"
                        label={t('talk.guest_account')}
                        size={14}
                        onPress={() => {
                          if (Platform.OS === 'ios') handoff.current = true;
                          close();
                          if (Platform.OS !== 'ios') onAccount();
                        }}
                      />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** One plain line on the person sheet: a big target, no icon. */
function PersonAction({
  label,
  warn,
  testID,
  onPress,
}: {
  label: string;
  warn?: boolean;
  testID: string;
  onPress: () => void;
}) {
  return (
    <PressableFX
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.act}
      pressedStyle={styles.actPressed}
      onPress={onPress}>
      <PidroText role="label" style={warn && styles.warn}>
        {label}
      </PidroText>
    </PressableFX>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.screenScrim },
  // The table stays bright above the composer: it is still the thing to watch.
  safeDocked: { backgroundColor: 'transparent' },
  safeWide: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'stretch' },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: PidroSpacing.lg,
    gap: PidroSpacing.sm,
  },
  sheetWide: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    width: 380,
    borderRadius: PidroRadii.lg,
    paddingTop: PidroSpacing.md,
    paddingBottom: PidroSpacing.md,
    margin: PidroSpacing.xs,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  coins: { flexDirection: 'row', justifyContent: 'space-between' },
  words: { flexDirection: 'row', gap: PidroSpacing.xs },
  wordCard: { flex: 1 },
  log: { flexGrow: 0, maxHeight: 260 },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  // In landscape the sheet stands full height at the right.
  keyboardWide: { alignSelf: 'stretch' },
  composer: {
    alignSelf: 'stretch',
    maxWidth: undefined,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: PidroColors.borderStrong,
    paddingHorizontal: PidroSpacing.sm,
    paddingTop: PidroSpacing.xs,
    paddingBottom: PidroSpacing.xs,
    gap: PidroSpacing.xs,
  },
  recent: { flexGrow: 0, maxHeight: 76 },
  recentLines: { gap: 4 },
  quick: { flexGrow: 0, marginHorizontal: -PidroSpacing.sm },
  quickRow: { alignItems: 'center', gap: PidroSpacing.xs, paddingHorizontal: PidroSpacing.sm },
  quickWord: { height: PidroLayout.touchTarget, paddingHorizontal: PidroSpacing.sm },
  field: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  send: {
    width: PidroLayout.touchTarget,
    height: PidroLayout.touchTarget,
    borderRadius: PidroLayout.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroColors.gold,
  },
  sendEmpty: { backgroundColor: PidroColors.actionPill },
  // Icon draws one arrow; pointing up reads as send.
  sendArrow: { transform: [{ rotate: '90deg' }] },
  guest: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: PidroSpacing.xs,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm },
  whoName: { flex: 1 },
  act: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: PidroRadii.panel,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.actionPill,
  },
  actPressed: { backgroundColor: PidroColors.actionPillPressed },
  warn: { color: PidroColors.danger },
  logLines: { gap: 10 },
  line: { fontWeight: '700' },
  lineWho: { fontWeight: '900' },
});
