import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroColors, PidroSpacing } from '@/design/tokens';
import { LEAGUES, leagueName } from '@/features/league';
import { useTranslation } from '@/i18n';
import { LeagueCard } from './LeagueCard';

export function LeagueRules({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      visible={isOpen}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
          <Surface
            variant="window"
            padded
            testID="league-rules"
            style={[styles.sheet, wide && styles.wide]}>
            <PidroText role="title" align="center" accessibilityRole="header">
              {t('league.rules.title')}
            </PidroText>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.body, wide && styles.columns]}>
              <View style={styles.cards}>
                {LEAGUES.map(({ id }) => (
                  <View key={id} style={styles.card}>
                    <LeagueCard league={id} size={30} />
                    <PidroText role="metadata">{leagueName(id)}</PidroText>
                  </View>
                ))}
              </View>
              <View style={styles.copy}>
                {(['points', 'players', 'move', 'profile'] as const).map((key) => (
                  <PidroText key={key} role="body" tone="soft">
                    {t(`league.rules.${key}`)}
                  </PidroText>
                ))}
              </View>
            </ScrollView>
            <TextLink testID="league-rules-close" label={t('profile.close')} onPress={onClose} />
          </Surface>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: PidroSpacing.md,
    backgroundColor: PidroColors.backdrop,
  },
  sheet: { width: '100%', maxWidth: 436, maxHeight: '100%', gap: PidroSpacing.md },
  wide: { maxWidth: 800 },
  scroll: { flexShrink: 1 },
  body: { gap: PidroSpacing.lg },
  columns: { flexDirection: 'row', alignItems: 'center' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: PidroSpacing.sm },
  card: { alignItems: 'center', gap: PidroSpacing.xs },
  copy: { flexShrink: 1, gap: PidroSpacing.sm },
});
