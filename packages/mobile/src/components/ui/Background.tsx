import { Image, StyleSheet, View } from 'react-native';
import { ReactNode } from 'react';
import { PidroColors } from '@/design/tokens';

interface BackgroundProps {
  children: ReactNode;
}

/**
 * Full-screen background image for the Pidro app
 * - Covers entire viewport
 * - In portrait mode, full height with cropped sides (1920x1080 landscape image)
 * - Dark atmospheric background for card game
 */
export function Background({ children }: BackgroundProps) {
  return (
    <View collapsable={false} style={styles.background} testID="felt-background">
      <Image
        source={require('../../../assets/images/bg.png')}
        style={styles.image}
        resizeMode="cover"
        accessible={false}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  background: {
    flex: 1,
    backgroundColor: PidroColors.feltBottom,
    width: '100%',
    height: '100%',
  },
});
