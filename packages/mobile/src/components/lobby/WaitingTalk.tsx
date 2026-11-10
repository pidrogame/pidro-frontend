import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextInput,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { TalkCoin, talkText } from '@/components/game/TableTalk';
import { OpenChair } from '@/components/lobby/OpenChair';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import {
  isCoin,
  onlyEmoji,
  SAY_MAX,
  TALK_COINS,
  TALK_EMOJI,
  type Said,
  type TalkItem,
} from '@/features/game/talk';
import type { SeatToken } from '@/features/lobby/seatRow';
import { useTranslation } from '@/i18n';
import { isStillCapture } from '@/utils/stillCapture';
import { SeatFace } from './SeatRow';

/** The waiting room's talk (PID-418): the room's lines and the two ways to add one. */
export interface WaitingTalk {
  /** A fixture's own lines; the app reads the room's talk from the channel. */
  lines?: Said[];
  typing: 'type' | 'guest' | null;
  send: (item: TalkItem) => void;
  /** Rejects as the channel does: `{ error: 'filtered' }` keeps the draft and says so. */
  say: (text: string) => Promise<unknown>;
  /** Fixtures: seat lines already heard, each after this many lines of talk. */
  heard?: { at: number; text: string }[];
  draft?: string;
}

/** A line as the column shows it: who said what, or a quiet seat line. */
export type WaitingLine = { key: string; said?: Said; quiet?: string };

/** The fold eases in from below and is a cut under Reduce Motion. */
export function useFold() {
  const calm = useReducedMotion() || isStillCapture();
  return calm ? undefined : FadeInUp.duration(220).easing(Easing.out(Easing.cubic));
}

/**
 * Newest at the bottom, older lines fading out at the top edge as they scroll up.
 * `few`: a landscape phone's last lines beside the action, as tall as they are.
 */
export function TalkLines({
  lines,
  who,
  few = false,
}: {
  lines: WaitingLine[];
  who: (said: Said) => { name: string; ours: boolean };
  few?: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const [top, setTop] = useState(0);
  const [ys, setYs] = useState<Record<string, number>>({});
  const Column = few ? View : ScrollView;
  return (
    <Column
      ref={few ? undefined : scroll}
      testID="waiting-talk"
      style={few ? styles.linesContent : styles.lines}
      contentContainerStyle={styles.linesContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScroll={(event) => setTop(event.nativeEvent.contentOffset.y)}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
      {lines.map(({ key, said, quiet }) => {
        const below = few ? FADE : (ys[key] ?? FADE) - top;
        const fade = { opacity: Math.min(1, 0.45 + Math.max(0, below) / FADE) };
        const onLayout = (y: number) => setYs((previous) => ({ ...previous, [key]: y }));
        if (!said)
          return (
            <PidroText
              key={key}
              role="metadata"
              tone="soft"
              style={fade}
              onLayout={(event) => onLayout(event.nativeEvent.layout.y)}>
              {quiet}
            </PidroText>
          );
        const { name, ours } = who(said);
        const big = isCoin(said.item) || onlyEmoji(said.text);
        return (
          <PidroText
            key={key}
            role="body"
            style={[styles.line, big && styles.big, fade]}
            onLayout={(event) => onLayout(event.nativeEvent.layout.y)}>
            <PidroText role="body" style={[styles.who, ours && styles.ours]}>
              {name}
            </PidroText>
            {'  '}
            <PidroText role="body" style={[styles.line, big && styles.big]}>
              {isCoin(said.item) ? TALK_EMOJI[said.item] : talkText(said)}
            </PidroText>
          </PidroText>
        );
      })}
    </Column>
  );
}

/** How far below the top edge a line is fully there. */
const FADE = 56;

/** The five faces; one tap says it. */
export function TalkEmoji({
  onSend,
  inline = false,
}: {
  onSend: (item: TalkItem) => void;
  inline?: boolean;
}) {
  return (
    <View testID="waiting-talk-emoji" style={[styles.emoji, inline && styles.emojiInline]}>
      {TALK_COINS.map((item) => (
        <TalkCoin key={item} item={item} size={44} onPress={() => onSend(item)} />
      ))}
    </View>
  );
}

/** The field and, while typing, its round send button. Enter sends too. */
export function TalkField({
  talk,
  send,
  onFocus,
  style,
}: {
  talk: WaitingTalk;
  send: boolean;
  onFocus?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(talk.draft ?? '');
  const [busy, setBusy] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const box = useRef<TextInput>(null);
  const ready = !!draft.trim() && !busy;
  // Refused words stay in the field, as at the table.
  const say = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await talk.say(draft.trim());
      setDraft('');
    } catch (error: unknown) {
      if ((error as { error?: string } | null)?.error === 'filtered') {
        setFiltered(true);
        AccessibilityInfo.announceForAccessibility(t('talk.filtered'));
      }
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  };
  return (
    <View style={[styles.fieldColumn, style]}>
      {filtered ? (
        <PidroText role="metadata" tone="danger" accessibilityRole="alert">
          {t('talk.filtered')}
        </PidroText>
      ) : null}
      <View style={styles.field}>
        <Input
          ref={box}
          testID="waiting-talk-field"
          compact
          submitBehavior="submit"
          value={draft}
          maxLength={SAY_MAX}
          placeholder={t('talk.say')}
          accessibilityLabel={t('talk.say')}
          returnKeyType="send"
          onFocus={onFocus}
          onSubmitEditing={() => void say()}
          onChangeText={(text) => {
            setFiltered(false);
            setDraft(text);
          }}
          containerClassName="w-auto flex-1"
        />
        {send ? (
          <PressableFX
            testID="waiting-talk-send"
            accessibilityRole="button"
            accessibilityLabel={t('talk.send')}
            accessibilityState={{ disabled: !ready, busy }}
            disabled={!ready}
            onPress={() => void say()}
            style={[styles.send, !draft.trim() && styles.sendEmpty]}>
            {busy ? (
              <ActivityIndicator color={PidroColors.leagueCardInk} />
            ) : (
              <View style={styles.arrow}>
                <Icon
                  name="arrow-left"
                  size={20}
                  strokeWidth={2.6}
                  color={draft.trim() ? PidroColors.leagueCardInk : PidroColors.textMuted}
                />
              </View>
            )}
          </PressableFX>
        ) : null}
      </View>
    </View>
  );
}

/** The rows folded into four faces, your team first; a tap unfolds them. */
export function SeatStrip({ faces, onPress }: { faces: SeatToken[]; onPress: () => void }) {
  const { t } = useTranslation();
  const fold = useFold();
  const face = (token: SeatToken, i: number) =>
    token.kind === 'open' ? <OpenChair key={i} size={44} /> : <SeatFace key={i} token={token} />;
  return (
    <Animated.View entering={fold}>
      <PressableFX
        testID="waiting-seat-strip"
        accessibilityRole="button"
        accessibilityLabel={t('waiting_talk.seats')}
        onPress={onPress}
        style={styles.strip}>
        {faces.slice(0, 2).map(face)}
        <PidroText role="label" tone="muted">
          {t('social.vs')}
        </PidroText>
        {faces.slice(2).map((token, i) => face(token, i + 2))}
      </PressableFX>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lines: { flex: 1, minHeight: 0 },
  linesContent: { flexGrow: 1, justifyContent: 'flex-end', gap: 10 },
  line: { color: PidroColors.text, fontWeight: '600' },
  big: { fontSize: 30, lineHeight: 38 },
  who: { color: PidroColors.text, fontWeight: '900' },
  ours: { color: PidroBevel.textGold },
  emoji: { flexDirection: 'row', justifyContent: 'space-between' },
  emojiInline: { justifyContent: 'flex-start', gap: PidroSpacing.xs },
  fieldColumn: { alignSelf: 'stretch', gap: 4, flexShrink: 1, minWidth: 0 },
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
  arrow: { transform: [{ rotate: '90deg' }] },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: PidroSpacing.sm,
    minHeight: PidroLayout.touchTarget,
  },
});
