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
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { OFFER_MS, type Offer } from '@/features/game/offers';
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
const GAP = PidroSpacing.xs;
/** Chat-Land's word card, and the narrowest that still holds "Nice trick!" on one line. */
const CORNER_WORD = 132;
const MIN_WORD = 108;

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
      maxFontSizeMultiplier={1}
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
      accessible
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
          <Text style={styles.emoji} maxFontSizeMultiplier={1} importantForAccessibility="no">
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
  draft,
  turn,
  prompt,
  testID = 'talk-band',
}: {
  place: TalkPlace;
  line: Said | null;
  lineName: string;
  onOpen: () => void;
  /** Words typed and not sent yet (PID-318) wait here, ahead of the line. */
  draft?: string;
  /** Your turn came while you typed. */
  turn?: boolean;
  /** What it says when there is nothing to show. */
  prompt?: string;
  testID?: string;
}) {
  useTranslation();
  const empty = prompt ?? t('talk.say');
  const first = turn ? t('talk.turn_first') : '';
  // In a corner the speech button holds the words, and says so.
  if (place === 'corner')
    return <TalkSpeech label={draft ? `${first} ${draft}`.trim() : empty} onPress={onOpen} />;
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={
        draft
          ? `${first} ${draft}`.trim()
          : line
            ? t('talk.said', { name: lineName, text: talkText(line) })
            : empty
      }
      accessibilityHint={!draft && line ? t('talk.title') : undefined}
      testID={testID}
      onPress={onOpen}
      style={styles.say}>
      <PidroText role="body" numberOfLines={place === 'column' ? 2 : 1} style={styles.sayText}>
        {draft ? (
          <>
            {first ? (
              <PidroText role="body" style={styles.who}>
                {first}{' '}
              </PidroText>
            ) : null}
            {draft}
          </>
        ) : line ? (
          <>
            <PidroText role="body" style={styles.who}>
              {lineName}
            </PidroText>{' '}
            {talkShown(line)}
          </>
        ) : (
          empty
        )}
      </PidroText>
    </PressableFX>
  );
}

/** How far a landing sits from its ring. */
const BESIDE = 10;
const PLACE: Record<SaidAt, (ring: number) => ViewStyle> = {
  aboveStart: (ring) => ({ bottom: ring + 8, left: ring / 2 - 22 }),
  aboveEnd: (ring) => ({ bottom: ring + 8, right: ring / 2 - 22 }),
  besideEnd: (ring) => ({ left: ring + BESIDE, top: 2 }),
  besideStart: (ring) => ({ right: ring + BESIDE, top: 2 }),
  below: (ring) => ({ top: ring + 8, left: ring / 2 - 22 }),
};

const TAIL: Record<SaidAt, ViewStyle> = {
  aboveStart: { bottom: -5, left: 17 },
  aboveEnd: { bottom: -5, right: 17 },
  besideEnd: { left: -5, top: 14 },
  besideStart: { right: -5, top: 14 },
  below: { top: -5, left: 17 },
};

/**
 * What the game offers to say (PID-328): a word card and up to two coins in
 * place of the band's line, a thin gold line running down for six seconds,
 * the speech button still at the end. On your turn it stays but dims.
 */
export function TalkOffer({
  offer,
  place,
  dim,
  hold,
  onSend,
  onOpen,
  room = Infinity,
}: {
  offer: Offer;
  place: TalkPlace;
  dim: boolean;
  /** The corner's width free right of your hand: the row drops what does not fit. */
  room?: number;
  /** Fixtures hold the gold line still for a screenshot. */
  hold?: boolean;
  onSend: (item: TalkItem) => void;
  onOpen: () => void;
}) {
  useTranslation();
  const reduceMotion = useReducedMotion();
  const left = useSharedValue(1);
  useEffect(() => {
    left.set(1);
    if (!reduceMotion && !hold)
      left.set(withTiming(0, { duration: OFFER_MS, easing: Easing.linear }));
  }, [offer, left, reduceMotion, hold]);
  const drain = useAnimatedStyle(() => ({ transform: [{ scaleX: left.value }] }));
  // Landscape keeps one coin (Chat-Land), then gives up coin, button and card as room runs out.
  const corner = place === 'corner';
  const fits = (width: number) => !corner || room >= width;
  const cardWidth = corner ? Math.min(CORNER_WORD, room) : undefined;
  const speech = fits(CORNER_WORD + GAP + TALK_ROW) ? (
    <TalkSpeech label={t('talk.say_else')} onPress={onOpen} />
  ) : null;
  const shownCoins = corner
    ? fits(CORNER_WORD + 2 * (GAP + TALK_ROW))
      ? offer.coins.slice(0, 1)
      : []
    : offer.coins;
  if (corner && room < MIN_WORD) return <TalkSpeech label={t('talk.say')} onPress={onOpen} />;
  const coins = shownCoins.map((item) => (
    <TalkCoin
      key={item}
      item={item}
      size={place === 'column' ? 56 : TALK_ROW}
      onPress={() => onSend(item)}
    />
  ));
  const words = (corner ? offer.words.slice(0, 1) : offer.words).map((item) => (
    <TalkWord
      key={item}
      item={item}
      onPress={() => onSend(item)}
      big
      style={
        place === 'band'
          ? styles.offerWord
          : corner
            ? [styles.cornerWord, { width: cardWidth }]
            : null
      }
    />
  ));
  return (
    <View
      testID="talk-offer"
      accessibilityLiveRegion="polite"
      style={[place === 'column' ? styles.column : null, dim && styles.dim]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.drain, place !== 'band' && styles.drainTight, drain]}
      />
      {place === 'column' ? (
        <>
          {words}
          <View style={styles.offerRow}>
            {coins}
            {speech}
          </View>
        </>
      ) : (
        <View style={styles.offerRow}>
          {words}
          {coins}
          {speech}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.6 },
  column: { gap: 10 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  offerWord: { flex: 1, minHeight: TALK_ROW },
  cornerWord: { minHeight: TALK_ROW },
  drain: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -8,
    height: 2,
    backgroundColor: PidroBevel.rim,
    transformOrigin: 'left',
  },
  drainTight: { top: -6 },
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
    borderColor: PidroColors.cyanBorder,
  },
  sayText: { fontWeight: '700' },
  who: { fontWeight: '800' },
});
