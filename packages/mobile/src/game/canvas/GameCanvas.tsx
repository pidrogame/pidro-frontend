/**
 * Skia table scene.
 * Felt, trick ring and opponent back-stacks are static; the hand + trick cards
 * are animated, draggable sprites driven by useCardSprites.
 * Self-contained for window/insets; web callers load CanvasKit before import.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTableInsets, useTableSize } from './TableChrome';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  Canvas,
  Circle,
  Fill,
  Group,
  Image,
  Path,
  RadialGradient,
  Skia,
  vec,
  type SkImage,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Card, Suit } from '@/types/game';
import { DealerChip } from '@/components/game/DealerChip';
import { useTranslation } from '@/i18n';
import { computeLayout, handLeft, handScale, TRUMP_MARK } from './layout';
import { T } from './tokens';
import type { CardTextures } from './cardTextures';
import type { TableModel } from './tableModel';
import { useCardSprites } from './useCardSprites';
import { keptBlur } from './bakedBlur';

type Props = {
  model: TableModel;
  textures: CardTextures;
  onPlayCard: (card: Card) => void;
  topReserve?: number;
  bottomReserve?: number;
  /** Picking trump: lift the cards this suit would make trump. */
  previewSuit?: Suit | null;
};

export default function GameCanvas({
  model,
  textures,
  onPlayCard,
  topReserve = 0,
  bottomReserve = 0,
  previewSuit = null,
}: Props) {
  const { width, height } = useTableSize();
  const insets = useTableInsets();
  const { top, bottom, left, right } = insets;
  const L = useMemo(
    () => computeLayout(width, height, { top, bottom, left, right }, topReserve, bottomReserve),
    [width, height, top, bottom, left, right, topReserve, bottomReserve]
  );

  const {
    gesture,
    nodes,
    trumpPop,
    renderedCutCardCount,
    renderedPlayedCardCount,
    renderedHandCardCount,
    handTargets,
    spriteKeys,
  } = useCardSprites({
    model,
    textures,
    L,
    onPlayCard,
    enabled: true,
    previewSuit,
  });

  const canvas = (
    <Canvas style={{ flex: 1 }}>
      {/* Felt: lit from the center, falling into shadow at the rim. */}
      <Fill>
        <RadialGradient
          c={vec(L.felt.cx, L.felt.cy)}
          r={Math.max(width, height) * 0.78}
          colors={[T.feltCenter, T.feltMid, T.feltEdge, T.bgDeep]}
          positions={[0, 0.42, 0.82, 1]}
        />
      </Fill>

      <FeltWeave width={width} height={height} />

      {/* Soft light pool anchoring the trick zone. */}
      <Circle c={vec(L.trick.cx, L.trick.cy)} r={L.trick.r * 2.1}>
        <RadialGradient
          c={vec(L.trick.cx, L.trick.cy)}
          r={L.trick.r * 2.1}
          colors={['rgba(120, 195, 250, 0.14)', 'rgba(120, 195, 250, 0)']}
        />
      </Circle>
      <Circle
        c={vec(L.trick.cx, L.trick.cy)}
        r={L.trick.r}
        style="stroke"
        strokeWidth={1.4}
        color={T.ring}
      />
      {!model.trumpSuit && <Circle c={vec(L.trick.cx, L.trick.cy)} r={3} color={T.ringDot} />}

      {model.trumpSuit && (
        <SuitGlyph
          img={textures.suit(model.trumpSuit)}
          x={L.trick.cx}
          y={L.trick.cy}
          size={L.cardW * TRUMP_MARK}
          pop={trumpPop}
        />
      )}
      {nodes}
    </Canvas>
  );

  const renderedHandHeight = L.cardH * handScale(L.profile);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }}>
        {canvas}
        {model.phase === 'dealer_selection' && (
          <DealerSelectionMarker
            x={L.trick.cx}
            y={L.trick.cy}
            // Landscape phones keep Classic's small chip, clear of the cross (PID-307).
            size={L.front ? L.cardW * TRUMP_MARK : Math.max(58, L.cardW * 0.9)}
          />
        )}
        <View
          testID="table-trick-center"
          pointerEvents="none"
          accessible={false}
          style={{
            position: 'absolute',
            top: L.trick.cy,
            left: L.trick.cx,
            width: 1,
            height: 1,
          }}
        />
        <View
          testID="trick-north-top"
          pointerEvents="none"
          accessible={false}
          style={{
            position: 'absolute',
            top: L.trick.cy - L.trick.r - (L.cardH * L.trick.pileScale) / 2,
            left: L.trick.cx,
            width: 1,
            height: 1,
          }}
        />
        <View
          testID="player-hand-top"
          pointerEvents="none"
          accessible={false}
          style={{
            position: 'absolute',
            top: L.hand.cy - renderedHandHeight / 2,
            left: handLeft(L, model.yourHand.length),
            width: 1,
            height: 1,
          }}
        />
        {__DEV__ ? (
          <>
            <View
              testID="play-presentation"
              accessibilityLabel={JSON.stringify({
                hand: handTargets.value,
                sprites: spriteKeys,
                lit:
                  Object.entries(model.seats).find(([, seat]) => seat?.isCurrentTurn)?.[0] ?? null,
              })}
              pointerEvents="none"
              className="absolute h-px w-px opacity-0"
            />
            <View
              testID="deal-presentation"
              accessibilityLabel={JSON.stringify({
                stage: model.dealStage ?? 'ready',
                hand: model.yourHand.map((card) => card.key),
                counts: Object.fromEntries(
                  Object.entries(model.seats).map(([rel, seat]) => [rel, seat?.cardCount])
                ),
              })}
              pointerEvents="none"
              className="absolute h-px w-px opacity-0"
            />
            <View
              testID={`rendered-hand-card-count-${renderedHandCardCount}`}
              pointerEvents="none"
              accessible={false}
              className="absolute h-px w-px opacity-0"
            />
            <View
              testID={`rendered-cut-card-count-${renderedCutCardCount}`}
              pointerEvents="none"
              accessible={false}
              className="absolute h-px w-px opacity-0"
            />
            <View
              testID={`rendered-played-card-count-${renderedPlayedCardCount}`}
              pointerEvents="none"
              accessible={false}
              className="absolute h-px w-px opacity-0"
            />
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function DealerSelectionMarker({ x, y, size }: { x: number; y: number; size: number }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const entrance = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entrance.value = reduceMotion ? 1 : 0;
    if (reduceMotion) return;
    entrance.value = withSequence(
      withTiming(1.12, {
        duration: 300,
        easing: Easing.out(Easing.back(1.7)),
        reduceMotion: ReduceMotion.System,
      }),
      withTiming(1, { duration: 220, reduceMotion: ReduceMotion.System })
    );
  }, [entrance, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: entrance.value }],
  }));

  return (
    <Animated.View
      testID="dealer-selection-chip"
      accessibilityLabel={t('game.selecting_dealer')}
      pointerEvents="none"
      style={[
        styles.dealerMarker,
        { left: x - size / 2, top: y - size / 2, width: size, height: size },
        animatedStyle,
      ]}>
      <DealerChip size={size} />
    </Animated.View>
  );
}

// Subtle diamond weave over the felt, like the original's patterned cloth.
// One static path, stroked at whisper opacity — visible on the lit center,
// fading into the vignette.
function FeltWeave({ width, height }: { width: number; height: number }) {
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    const cell = 46;
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const cx = col * cell + (row % 2 ? cell / 2 : 0);
        const cy = row * cell;
        p.moveTo(cx, cy - cell / 2);
        p.lineTo(cx + cell / 2, cy);
        p.lineTo(cx, cy + cell / 2);
        p.lineTo(cx - cell / 2, cy);
        p.close();
      }
    }
    return p;
  }, [width, height]);
  return <Path path={path} style="stroke" strokeWidth={1} color="rgba(180, 225, 255, 0.045)" />;
}

function SuitGlyph({
  img,
  x,
  y,
  size,
  pop,
}: {
  img: SkImage | null;
  x: number;
  y: number;
  size: number;
  pop: SharedValue<number>;
}) {
  const transform = useDerivedValue(() => [
    { translateX: x },
    { translateY: y },
    { scale: 1 + 0.35 * pop.value },
  ]);
  const opacity = useDerivedValue(() => 0.85 + 0.15 * pop.value);
  // Dark halo lifts the glyph off the lit felt; blurred once per size, kept across hands.
  const halo = useMemo(() => {
    const r = size * 0.68;
    return keptBlur({ x: -r, y: -r, width: r * 2, height: r * 2, r }, 10, 'rgba(4, 22, 42, 0.42)');
  }, [size]);
  if (!img) return null;
  return (
    <Group transform={transform} opacity={opacity}>
      {halo && (
        <Image
          image={halo.image}
          x={halo.x}
          y={halo.y}
          width={halo.width}
          height={halo.height}
          fit="fill"
        />
      )}
      <Image image={img} x={-size / 2} y={-size / 2} width={size} height={size} fit="contain" />
    </Group>
  );
}

const styles = StyleSheet.create({
  dealerMarker: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
