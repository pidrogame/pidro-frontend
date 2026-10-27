import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { localizedError, type ProfileIdentity } from '@pidro/shared';
import { profileApi } from '@/api/profile';
import { BevelButton } from '@/components/ui/BevelButton';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import { friendSheetState, type FriendEntry, type FriendRelation } from '@/features/friends';
import { useTranslation } from '@/i18n';

interface Props {
  player: FriendEntry;
  relation: FriendRelation;
  onAction: (action: 'join' | 'play' | 'accept' | 'remove' | 'block') => Promise<void>;
  onProfile: () => void;
  onClose: () => void;
  fixture?: ProfileIdentity;
  initialConfirm?: 'remove' | 'block';
}

export function FriendSheet({
  player,
  relation,
  onAction,
  onProfile,
  onClose,
  fixture,
  initialConfirm,
}: Props) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  const [profile, setProfile] = useState<ProfileIdentity | undefined>(
    __DEV__ ? fixture : undefined
  );
  const [confirm, setConfirm] = useState<'remove' | 'block' | null>(
    __DEV__ ? (initialConfirm ?? null) : null
  );
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [handoff, setHandoff] = useState(false);
  const pendingProfile = useRef(false);
  const state = friendSheetState(player, relation);
  const params = { name: player.display_name };
  const finishHandoff = () => {
    if (!pendingProfile.current) return;
    pendingProfile.current = false;
    onProfile();
  };
  useEffect(() => {
    if (handoff && Platform.OS !== 'ios') finishHandoff();
  });
  useEffect(() => {
    if (__DEV__ && fixture) return;
    let active = true;
    profileApi
      .getPlayer(player.user_id)
      .then((answer) => {
        if (active) setProfile(answer);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [player.user_id, fixture]);

  const run = async (action: Parameters<Props['onAction']>[0]) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onAction(action);
    } catch (cause) {
      setError(cause ?? true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={!handoff}
      onDismiss={finishHandoff}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={() => {
        if (!busy) onClose();
      }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityLabel={t('profile.close')}
            disabled={busy}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID="friend-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, wide && styles.wideSheet]}>
            <View style={styles.grabber} />
            <View style={styles.close}>
              <DismissButton
                accessibilityLabel={t('profile.close')}
                disabled={busy}
                onPress={onClose}
              />
            </View>
            <View style={[styles.content, wide && styles.columns]}>
              <View style={[styles.summary, wide && styles.wideSummary]}>
                {confirm ? (
                  <>
                    <PidroText role="title" accessibilityRole="header">
                      {t(
                        confirm === 'remove'
                          ? 'friend_sheet.remove_title'
                          : 'friend_sheet.block_title',
                        params
                      )}
                    </PidroText>
                    <PidroText role="body" tone="soft">
                      {t(
                        confirm === 'remove'
                          ? 'friend_sheet.remove_body'
                          : 'friend_sheet.block_body',
                        params
                      )}
                    </PidroText>
                  </>
                ) : (
                  <>
                    <View style={styles.identity}>
                      <PlayerAvatar
                        size={64}
                        uri={profile?.avatar_url ?? player.avatar_url}
                        level={profile?.veteran?.level}
                      />
                      <View style={styles.copy}>
                        <PidroText role="display" accessibilityRole="header" style={styles.name}>
                          {player.display_name}
                        </PidroText>
                        <PidroText
                          role="metadata"
                          tone="soft"
                          style={state.tone === 'gold' && styles.gold}>
                          {state.line}
                        </PidroText>
                      </View>
                    </View>
                    {state.action ? (
                      <View style={styles.main}>
                        <BevelButton
                          label={state.label}
                          fullWidth
                          loading={busy}
                          onPress={() => void run(state.action!)}
                        />
                        {state.hint ? (
                          <PidroText role="metadata" tone="soft" align="center">
                            {state.hint}
                          </PidroText>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                )}
                {error ? (
                  <PidroText role="body" tone="danger" accessibilityRole="alert">
                    {localizedError(
                      error,
                      confirm === 'block'
                        ? 'blocks.block_failed'
                        : confirm === 'remove'
                          ? 'friends.remove_failed'
                          : state.action === 'accept'
                            ? 'friends.add_failed'
                            : 'social.seat_error'
                    )}
                  </PidroText>
                ) : null}
              </View>
              <View style={[styles.actions, wide && styles.wideActions]}>
                {confirm ? (
                  <View style={styles.confirmActions}>
                    <BevelButton
                      label={t(
                        confirm === 'remove' ? 'friend_sheet.remove_confirm' : 'blocks.block'
                      )}
                      fullWidth
                      loading={busy}
                      onPress={() => void run(confirm)}
                    />
                    <BevelButton
                      label={
                        confirm === 'remove' ? t('friend_sheet.keep', params) : t('common.cancel')
                      }
                      material="glass"
                      fullWidth
                      disabled={busy}
                      onPress={() => {
                        setConfirm(null);
                        setError(null);
                      }}
                    />
                  </View>
                ) : (
                  <>
                    <PressableFX
                      accessibilityRole="button"
                      accessibilityLabel={t('friend_sheet.profile')}
                      disabled={busy}
                      style={styles.line}
                      pressedStyle={styles.pressed}
                      onPress={() => {
                        pendingProfile.current = true;
                        setHandoff(true);
                      }}>
                      <Icon name="user" size={22} color={PidroColors.cyanText} />
                      <PidroText role="label" style={styles.lineLabel}>
                        {t('friend_sheet.profile')}
                      </PidroText>
                      <Icon name="chevron-right" size={18} color={PidroColors.textSoft} />
                    </PressableFX>
                    {relation === 'friend' ? (
                      <>
                        <View style={styles.separator} />
                        <PressableFX
                          accessibilityRole="button"
                          accessibilityLabel={t('friend_sheet.remove')}
                          disabled={busy}
                          style={styles.line}
                          pressedStyle={styles.pressed}
                          onPress={() => {
                            setError(null);
                            setConfirm('remove');
                          }}>
                          <Icon name="person-minus" size={22} color={PidroColors.iconOnGlass} />
                          <PidroText role="label" style={styles.lineLabel}>
                            {t('friend_sheet.remove')}
                          </PidroText>
                        </PressableFX>
                      </>
                    ) : null}
                    <View style={styles.separator} />
                    <PressableFX
                      accessibilityRole="button"
                      accessibilityLabel={t('friend_sheet.block', params)}
                      disabled={busy}
                      style={styles.line}
                      pressedStyle={styles.pressed}
                      onPress={() => {
                        setError(null);
                        setConfirm('block');
                      }}>
                      <Icon name="block" size={22} color={PidroColors.danger} />
                      <PidroText role="label" style={[styles.lineLabel, styles.warn]}>
                        {t('friend_sheet.block', params)}
                      </PidroText>
                    </PressableFX>
                  </>
                )}
              </View>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.backdrop },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: PidroSpacing.lg,
    gap: PidroSpacing.md,
  },
  wideSheet: { maxWidth: 760 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  close: { position: 'absolute', top: 0, right: 0 },
  content: { gap: PidroSpacing.md },
  columns: { flexDirection: 'row', gap: PidroSpacing.lg },
  summary: { gap: PidroSpacing.md },
  wideSummary: { flex: 1 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 14,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: {
    fontFamily: PidroFonts.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '400',
    color: PidroBevel.textGold,
  },
  gold: { color: PidroBevel.textGold },
  main: { gap: 10, paddingBottom: 6 },
  actions: { minWidth: 0 },
  wideActions: { flex: 1, justifyContent: 'center' },
  line: {
    minHeight: 52,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: PidroRadii.panel,
  },
  lineLabel: { flex: 1 },
  warn: { color: PidroColors.danger },
  pressed: { backgroundColor: PidroColors.actionPill },
  separator: { height: 1, backgroundColor: PidroColors.border },
  confirmActions: { gap: PidroSpacing.sm },
});
