import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
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
  /** Typing (PID-318): an adult types, a guest is asked to make an account. */
  typing?: 'type' | 'guest' | null;
  draft?: string;
  onDraft?: (draft: string) => void;
  onSay?: () => Promise<'sent' | 'filtered' | 'failed'>;
  /** Who is seated with you and will not see what you type. */
  unread?: string[];
  onAccount?: () => void;
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
          style={[styles.safe, wide && styles.safeWide]}
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
            style={wide ? styles.keyboardWide : styles.keyboard}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View
              testID={`talk-sheet-${sheet}`}
              accessibilityViewIsModal
              onAccessibilityEscape={blocking ? cancelBlock : close}
              accessibilityLabel={label}
              style={[styles.sheet, wide && styles.sheetWide]}>
              {wide ? null : <View style={styles.grabber} />}
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
                  <PidroText role="metadata" tone="soft" testID="talk-unread">
                    {unread.length === 0
                      ? t('talk.typed_all')
                      : t(unread.length === 1 ? 'talk.typed_except' : 'talk.typed_except_many', {
                          names:
                            unread.length === 1
                              ? unread[0]
                              : `${unread.slice(0, -1).join(', ')} ${t('talk.and')} ${unread.at(-1)}`,
                        })}
                  </PidroText>
                  <View style={styles.field}>
                    <Input
                      ref={draftBox}
                      testID="talk-draft"
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
                      error={filtered ? t('talk.filtered') : undefined}
                      containerClassName="w-auto flex-1"
                    />
                    <BevelButton
                      testID="talk-say"
                      label={t('talk.send')}
                      loading={busy}
                      disabled={!draft.trim()}
                      onPress={() => void sendDraft()}
                    />
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
                    {log.map((said, i) => {
                      const { name, color } = who(said);
                      return (
                        <PidroText key={i} role="body" style={styles.line}>
                          <PidroText role="body" style={[styles.lineWho, { color }]}>
                            {name}
                          </PidroText>{' '}
                          {talkText(said)}
                        </PidroText>
                      );
                    })}
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
                  {typing === 'type' ? (
                    <TalkBand
                      place="band"
                      line={null}
                      lineName=""
                      draft={draft}
                      prompt={t('talk.type')}
                      testID="talk-type"
                      onOpen={() => onOpen('typing')}
                    />
                  ) : typing === 'guest' && onAccount ? (
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
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: PidroSpacing.xs },
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
