import { Image, Platform, StyleSheet, View } from 'react-native';
import { createContext, ReactNode, useContext } from 'react';
import { PidroColors } from '@/design/tokens';

interface BackgroundProps {
  /** None while a route only redirects or waits: the felt still shows. */
  children?: ReactNode;
  /** Covered by opaque screens: keep the image loaded, but don't paint it. */
  hidden?: boolean;
}

const ANDROID = Platform.OS === 'android';

/** Whether a felt already shows behind, in the same screen. */
const FeltBehind = createContext(false);

/**
 * Full-screen background image for the Pidro app
 * - Covers entire viewport
 * - In portrait mode, full height with cropped sides (1920x1080 landscape image)
 * - Dark atmospheric background for card game
 *
 * On Android each pixel is painted once: a felt over a felt paints nothing, and
 * there is no fill under the image. The window is this colour already, and the
 * image, held by the root felt, comes from memory on the first frame.
 */
export function Background({ children, hidden = false }: BackgroundProps) {
  const behind = useContext(FeltBehind);
  if (ANDROID && behind) return <View style={styles.background}>{children}</View>;

  return (
    <View
      collapsable={false}
      style={[styles.background, !ANDROID && styles.fill]}
      testID="felt-background">
      <Image
        source={require('../../../assets/images/bg.png')}
        style={[styles.image, hidden && styles.hidden]}
        resizeMode="cover"
        accessible={false}
      />
      <FeltBehind.Provider value={!hidden}>{children}</FeltBehind.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  hidden: { opacity: 0 },
  background: { flex: 1, width: '100%', height: '100%' },
  fill: { backgroundColor: PidroColors.feltBottom },
});
