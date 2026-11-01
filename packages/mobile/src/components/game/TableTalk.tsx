/**
 * Table talk (PID-114): words are cards, faces are plain emoji. One tap says it.
 * Board: Chat-Scene (states), chat.css (materials), Chat-Land, Chat-iPad.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroColors, PidroFonts, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import {
  isCoin,
  TALK_EMOJI,
  talkKey,
  type Landed,
  type Said,
  type TalkItem,
} from '@/features/game/talk';
import type { SaidAt } from '@/game/canvas/SeatLayer';
import { t, useTranslation } from '@/i18n';

/** The band's one row: a word, a coin and the speech button are all this tall. */
export const TALK_ROW = 52;

/** What a word or a face reads as, in this player's language. */
export const talkText = (said: Pick<Said, 'item' | 'text'>) =>
  said.text ?? (said.item ? t(talkKey(said.item)) : '');

/** What shows on the table: a face is its emoji, the rest is its words. */
const talkShown = (said: Pick<Said, 'item' | 'text'>) =>
  isCoin(said.item) ? TALK_EMOJI[said.item] : talkText(said);

/** A face is a plain emoji, and its label still says it aloud. */
export function TalkCoin({
  item,
  size = TALK_ROW,
  onPress,
}: {
  item: TalkItem;
  size?: number;
  onPress?: () => void;
}) {
  const face = (
    <Text
      style={{ fontSize: Math.round(size * 0.58), lineHeight: size }}
      importantForAccessibility="no">
      {isCoin(item) ? TALK_EMOJI[item] : ''}
    </Text>
  );
  if (!onPress) return face;
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={t(talkKey(item))}
      testID={`talk-${item}`}
      onPress={onPress}
      style={[styles.face, { width: size, height: size }]}>
      {face}
    </PressableFX>
  );
}

const PIPS = ['♥', '♠', '♦', '♣'];

/** A word is a card: cream face, dark type, a pip in the corner. */
export function TalkWord({
  item,
  index,
  onPress,
  style,
  big = false,
}: {
  item: TalkItem;
  /** Where it lies in the hand; it picks the pip. */
  index?: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
}) {
  const pip = index != null ? PIPS[index % PIPS.length] : null;
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={t(talkKey(item))}
      testID={`talk-${item}`}
      onPress={onPress}
      style={[styles.card, style]}>
      {pip ? (
        <PidroText
          role="metadata"
          style={[styles.pip, (pip === '♥' || pip === '♦') && styles.red]}
          importantForAccessibility="no">
          {pip}
        </PidroText>
      ) : null}
      <PidroText style={[styles.word, big && styles.bigWord]} numberOfLines={2} align="center">
        {t(talkKey(item))}
      </PidroText>
    </PressableFX>
  );
}

/** The quiet speech button: opens the hand of words. */
export function TalkSpeech({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="talk-speech"
      onPress={onPress}
      style={styles.speech}>
      <Icon name="chat" size={22} color={PidroColors.cyanText} strokeWidth={2.2} />
    </PressableFX>
  );
}

/**
 * What lands at a seat. Side seats and yours take it above the avatar, the
 * top seat beside it. Transform and opacity only; Reduce Motion fades.
 */
export function TalkLanding({
  landed,
  name,
  at,
  ring,
  rise,
}: {
  landed: Landed;
  name: string;
  /** Where, against the seat's avatar ring (SeatLayer picks). */
  at: SaidAt;
  /** The avatar ring's size: a landing is placed in plain numbers from it. */
  ring: number;
  /** How far it travels in: yours comes up from the band. */
  rise: number;
}) {
  useTranslation();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: reduceMotion ? 180 : 300,
        easing: Easing.bezier(0.2, 0.9, 0.3, 1.2),
      })
    );
  }, [landed.key, progress, reduceMotion]);
  const motion = useAnimatedStyle(() => {
    const p = progress.value;
    return reduceMotion
      ? { opacity: Math.min(1, p) }
      : {
          opacity: Math.min(1, p * 1.6),
          transform: [
            { translateY: (1 - p) * rise },
            { rotate: `${(1 - p) * -4}deg` },
            { scale: 0.86 + 0.14 * p },
          ],
        };
  });
  const text = talkText(landed);
  const face = isCoin(landed.item) ? landed.item : null;
  return (
    <Animated.View
      testID="talk-landed"
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('talk.said', {
        name,
        text: landed.count > 1 ? `${text} ×${landed.count}` : text,
      })}
      exiting={reduceMotion ? undefined : FadeOut.duration(200)}
      style={[styles.landing, styles[at], PLACE[at](ring), motion]}>
      <View style={[styles.bubble, face && styles.faceBubble]}>
        <View style={[styles.tail, TAIL[at]]} />
        {face ? (
          <Text style={styles.emoji} importantForAccessibility="no">
            {TALK_EMOJI[face]}
            {landed.count > 1 ? <Text style={styles.times}> ×{landed.count}</Text> : null}
          </Text>
        ) : (
          <PidroText
            style={[styles.word, landed.text ? styles.typed : null]}
            numberOfLines={landed.text ? 4 : 2}>
            {text}
          </PidroText>
        )}
      </View>
    </Animated.View>
  );
}

export type TalkPlace = 'band' | 'corner' | 'column';

/**
 * Where talk sits at the table: the band under the hand on phones, the free
 * corner right of the hand in landscape, beside the hand on an iPad.
 */
export function TalkBand({
  place,
  line,
  lineName,
  onOpen,
}: {
  place: TalkPlace;
  line: Said | null;
  lineName: string;
  onOpen: () => void;
}) {
  useTranslation();
  if (place === 'corner') return <TalkSpeech label={t('talk.say')} onPress={onOpen} />;
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={
        line ? t('talk.said', { name: lineName, text: talkText(line) }) : t('talk.say')
      }
      accessibilityHint={line ? t('talk.title') : undefined}
      testID="talk-band"
      onPress={onOpen}
      style={styles.say}>
      <PidroText role="body" tone="soft" numberOfLines={1} style={styles.sayText}>
        {line ? (
          <>
            <PidroText role="body" style={styles.who}>
              {lineName}
            </PidroText>{' '}
            {talkShown(line)}
          </>
        ) : (
          t('talk.say')
        )}
      </PidroText>
    </PressableFX>
  );
}

/** Numbers, not percentages: iOS put a landing far from its ring with `left: '100%'`. */
const GAP = 10;
const PLACE: Record<SaidAt, (ring: number) => ViewStyle> = {
  aboveStart: (ring) => ({ bottom: ring + 8, left: ring / 2 - 22 }),
  aboveEnd: (ring) => ({ bottom: ring + 8, right: ring / 2 - 22 }),
  besideEnd: (ring) => ({ left: ring + GAP, top: 2 }),
  besideStart: (ring) => ({ right: ring + GAP, top: 2 }),
  below: (ring) => ({ top: ring + 8, left: ring / 2 - 22 }),
};

const TAIL: Record<SaidAt, ViewStyle> = {
  aboveStart: { bottom: -5, left: 17 },
  aboveEnd: { bottom: -5, right: 17 },
  besideEnd: { left: -5, top: 14 },
  besideStart: { right: -5, top: 14 },
  below: { top: -5, left: 17 },
};

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center' },
  card: {
    minHeight: TALK_ROW,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: PidroRadii.tight,
    backgroundColor: PidroColors.leagueCardFace,
    borderWidth: 1,
    borderColor: PidroColors.leagueCardEdge,
    boxShadow: PidroColors.pointCardShadow,
  },
  pip: { position: 'absolute', left: 6, top: 3, color: PidroColors.leagueCardInk },
  red: { color: PidroColors.leagueCardRed },
  word: {
    fontFamily: PidroFonts.display,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '400',
    color: PidroColors.leagueCardInk,
  },
  bigWord: { fontSize: 19, lineHeight: 23 },
  typed: { fontFamily: PidroFonts.ui, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  speech: {
    width: TALK_ROW,
    height: TALK_ROW,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panel,
    borderWidth: 1,
    borderColor: PidroColors.border,
  },
  faceBubble: { paddingHorizontal: 8, paddingVertical: 3 },
  emoji: { fontSize: 20, lineHeight: 26 },
  times: { fontSize: 13, fontWeight: '800', color: PidroColors.leagueCardInk },
  bubble: {
    maxWidth: 150,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: PidroRadii.tight,
    backgroundColor: PidroColors.leagueCardFace,
    borderWidth: 1,
    borderColor: PidroColors.leagueCardEdge,
    boxShadow: PidroColors.noticeShadow,
  },
  tail: {
    position: 'absolute',
    width: 10,
    height: 10,
    backgroundColor: PidroColors.leagueCardFace,
    transform: [{ rotate: '45deg' }],
  },
  // A landing's box runs from the ring's middle (or its side) outward.
  landing: { position: 'absolute', width: 150 },
  aboveStart: { alignItems: 'flex-start' },
  aboveEnd: { alignItems: 'flex-end' },
  besideEnd: { alignItems: 'flex-start' },
  besideStart: { alignItems: 'flex-end' },
  below: { alignItems: 'flex-start' },
  say: {
    height: TALK_ROW,
    minWidth: PidroLayout.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: PidroSpacing.md,
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panelSoft,
    borderWidth: 1,
    borderColor: PidroColors.border,
  },
  sayText: { fontWeight: '700' },
  who: { fontWeight: '800' },
});
