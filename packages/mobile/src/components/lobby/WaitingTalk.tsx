import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextInput,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { TranslationKey } from '@pidro/shared';
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
  talkName,
  talkRefusal,
  TALK_COINS,
  TALK_EMOJI,
  type Position,
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
  /** Both reject as the channel does, and every refusal is said (PID-420). */
  send: (item: TalkItem) => Promise<unknown>;
  say: (text: string) => Promise<unknown>;
  /** Fixtures: seat lines already heard, each after this many lines of talk. */
  heard?: { at: number; text: string }[];
  draft?: string;
}

/** A line as the column shows it: who said what, or a quiet seat line. */
export type WaitingLine = { key: string; said?: Said; quiet?: string };

/** Motion is a cut under Reduce Motion and while UI grammar captures. */
function useCalm() {
  const reduced = useReducedMotion();
  return reduced || isStillCapture();
}

/** PID-420: out, with a quart's ease and no bounce. */
const EASE = Easing.out(Easing.poly(4));
const TRAVEL = { duration: 300, easing: EASE };

/** The layout that arrives fades in, the one that leaves fades out, while the faces travel. */
export function useFades() {
  const calm = useCalm();
  return calm
    ? {}
    : { entering: FadeIn.duration(200).easing(EASE), exiting: FadeOut.duration(160).easing(EASE) };
}

/**
 * Rises `from` points below its place to it as it mounts, fading in if `fade`: a new
 * line, a few points from the field, or the talk column, remounted with each fold, from
 * where the rows or the strip left it. Drawn there from its first frame; still when calm.
 */
export function Rise({
  from,
  fade = false,
  style,
  children,
  ...props
}: {
  from: number;
  fade?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
  onLayout?: ViewProps['onLayout'];
}) {
  const calm = useCalm();
  const y = useSharedValue(calm ? 0 : from);
  const shown = useSharedValue(fade && !calm ? 0 : 1);
  useEffect(() => {
    y.set(withTiming(0, TRAVEL));
    shown.set(withTiming(1, TRAVEL));
  }, [shown, y]);
  const risen = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: y.get() }],
  }));
  return (
    <Animated.View style={[style, risen]} {...props}>
      {children}
    </Animated.View>
  );
}

/** Where each seat's face was last laid out in the window, row or strip; each is used once. */
export type Spots = Record<string, { x: number; y: number; size: number }>;

/**
 * PID-420: on its first layout after `turn` changes (a fold or an unfold), travels
 * from where `from` was last laid out to its own place. A face also rings once in its
 * team's colour as `pulse` counts up. Transforms and opacity only; a cut when calm.
 */
export function Travel({
  spots,
  id,
  from,
  turn,
  pulse = 0,
  ring,
  children,
}: {
  spots: RefObject<Spots>;
  id: string;
  from: string;
  turn: number;
  pulse?: number;
  ring: string;
  children: ReactNode;
}) {
  const calm = useCalm();
  const view = useRef<View>(null);
  const travelled = useRef(0);
  // A face that arrives with a fold waits, unseen, for the place it travels from.
  const [waits] = useState(() => turn > 0 && !calm && !!spots.current[from]);
  const shown = useSharedValue(waits ? 0 : 1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const grow = useSharedValue(1);
  const moved = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));
  const ringed = useAnimatedStyle(() => ({
    opacity: glow.get(),
    transform: [{ scale: grow.get() }],
  }));
  const onLayout = () =>
    view.current?.measureInWindow((left, top, size) => {
      const start = spots.current[from];
      spots.current[id] = { x: left, y: top, size };
      if (turn <= travelled.current) return;
      travelled.current = turn;
      // A spot is travelled from once: a row remounting for another reason stays put.
      delete spots.current[from];
      if (!calm && start && size) {
        const go = (value: typeof x, at: number, to: number) =>
          value.set(withSequence(withTiming(at, { duration: 0 }), withTiming(to, TRAVEL)));
        go(x, start.x + start.size / 2 - (left + size / 2), 0);
        go(y, start.y + start.size / 2 - (top + size / 2), 0);
        go(scale, start.size / size, 1);
      }
      shown.set(1);
    });
  const heard = useRef(pulse);
  useEffect(() => {
    if (pulse === heard.current) return;
    heard.current = pulse;
    if (calm) {
      glow.set(
        withSequence(withTiming(1, { duration: 0 }), withDelay(600, withTiming(0, { duration: 0 })))
      );
      return;
    }
    grow.set(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(1.35, { duration: 320, easing: EASE })
      )
    );
    glow.set(
      withSequence(withTiming(0.9, { duration: 0 }), withTiming(0, { duration: 320, easing: EASE }))
    );
  }, [calm, glow, grow, pulse]);
  return (
    <Animated.View ref={view} onLayout={onLayout} style={moved}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: ring }, ringed]} />
    </Animated.View>
  );
}

/**
 * Oldest first, under the seats; newest at the bottom, older lines fading out at the
 * top edge as they scroll up.
 * `few`: a landscape phone's last lines beside the action, as tall as they are.
 * `hint`: the empty talk's one quiet line, at the bottom of the band.
 */
export function TalkLines({
  lines,
  who,
  hint,
  few = false,
}: {
  lines: WaitingLine[];
  who: (said: Said) => { name: string; ours: boolean };
  hint?: string;
  few?: boolean;
}) {
  const calm = useCalm();
  const scroll = useRef<ScrollView>(null);
  // The talk opens at its newest line; after that each new one rises and scrolls into view.
  const settled = useRef(false);
  const [there, setThere] = useState(() => ({ few, keys: new Set(lines.map(({ key }) => key)) }));
  // A landscape fold shows more of the talk: what it shows is there already.
  if (there.few !== few) setThere({ few, keys: new Set(lines.map(({ key }) => key)) });
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
      onContentSizeChange={() => {
        scroll.current?.scrollToEnd({ animated: settled.current && !calm });
        settled.current = true;
      }}>
      {lines.map(({ key, said, quiet }) => {
        // Only once lines have scrolled out above does the top edge fade.
        const below = few || top <= 0 ? FADE : (ys[key] ?? FADE) - top;
        const fade = { opacity: Math.min(1, 0.45 + Math.max(0, below) / FADE) };
        const { name, ours } = said ? who(said) : { name: '', ours: false };
        const short = talkName(name);
        const big = !!said && (isCoin(said.item) || onlyEmoji(said.text));
        return (
          <Rise
            key={key}
            from={there.keys.has(key) ? 0 : 10}
            fade={!there.keys.has(key)}
            testID={said ? 'waiting-talk-line' : undefined}
            onLayout={(event) => {
              const y = event.nativeEvent.layout.y;
              setYs((previous) => ({ ...previous, [key]: y }));
            }}>
            {!said ? (
              <PidroText role="metadata" tone="soft" style={fade}>
                {quiet}
              </PidroText>
            ) : big ? (
              // The emoji keeps its own line height, outside the name's text: iOS cuts a
              // big glyph that inherits a smaller one.
              <View accessible style={[styles.bigLine, fade]}>
                <PidroText
                  role="body"
                  numberOfLines={1}
                  style={[styles.who, styles.name, ours && styles.ours]}>
                  {short}
                </PidroText>
                <Text
                  testID="waiting-talk-emoji-line"
                  style={styles.big}
                  maxFontSizeMultiplier={1.3}>
                  {isCoin(said.item) ? TALK_EMOJI[said.item] : said.text}
                </Text>
              </View>
            ) : (
              <PidroText role="body" style={[styles.line, fade]}>
                <PidroText role="body" style={[styles.who, ours && styles.ours]}>
                  {short}
                </PidroText>
                {'  '}
                {talkText(said)}
              </PidroText>
            )}
          </Rise>
        );
      })}
      {hint ? (
        <PidroText testID="waiting-talk-hint" role="metadata" tone="soft" style={styles.hint}>
          {hint}
        </PidroText>
      ) : null}
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

/**
 * The field and, while typing, its round send button. Enter sends too. A refusal
 * keeps the draft and goes to `onRefused`, which says why; typing clears it.
 */
export function TalkField({
  talk,
  send,
  onFocus,
  onRefused,
  style,
}: {
  talk: WaitingTalk;
  send: boolean;
  onFocus?: () => void;
  onRefused: (line: TranslationKey | null) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(talk.draft ?? '');
  const [busy, setBusy] = useState(false);
  const box = useRef<TextInput>(null);
  const ready = !!draft.trim() && !busy;
  const say = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await talk.say(draft.trim());
      setDraft('');
      onRefused(null);
    } catch (error: unknown) {
      onRefused(talkRefusal(error));
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  };
  return (
    <View style={[styles.field, style]}>
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
          onRefused(null);
          setDraft(text);
        }}
        containerClassName="w-auto flex-1"
      />
      {send ? (
        // Empty, ready, busy and pressed each look their own.
        <PressableFX
          testID="waiting-talk-send"
          accessibilityRole="button"
          accessibilityLabel={t('talk.send')}
          accessibilityState={{ disabled: !ready, busy }}
          disabled={!ready}
          onPress={() => void say()}
          style={[styles.send, !draft.trim() && styles.sendEmpty, busy && styles.sendBusy]}
          pressedStyle={styles.sendPressed}>
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
  );
}

/** The rows folded into four faces, your team first; a tap unfolds them. Each face travels. */
export function SeatStrip({
  faces,
  onPress,
  spots,
  turn,
  pulses,
  onLayout,
}: {
  faces: { position: Position; token: SeatToken; ring: string }[];
  onPress: () => void;
  spots: RefObject<Spots>;
  turn: number;
  pulses: Partial<Record<Position, number>>;
  onLayout?: ViewProps['onLayout'];
}) {
  const { t } = useTranslation();
  const fades = useFades();
  const face = ({ position, token, ring }: (typeof faces)[number]) => (
    <Travel
      key={position}
      spots={spots}
      id={`strip:${position}`}
      from={`row:${position}`}
      turn={turn}
      pulse={pulses[position]}
      ring={ring}>
      {token.kind === 'open' ? <OpenChair size={44} /> : <SeatFace token={token} />}
    </Travel>
  );
  return (
    <Animated.View exiting={fades.exiting} onLayout={onLayout}>
      <PressableFX
        testID="waiting-seat-strip"
        accessibilityRole="button"
        accessibilityLabel={t('waiting_talk.seats')}
        onPress={onPress}
        style={styles.strip}>
        {faces.slice(0, 2).map(face)}
        <Animated.View entering={fades.entering}>
          <PidroText role="label" tone="muted">
            {t('social.vs')}
          </PidroText>
        </Animated.View>
        {faces.slice(2).map(face)}
      </PressableFX>
    </Animated.View>
  );
}

/** A seat's ring when it speaks: gold for your team, cyan for theirs, as their titles. */
export const TALK_RINGS = { ours: PidroBevel.textGold, theirs: PidroColors.cyanText };

const styles = StyleSheet.create({
  lines: { flex: 1, minHeight: 0 },
  linesContent: { flexGrow: 1, gap: PidroSpacing.xs },
  line: { color: PidroColors.text, fontWeight: '600' },
  bigLine: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  name: { flexShrink: 1 },
  // 1.33× its size, so the glyph's top and bottom are inside its own box.
  big: { flexShrink: 1, fontSize: 30, lineHeight: 40 },
  who: { color: PidroColors.text, fontWeight: '900' },
  ours: { color: PidroBevel.textGold },
  hint: { marginTop: 'auto' },
  emoji: { flexDirection: 'row', justifyContent: 'space-between' },
  emojiInline: { justifyContent: 'flex-start', gap: PidroSpacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    alignSelf: 'stretch',
    flexShrink: 1,
    minWidth: 0,
  },
  send: {
    width: PidroLayout.touchTarget,
    height: PidroLayout.touchTarget,
    borderRadius: PidroLayout.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroColors.gold,
  },
  sendEmpty: { backgroundColor: PidroColors.actionPill },
  sendBusy: { backgroundColor: PidroColors.goldDark },
  sendPressed: { backgroundColor: PidroColors.goldDark },
  // Icon draws one arrow; pointing up reads as send.
  arrow: { transform: [{ rotate: '90deg' }] },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: PidroSpacing.sm,
    minHeight: PidroLayout.touchTarget,
  },
  ring: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 999,
    borderWidth: 3,
  },
});
