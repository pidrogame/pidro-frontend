/**
 * Table talk (PID-114): words are cards, faces are coins. One tap says it.
 * Board: Chat-Scene (states), chat.css (materials), Chat-Land, Chat-iPad.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon, type IconName } from '@/components/ui/Icon';
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
import {
  isCoin,
  talkKey,
  type Landed,
  type Said,
  type TalkCoin as Coin,
  type TalkItem,
} from '@/features/game/talk';
import type { SaidAt } from '@/game/canvas/SeatLayer';
import { t, useTranslation } from '@/i18n';

const GLYPH: Record<Coin, IconName> = {
  coin_thumb: 'thumb',
  coin_heart: 'heart',
  coin_ha: 'laugh',
  coin_oops: 'oops',
  coin_wow: 'star',
};
/** The band's one row: a word, a coin and the speech button are all this tall. */
export const TALK_ROW = 52;

/** What a word or a face reads as, in this player's language. */
export const talkText = (said: Pick<Said, 'item' | 'text'>) =>
  said.text ?? (said.item ? t(talkKey(said.item)) : '');

/** A face is a coin: gold rim, wood face. */
export function TalkCoin({
  item,
  size = TALK_ROW,
  count = 1,
  onPress,
}: {
  item: TalkItem;
  size?: number;
  count?: number;
  onPress?: () => void;
}) {
  const coin = (
    <View
      style={[
        styles.coinRim,
        { width: size, height: size },
        gradientBg(PidroBevel.goldRimGradient),
      ]}>
      <View style={[styles.coinFace, gradientBg(PidroBevel.woodFaceGradient)]}>
        <Icon
          name={GLYPH[item as Coin]}
          size={Math.round(size * 0.52)}
          color={PidroBevel.textGold}
          strokeWidth={2.2}
        />
      </View>
      {count > 1 ? (
        <View style={styles.times}>
          <PidroText role="metadata" style={styles.timesText}>
            ×{count}
          </PidroText>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return coin;
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={t(talkKey(item))}
      testID={`talk-${item}`}
      onPress={onPress}
      style={styles.round}>
      {coin}
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
  rise,
}: {
  landed: Landed;
  name: string;
  /** Where, against the seat's avatar ring (SeatLayer picks). */
  at: SaidAt;
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
      style={[styles.landing, styles[at], motion]}>
      {isCoin(landed.item) ? (
        <TalkCoin item={landed.item} size={46} count={landed.count} />
      ) : (
        <View style={styles.bubble}>
          <View style={[styles.tail, TAIL[at]]} />
          <PidroText
            style={[styles.word, landed.text ? styles.typed : null]}
            numberOfLines={landed.text ? 4 : 2}>
            {text}
          </PidroText>
        </View>
      )}
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
            {talkText(line)}
          </>
        ) : (
          t('talk.say')
        )}
      </PidroText>
    </PressableFX>
  );
}

const TAIL: Record<SaidAt, ViewStyle> = {
  aboveStart: { bottom: -5, left: 17 },
  aboveEnd: { bottom: -5, right: 17 },
  besideEnd: { left: -5, top: 14 },
  besideStart: { right: -5, top: 14 },
  below: { top: -5, left: 17 },
};

const styles = StyleSheet.create({
  round: { borderRadius: PidroRadii.full },
  coinRim: {
    padding: 2,
    borderRadius: PidroRadii.full,
    boxShadow: PidroColors.pointCardShadow,
  },
  coinFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroBevel.keyline,
  },
  times: {
    position: 'absolute',
    right: -6,
    top: -6,
    minWidth: 24,
    paddingHorizontal: 5,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.leagueCardFace,
    borderWidth: 1,
    borderColor: PidroColors.leagueCardEdge,
    alignItems: 'center',
  },
  timesText: { color: PidroColors.leagueCardInk },
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
  aboveStart: {
    bottom: '100%',
    marginBottom: 8,
    left: '50%',
    marginLeft: -22,
    alignItems: 'flex-start',
  },
  aboveEnd: {
    bottom: '100%',
    marginBottom: 8,
    right: '50%',
    marginRight: -22,
    alignItems: 'flex-end',
  },
  besideEnd: { left: '100%', marginLeft: 10, top: 2, alignItems: 'flex-start' },
  besideStart: { right: '100%', marginRight: 10, top: 2, alignItems: 'flex-end' },
  below: { top: '100%', marginTop: 8, left: '50%', marginLeft: -22, alignItems: 'flex-start' },
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
