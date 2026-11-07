/**
 * Table talk (PID-114): words are cards, faces are plain emoji. One tap says it.
 * Board: Chat-Scene (states), chat.css (materials), Chat-Land, Chat-iPad.
 */
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { TalkIcon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
  PidroType,
} from '@/design/tokens';
import { OFFER_MS, type Offer } from '@/features/game/offers';
import {
  isCoin,
  TALK_EMOJI,
  TAIL_SIZES,
  tailFit,
  talkKey,
  twoLines,
  type Landed,
  type Said,
  type TailSize,
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

/**
 * The quiet speech button: opens the hand of words. `muted` draws talk off (no
 * table has that state yet); `unread` dots it while a line waits in the log (PID-393).
 */
export function TalkSpeech({
  onPress,
  label,
  muted = false,
  unread = false,
  joined = false,
}: {
  onPress: () => void;
  label: string;
  muted?: boolean;
  unread?: boolean;
  /** A tail joins it on the left (PID-396): the two are one pill. */
  joined?: boolean;
}) {
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="talk-speech"
      onPress={onPress}
      style={[styles.speech, joined && styles.joined]}>
      <TalkIcon size={26} muted={muted} />
      {unread ? <View testID="talk-speech-dot" pointerEvents="none" style={styles.unread} /> : null}
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
  wait = 0,
}: {
  landed: Landed;
  name: string;
  /** Where, against the seat's avatar ring (SeatLayer picks). */
  at: SaidAt;
  /** The avatar ring's size: a landing is placed in plain numbers from it. */
  ring: number;
  /** How far it travels in: yours comes up from the band. */
  rise: number;
  /** How long it waits, unseen, before it rises: yours waits out the tail's fold (PID-396). */
  wait?: number;
}) {
  useTranslation();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(0);
    progress.set(
      withDelay(
        reduceMotion ? 0 : wait,
        withTiming(1, {
          duration: reduceMotion ? 180 : 300,
          easing: Easing.bezier(0.2, 0.9, 0.3, 1.2),
        })
      )
    );
  }, [landed.key, progress, reduceMotion, wait]);
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
 * Where talk sits: a speech bubble in the bottom right corner on phones,
 * beside the hand on an iPad, a band in the log's sheet. On upright phones
 * the bubble says what the game offers in its tail (PID-396).
 */
export function TalkBand({
  place,
  line,
  lineName,
  onOpen,
  draft,
  turn,
  unread,
  prompt,
  testID = 'talk-band',
  offer = null,
  room = 0,
  dim = false,
  hold,
  slide,
  onSend,
}: {
  place: TalkPlace;
  line: Said | null;
  lineName: string;
  onOpen: () => void;
  /** Words typed and not sent yet (PID-318) wait here, ahead of the line. */
  draft?: string;
  /** Your turn came while you typed. */
  turn?: boolean;
  /** Someone said something while the sheet was closed. */
  unread?: boolean;
  /** What it says when there is nothing to show. */
  prompt?: string;
  testID?: string;
  /** Upright phones: what the game offers, said in the bubble's tail. */
  offer?: Offer | null;
  /** The width free left of the bubble, short of your seat. */
  room?: number;
  dim?: boolean;
  /** Fixtures hold the gold line, and the tail at `slide` of the way out. */
  hold?: boolean;
  slide?: number;
  onSend?: (item: TalkItem) => void;
}) {
  useTranslation();
  const empty = prompt ?? t('talk.say');
  const first = turn ? t('talk.turn_first') : '';
  // In a corner the speech button holds the words, and says so.
  if (place === 'corner')
    return (
      <TalkTail
        offer={offer}
        room={room}
        dim={dim}
        hold={hold}
        slide={slide}
        onSend={onSend}
        label={draft ? `${first} ${draft}`.trim() : empty}
        onOpen={onOpen}
        unread={unread}
      />
    );
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

/** Between the tail's word and its edges, inside its 1pt border: the small sizes keep less (PID-396). */
const TAIL_PAD: Record<TailSize, number> = { body: 10, small: 8, two: 8 };
/** How long the tail takes to fold back under the bubble. */
export const TAIL_FOLD_MS = 180;
/** The bubble's row is fixed: large type grows the tail only this far, then takes a smaller size. */
const TAIL_SCALE = 1.3;
const TAIL_TYPE: Record<TailSize, TextStyle> = {
  body: { fontSize: 17, lineHeight: 21 },
  small: { fontSize: PidroType.label.fontSize, lineHeight: PidroType.label.lineHeight },
  two: { fontSize: PidroType.label.fontSize, lineHeight: PidroType.label.lineHeight },
};

/**
 * The bubble, and on upright phones what the game offers (PID-396): the word
 * grows out of it as a tail, a cream face joined to it as one pill, the gold
 * line under them for six seconds. The word sends, the bubble opens the
 * words. It slides out from under the bubble and folds back when the offer
 * goes; Reduce Motion cuts. It takes the largest size of the word `room`
 * holds; where none fits, the bubble wears the line alone.
 */
function TalkTail({
  offer,
  room,
  dim,
  hold,
  slide,
  onSend,
  label,
  onOpen,
  unread,
}: {
  offer: Offer | null;
  room: number;
  dim: boolean;
  hold?: boolean;
  slide?: number;
  onSend?: (item: TalkItem) => void;
  label: string;
  onOpen: () => void;
  unread?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // The offer the tail says, kept while it folds back.
  const [said, setSaid] = useState(offer);
  if (offer && offer !== said) setSaid(offer);
  const item = said?.words[0];
  const text = item ? t(talkKey(item)) : '';
  // Each size of the word, measured as the tail draws it.
  const [widths, setWidths] = useState<{ text: string } & Partial<Record<TailSize, number>>>({
    text: '',
  });
  const measured = widths.text === text && TAIL_SIZES.every((size) => widths[size] != null);
  const size = measured ? tailFit(room, widths as Record<TailSize, number>) : null;
  const out = useSharedValue(0);
  const left = useSharedValue(1);
  const tailed = !!offer && !!size;
  useEffect(() => {
    if (tailed) {
      out.set(
        slide ??
          (reduceMotion ? 1 : withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }))
      );
    } else if (!offer && said) {
      // Reduce Motion folds it in no time: a cut.
      out.set(
        withTiming(
          0,
          { duration: reduceMotion ? 0 : TAIL_FOLD_MS, easing: Easing.in(Easing.cubic) },
          (done) => {
            if (done) runOnJS(setSaid)(null);
          }
        )
      );
    }
  }, [tailed, offer, said, slide, reduceMotion, out]);
  useEffect(() => {
    left.set(1);
    if (offer && !reduceMotion && !hold)
      left.set(withTiming(0, { duration: OFFER_MS, easing: Easing.linear }));
  }, [offer, left, reduceMotion, hold]);
  const drain = useAnimatedStyle(() => ({ transform: [{ scaleX: left.value }] }));
  const width = size ? widths[size]! : 0;
  const slideOut = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - out.value) * width }],
  }));
  const shown = size === 'two' ? twoLines(text) : text;
  const start = slide != null ? 1 - slide : reduceMotion ? 0 : 1;
  return (
    <View
      testID={offer ? 'talk-offer' : undefined}
      accessibilityLiveRegion={offer ? 'polite' : undefined}
      style={[styles.offerRow, styles.tailRow, offer && dim && styles.dim]}>
      {offer ? (
        <Animated.View
          testID="talk-offer-line"
          pointerEvents="none"
          style={[styles.under, drain]}
        />
      ) : null}
      {item && size ? (
        <View testID={`talk-tail-${size}`} style={[styles.tailClip, { width }]}>
          <Animated.View
            // Where it starts, until the animated style takes over: under the bubble.
            style={[{ transform: [{ translateX: start * width }] }, slideOut]}>
            <PressableFX
              accessibilityRole="button"
              accessibilityLabel={text}
              testID={`talk-${item}`}
              disabled={!offer}
              onPress={() => onSend?.(item)}
              style={[styles.tailFace, { width, paddingHorizontal: TAIL_PAD[size] }]}>
              <PidroText
                style={[styles.word, TAIL_TYPE[size]]}
                numberOfLines={size === 'two' ? 2 : 1}
                maxFontSizeMultiplier={TAIL_SCALE}
                align="center">
                {shown}
              </PidroText>
            </PressableFX>
          </Animated.View>
        </View>
      ) : null}
      <TalkSpeech
        label={tailed ? t('talk.say_else') : label}
        onPress={onOpen}
        unread={unread}
        joined={!!(item && size)}
      />
      {offer && item && !measured ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.measure}>
          {TAIL_SIZES.map((each) => (
            <PidroText
              key={each}
              style={[styles.word, TAIL_TYPE[each], styles.measured]}
              maxFontSizeMultiplier={TAIL_SCALE}
              onLayout={({ nativeEvent }) => {
                const measure = Math.ceil(nativeEvent.layout.width) + 2 * (TAIL_PAD[each] + 1);
                setWidths((was) => ({
                  ...(was.text === text ? was : { text }),
                  [each]: measure,
                }));
              }}>
              {each === 'two' ? twoLines(text) : text}
            </PidroText>
          ))}
        </View>
      ) : null}
    </View>
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
 * What the game offers to say (PID-328): a word card and a coin beside the
 * speech button, a thin gold line running down for six seconds. On your turn
 * it stays but dims.
 */
export function TalkOffer({
  offer,
  place,
  dim,
  hold,
  onSend,
  onOpen,
  room = Infinity,
  lift = 0,
  unread,
}: {
  offer: Offer;
  place: TalkPlace;
  dim: boolean;
  /** The corner's width free right of your hand: the row drops what does not fit. */
  room?: number;
  /** How far the word card rises to keep clear of your pack while you deal (PID-396). */
  lift?: number;
  unread?: boolean;
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
  const button = GAP + TALK_ROW;
  const cardWidth = corner ? Math.min(CORNER_WORD, room) : undefined;
  const speech = fits(CORNER_WORD + button) ? (
    <TalkSpeech label={t('talk.say_else')} onPress={onOpen} unread={unread} />
  ) : null;
  const shownCoins = corner
    ? fits(CORNER_WORD + GAP + TALK_ROW + button)
      ? offer.coins.slice(0, 1)
      : []
    : offer.coins;
  // A card with no button beside it would rise into East's backs: while you deal there, the bubble lights alone.
  if (!fits(MIN_WORD) || (lift > 0 && !speech))
    return <TalkSpeech label={t('talk.say')} onPress={onOpen} unread={unread} />;
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
      style={corner ? [styles.cornerWord, { width: cardWidth }] : null}
    />
  ));
  return (
    <View
      testID="talk-offer"
      accessibilityLiveRegion="polite"
      style={[place === 'column' ? styles.column : null, dim && styles.dim]}>
      {lift ? null : (
        <Animated.View
          testID="talk-offer-line"
          pointerEvents="none"
          style={[styles.drain, drain]}
        />
      )}
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
          {lift ? (
            // The line rides up with the card, off your pack.
            <View style={{ transform: [{ translateY: -lift }] }}>
              <Animated.View
                testID="talk-offer-line"
                pointerEvents="none"
                style={[styles.drain, drain]}
              />
              {words}
            </View>
          ) : (
            words
          )}
          {coins}
          {speech}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.6 },
  tailRow: { gap: 0 },
  // The word's slot left of the bubble: the tail slides out of the bubble's edge.
  tailClip: {
    height: TALK_ROW,
    overflow: 'hidden',
    borderTopLeftRadius: PidroRadii.lg,
    borderBottomLeftRadius: PidroRadii.lg,
  },
  tailFace: {
    height: TALK_ROW,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: PidroRadii.lg,
    borderBottomLeftRadius: PidroRadii.lg,
    backgroundColor: PidroColors.leagueCardFace,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: PidroColors.leagueCardEdge,
  },
  measure: { position: 'absolute', right: 0, bottom: 0, width: 400, opacity: 0 },
  measured: { alignSelf: 'flex-start' },
  under: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -6,
    height: 2,
    backgroundColor: PidroBevel.rim,
    transformOrigin: 'left',
  },
  column: { gap: 10 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  cornerWord: { minHeight: TALK_ROW },
  drain: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -6,
    height: 2,
    backgroundColor: PidroBevel.rim,
    transformOrigin: 'left',
  },
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
  unread: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 10,
    height: 10,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.countBadge,
    borderWidth: 1.5,
    borderColor: PidroBevel.panelDeep,
  },
  joined: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
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
