import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { PidroColors, PidroFonts, PidroSpacing, PidroType } from '@/design/tokens';
import { useTranslation } from '@/i18n';

/** A version the server says is too old to play: one way on, to the store. No back, no later. */
export function UpdateRequiredScreen({ url }: { url: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  // The app's screens are gone, so this keeps the lobby joined: a later answer can lift it.
  useLobbyChannel();
  const update = () => {
    setFailed(false);
    Linking.openURL(url).catch(() => setFailed(true));
  };
  return (
    <ScreenShell testID="update-required-screen" compact contentStyle={styles.content}>
      <PidroText role="score" tone="gold" style={styles.wordmark}>
        Pidro
      </PidroText>
      <View style={styles.copy}>
        <PidroText accessibilityRole="header" align="center" style={styles.title}>
          {t('update.requiredTitle')}
        </PidroText>
        <PidroText tone="soft" align="center" style={styles.body}>
          {t('update.requiredBody')}
        </PidroText>
      </View>
      <View style={styles.actions}>
        <BevelButton
          testID="update-required-action"
          label={t('update.requiredAction')}
          size="lg"
          fullWidth
          onPress={update}
        />
        {failed ? (
          <PidroText tone="danger" align="center" accessibilityRole="alert">
            {t('news.popupFailed')}
          </PidroText>
        ) : null}
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
  copy: { alignItems: 'center', gap: PidroSpacing.sm },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 30,
    lineHeight: 38,
    color: PidroColors.gold,
  },
  body: { fontSize: 18, lineHeight: 27 },
  actions: { alignSelf: 'stretch', gap: PidroSpacing.sm },
});
