import { StyleSheet, View } from 'react-native';
import { LeagueProgress } from '@/components/home/LeagueProgress';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { PidroFonts, PidroSpacing, PidroType } from '@/design/tokens';
import { useLocale } from '@/i18n';

export function UpdatingScreen({ progress }: { progress: number }) {
  const locale = useLocale();
  const label = locale === 'sv' ? 'Uppdaterar Pidro…' : 'Updating Pidro…';
  return (
    <ScreenShell testID="updating-screen" contentStyle={styles.content}>
      <PidroText role="score" tone="gold" style={styles.wordmark}>
        Pidro
      </PidroText>
      <View style={styles.status}>
        <LeagueProgress
          progress={progress}
          label={label}
          width={220}
          height={10}
          showLabel={false}
        />
        <PidroText role="title" align="center" accessibilityLiveRegion="polite">
          {label}
        </PidroText>
        <PidroText role="body" tone="muted">
          {locale === 'sv' ? 'Några sekunder' : 'A few seconds'}
        </PidroText>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', alignItems: 'center', gap: PidroSpacing.xl },
  wordmark: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    lineHeight: Math.ceil(PidroType.score.fontSize * 1.3),
  },
  status: { alignItems: 'center', gap: PidroSpacing.md },
});
