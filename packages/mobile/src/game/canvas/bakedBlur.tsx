/**
 * A soft shadow or glow, blurred once into an image instead of on every frame.
 * Drawing the image where the blurred shape would be looks the same, scaled,
 * turned and faded with what casts it, without a blur in any frame.
 */
import { useEffect, useState } from 'react';
import { Image, PixelRatio, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import type { SkImage } from '@shopify/react-native-skia';

type Rect = { x: number; y: number; width: number; height: number; r: number };
export type BakedBlur = { image: SkImage; x: number; y: number; width: number; height: number };

/**
 * A rounded rect at `x, y` (size `width × height`, corner `r`), blurred by
 * `sigma`. Nothing is drawn inside `outside` (same origin), as a view's
 * `boxShadow` leaves the view itself empty.
 */
export function bakeBlur(rect: Rect, sigma: number, color: string, outside?: Rect) {
  // Loaded on first use: the score and the table's signals load at app start,
  // before web has CanvasKit; a bake only ever runs at the table.
  const { BlurStyle, ClipOp, Skia } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
  const scale = PixelRatio.get();
  const margin = Math.ceil(sigma * 3);
  const pxW = Math.ceil((rect.width + margin * 2) * scale);
  const pxH = Math.ceil((rect.height + margin * 2) * scale);
  const surface = Skia.Surface.Make(pxW, pxH);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  const shape = Skia.RRectXY(
    Skia.XYWHRect(margin, margin, rect.width, rect.height),
    rect.r,
    rect.r
  );
  if (outside) {
    const box = Skia.XYWHRect(
      outside.x - rect.x + margin,
      outside.y - rect.y + margin,
      outside.width,
      outside.height
    );
    canvas.clipRRect(Skia.RRectXY(box, outside.r, outside.r), ClipOp.Difference, true);
  }
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
  canvas.drawRRect(shape, paint);
  const image = surface.makeImageSnapshot();
  surface.dispose();
  return {
    image,
    x: rect.x - margin,
    y: rect.y - margin,
    width: pxW / scale,
    height: pxH / scale,
  } satisfies BakedBlur;
}

const shapeKey = (...shape: unknown[]) =>
  JSON.stringify(shape, (_, v) => (typeof v === 'number' ? Math.round(v * 2) / 2 : v));

// The table's blurs, one per shape, so a new hand, game or turn of the phone
// draws the same image again instead of baking another.
const kept = new Map<string, BakedBlur>();
const KEPT_BLURS = 16;
let tables = 0;
let release: ReturnType<typeof setTimeout> | null = null;
const RELEASE_MS = 10_000;

/**
 * `bakeBlur`, kept while a table is up (`useKeptBlurs`). A window that keeps
 * resizing lets go of its oldest sizes; a failed bake is tried again.
 */
export function keptBlur(rect: Rect, sigma: number, color: string) {
  const key = shapeKey(rect, sigma, color);
  const found = kept.get(key);
  if (found) return found;
  const baked = bakeBlur(rect, sigma, color);
  if (!baked) return null;
  if (kept.size >= KEPT_BLURS) kept.delete(kept.keys().next().value!);
  kept.set(key, baked);
  return baked;
}

/**
 * A table holds the kept blurs and baked shadows. A while after the last one
 * closes they are let go; no canvas draws them then, and each image frees its
 * pixels once nothing refers to it.
 */
export function useKeptBlurs() {
  useEffect(() => {
    tables++;
    if (release) clearTimeout(release);
    release = null;
    return () => {
      if (--tables > 0) return;
      release = setTimeout(() => {
        release = null;
        kept.clear();
        shadows.clear();
      }, RELEASE_MS);
    };
  }, []);
}

export type BakedShadow = { uri: string; x: number; y: number; width: number; height: number };
const shadows = new Map<string, BakedShadow | null>();
const KEPT_SHADOWS = 64;

/** The same, as a PNG an RN `Image` can show. Kept per shape, to the half point. */
export function bakedShadow(
  rect: Rect,
  sigma: number,
  color: string,
  outside?: Rect
): BakedShadow | null {
  const key = shapeKey(rect, sigma, color, outside);
  if (!shadows.has(key)) {
    if (shadows.size >= KEPT_SHADOWS) shadows.delete(shadows.keys().next().value!);
    const baked = bakeBlur(rect, sigma, color, outside);
    shadows.set(
      key,
      baked && {
        uri: `data:image/png;base64,${baked.image.encodeToBase64()}`,
        x: baked.x,
        y: baked.y,
        width: baked.width,
        height: baked.height,
      }
    );
    baked?.image.dispose();
  }
  return shadows.get(key) ?? null;
}

/**
 * A view's outer `boxShadow` (`Xpx Ypx blur [spread] color`), baked for the
 * size the view lays out at. Put it first inside the view instead of the
 * `boxShadow`: it looks the same, and a view that moves or fades over the
 * table no longer blurs it again on every frame. A view with a border passes
 * its width, so the shadow starts outside the border, as `boxShadow` does.
 * A view of known `size` bakes on its first frame. `ring` is the width of a
 * crisp keyline the view keeps as its own `boxShadow`, drawn over this one.
 */
export function BoxShadow({
  shadow,
  radius = 0,
  border = 0,
  ring = 0,
  size: known,
}: {
  shadow: string;
  radius?: number;
  border?: number;
  ring?: number;
  size?: { width: number; height: number };
}) {
  const [measured, setSize] = useState<{ width: number; height: number } | null>(null);
  const size = known ?? measured;
  const [x, y, blur, spread = 0] = (shadow.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
  const color = shadow.slice(shadow.search(/rgba?\(|#/));
  const baked =
    size &&
    bakedShadow(
      {
        x: x - spread,
        y: y - spread,
        width: size.width + spread * 2,
        height: size.height + spread * 2,
        r: Math.min(radius + spread, (Math.min(size.width, size.height) + spread * 2) / 2),
      },
      blur / 2,
      color,
      {
        x: -ring,
        y: -ring,
        width: size.width + ring * 2,
        height: size.height + ring * 2,
        r: Math.min(radius, Math.min(size.width, size.height) / 2) + ring,
      }
    );
  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { top: -border, right: -border, bottom: -border, left: -border }]}
      onLayout={
        known
          ? undefined
          : ({ nativeEvent: { layout } }) =>
              setSize((was) =>
                was?.width === layout.width && was.height === layout.height
                  ? was
                  : { width: layout.width, height: layout.height }
              )
      }>
      {baked ? <ShadowImage shadow={baked} /> : null}
    </View>
  );
}

/** On web a background, as decoration is in a page: never an image to count or read. */
function ShadowImage({ shadow }: { shadow: BakedShadow }) {
  const place = {
    position: 'absolute',
    left: shadow.x,
    top: shadow.y,
    width: shadow.width,
    height: shadow.height,
  } as const;
  return Platform.OS === 'web' ? (
    <View
      style={[
        place,
        { backgroundImage: `url(${shadow.uri})`, backgroundSize: '100% 100%' } as ViewStyle,
      ]}
    />
  ) : (
    // No fade: Android fades a `data:` image in, as if it came from the network.
    <Image source={{ uri: shadow.uri }} fadeDuration={0} style={place} />
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, overflow: 'visible' },
});
