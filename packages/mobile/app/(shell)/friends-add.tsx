import { useCallback, useState } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { FriendDiscovery } from '@/components/friends/FriendDiscovery';
import { InfoCard } from '@/components/friends/InfoCard';
import { usePillClearance } from '@/components/shell/TabPill';
import { BackButton } from '@/components/ui/BackButton';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Toast } from '@/components/ui/Toast';
import { PidroBevel, PidroColors, PidroFonts, PidroSpacing } from '@/design/tokens';
import { friendLinkMessage } from '@/features/friends';
import { discoveryFixture } from '@/features/friends/fixtures';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/i18n';

export default function AddFriendScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { fixture, state } = useLocalSearchParams<{ fixture?: string; state?: string }>();
  const preview = discoveryFixture(fixture ?? (state === 'friends-add' ? 'recent' : undefined));
  const user = useAuthStore((state) => state.user);
  const clearance = usePillClearance();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [query, setQuery] = useState(preview && fixture === 'results' ? 'Nor' : '');
  const [sent, setSent] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const dismissToast = useCallback(() => setSent(null), []);

  if (user?.guest) return <Redirect href="/friends" />;
  return (
    <View style={styles.root}>
      <ScreenShell
        scroll
        compact={!landscape}
        testID="friends-add-screen"
        contentStyle={[
          styles.content,
          landscape && styles.landscape,
          {
            paddingBottom: PidroSpacing.md + clearance.bottom,
            paddingRight: PidroSpacing.md + clearance.right,
          },
        ]}>
        <View style={[styles.intro, landscape && styles.sidebar]}>
          <View style={styles.header}>
            <BackButton onPress={() => router.back()} />
            <PidroText role="title" accessibilityRole="header" style={styles.title}>
              {t('friends.add_friend')}
            </PidroText>
          </View>
          <View style={styles.search}>
            <Input
              accessibilityLabel={t('friends.find')}
              placeholder={t('friends.find')}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.searchInput}
            />
            <View pointerEvents="none" style={styles.searchIcon}>
              <Icon name="search" size={20} color={PidroColors.textSoft} />
            </View>
          </View>
          {landscape ? card() : null}
        </View>
        <View style={landscape && styles.column}>
          <FriendDiscovery query={query} preview={preview} onSent={setSent} />
        </View>
        {!landscape ? card() : null}
      </ScreenShell>
      {sent ? (
        <Toast
          key={sent}
          message={t('friends.sent_toast', { name: sent })}
          onDismiss={dismissToast}
        />
      ) : null}
    </View>
  );

  function card() {
    return (
      <View style={styles.intro}>
        <InfoCard
          title={t('friends.not_on_pidro')}
          body={t('friends.not_on_pidro_body')}
          action={{
            label: t('friends.send_link'),
            icon: 'link',
            onPress: async () => {
              setShareError(false);
              try {
                await Share.share({
                  message: friendLinkMessage(user?.share_slug, Constants.expoConfig?.extra?.variant)
                    .message,
                });
              } catch {
                setShareError(true);
              }
            },
          }}
        />
        {shareError ? (
          <PidroText role="body" tone="danger" accessibilityRole="alert">
            {t('invite.host.shareError')}
          </PidroText>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16 },
  intro: { gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: {
    flex: 1,
    fontFamily: PidroFonts.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '400',
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
  },
  landscape: { flexDirection: 'row', gap: 20 },
  sidebar: { flex: 1, minWidth: 0 },
  column: { flex: 1.4, minWidth: 0 },
  search: { position: 'relative' },
  searchInput: { paddingLeft: 44 },
  searchIcon: { position: 'absolute', left: 14, top: 15 },
});
