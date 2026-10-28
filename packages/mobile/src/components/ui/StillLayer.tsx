import type { ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

const ANDROID = Platform.OS === 'android';

/** Android only: the props that keep a view's drawing in a GPU texture. */
export const STILL_LAYER = ANDROID
  ? { collapsable: false, renderToHardwareTextureAndroid: true }
  : {};

/**
 * Android draws what this holds once into a texture, then only composites it:
 * its blurred shadows, text shadows and clips are not drawn again on every
 * frame that something else on screen moves. A change inside redraws it, so
 * it must never hold endless motion. The texture is the view's own box;
 * `bleed` grows that box without moving anything, so shadows reaching outside
 * aren't cut off. `live` draws it as usual for as long as something inside
 * keeps moving. Elsewhere it is a plain wrapper.
 */
export function StillLayer({
  bleed,
  live = false,
  style,
  children,
}: {
  bleed: number;
  live?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View
      {...STILL_LAYER}
      renderToHardwareTextureAndroid={ANDROID && !live}
      pointerEvents="box-none"
      style={[{ margin: -bleed, padding: bleed }, style]}>
      {children}
    </View>
  );
}
