import { useCallback, useState } from 'react';
import { Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { BIO_MAX_LENGTH, bioError, bioLength, normalizeBio, publicPlayerName } from '@pidro/shared';
import { profileApi, type ProfileIdentity } from '@/api/profile';
import { localizedError, localizedFieldErrors } from '@/utils/apiErrors';
import { useTranslation, formatNumber, type TranslationKey } from '@/i18n';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { BadgeSheet } from '@/components/profile/BadgeSheet';
import { gradientBg } from '@/components/ui/Bevel';
import { BevelButton } from '@/components/ui/BevelButton';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { Coin, PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { levelProgress, monthName, winRate, wornPin, veteranTitle } from '@/features/profile';
import { authStore, useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { useProfileIdentity } from '@/hooks/useProfileIdentity';
import { usePillClearance } from '@/components/shell/TabPill';
import { friendsFixture } from '@/features/friends/fixtures';
import { refreshFriends, useFriendsStore } from '@/stores/friends';

export default function ProfileScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  return <ProfileContent key={userId} />;
}

function ProfileContent() {
  const { t } = useTranslation();
  const bioValidation = (value: string) =>
    !bioError(value)
      ? null
      : t(bioLength(value) > BIO_MAX_LENGTH ? 'profile.bio_long' : 'profile.bio_invalid', {
          number: formatNumber(BIO_MAX_LENGTH),
        });
  const { width, height, fontScale } = useWindowDimensions();
  // Window width also handles iPad split view. Larger text gets the roomier stack.
  const twoColumns = width >= PidroLayout.landscapeMinWidth * Math.max(1, fontScale);
  const shortWindow = height < PidroLayout.compactHeight;
  const pillClearance = usePillClearance();
  const horizontalPadding = width > height ? PidroSpacing.lg : PidroSpacing.md;
  const user = useAuthStore((state) => state.user);
  const { classicClaimed, fixture } = useLocalSearchParams<{
    classicClaimed?: string;
    fixture?: string;
  }>();
  const previewFriends = friendsFixture(fixture);
  const storedFriends = useFriendsStore((state) => state.friends);
  const friendCount = (previewFriends?.friends ?? storedFriends).length;
  const router = useRouter();
  const navigation = useNavigation();
  const refreshIdentity = useProfileIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    cause?: unknown;
    fallback: TranslationKey;
    field?: string;
  } | null>(null);
  const [status, setStatus] = useState<TranslationKey | null>(null);
  const errorText = error
    ? ((error.field ? localizedFieldErrors(error.cause)[error.field] : undefined) ??
      localizedError(error.cause, error.fallback))
    : undefined;
  const [editor, setEditor] = useState<'bio' | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [bioBaseline, setBioBaseline] = useState('');
  const [accountSheetOpen, setAccountSheetOpen] = useState(classicClaimed === 'guest');
  const photoFixture = __DEV__ && fixture?.startsWith('photo-') ? fixture : undefined;
  const [badgesOpen, setBadgesOpen] = useState(!!photoFixture && photoFixture !== 'photo-profile');
  const [identity, setIdentity] = useState<ProfileIdentity | undefined>(undefined);
  const classic = identity?.classic ?? null;
  const pinChoice = useSettingsStore((state) => (user ? state.pins[user.id] : undefined));
  const setPin = useSettingsStore((state) => state.setPin);
  const pin = wornPin(pinChoice, !!classic);
  // The cards wait for the profile's answer so nothing below them moves when it lands.
  const [answered, setAnswered] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: TranslationKey;
    description: TranslationKey;
    label: TranslationKey;
    cancelLabel?: TranslationKey;
    proceed: () => void;
  } | null>(null);
  const dirty = editor === 'bio' && normalizeBio(bioDraft) !== bioBaseline;

  const closeEditor = () => {
    Keyboard.dismiss();
    setEditor(null);
    setError(null);
  };

  const confirmDiscard = (proceed: () => void) => {
    setConfirmation({
      title: 'profile.discard_title',
      description: 'profile.discard_help',
      label: 'profile.discard',
      cancelLabel: 'profile.keep_editing',
      proceed: () => {
        closeEditor();
        proceed();
      },
    });
  };

  usePreventRemove(!!dirty || busy, ({ data }) => {
    if (busy) {
      setConfirmation({
        title: 'profile.wait',
        description: 'profile.processing_help',
        label: 'profile.ok',
        proceed: () => {},
      });
    } else {
      confirmDiscard(() => navigation.dispatch(data.action));
    }
  });

  useFocusEffect(
    useCallback(() => {
      if (!user?.guest && !friendsFixture(fixture)) void refreshFriends().catch(() => undefined);
      void refreshIdentity()
        .then((next) => {
          if (next) setIdentity(next);
          setRefreshError(false);
        })
        .catch(() => setRefreshError(true))
        .finally(() => setAnswered(true));
    }, [refreshIdentity, user?.guest, fixture])
  );

  const beginEdit = () => {
    const open = () => {
      closeEditor();
      setBioDraft(user?.bio ?? '');
      setBioBaseline(normalizeBio(user?.bio ?? ''));
      setEditor('bio');
      setStatus(null);
    };
    if (dirty) confirmDiscard(open);
    else open();
  };

  const saveBio = async () => {
    const validationError = bioError(bioDraft);
    if (validationError) {
      return;
    }
    const session = authStore.getState();
    if (!session.user || !session.accessToken) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await profileApi.updateBio(bioDraft);
      const current = authStore.getState();
      if (current.user?.id !== session.user.id || current.accessToken !== session.accessToken)
        return;
      authStore.setState({ user: { ...current.user, bio: result.bio } });
      setBioDraft(normalizeBio(bioDraft));
      setEditor(null);
      setStatus('profile.bio_saved');
      Keyboard.dismiss();
    } catch (saveError) {
      setError({ cause: saveError, fallback: 'profile.bio_error', field: 'bio' });
    } finally {
      setBusy(false);
    }
  };

  const name = publicPlayerName(user?.username, t('social.player'), user?.display_name);
  const veteran = identity?.veteran;
  const title = veteranTitle(veteran?.title);
  const avatarSize = shortWindow ? 104 : 124;
  const level = levelProgress(veteran);

  const saveProgress = user?.guest ? (
    <BevelButton
      label={t('profile.save_progress')}
      material="glass"
      size="sm"
      fullWidth
      onPress={() => setAccountSheetOpen(true)}
    />
  ) : null;

  return (
    <ScreenShell
      scroll
      compact={!twoColumns}
      testID="profile-screen"
      contentStyle={{
        paddingBottom: PidroSpacing.md + pillClearance.bottom,
        paddingRight: horizontalPadding + pillClearance.right,
      }}>
      <View className={shortWindow ? 'gap-3' : 'gap-6'}>
        <ScreenHeader title={t('profile.title')} onBack={() => router.back()} />
        <PressableFX
          testID="profile-friends-row"
          accessibilityRole="button"
          accessibilityLabel={`${t('social.friends')}, ${formatNumber(friendCount)}`}
          onPress={() =>
            router.push({
              pathname: '/friends',
              params: { from: 'profile', ...(__DEV__ && fixture ? { fixture } : {}) },
            })
          }
          style={styles.accountRow}>
          <Icon name="friends" size={20} />
          <PidroText role="label" style={styles.accountCopy}>
            {t('social.friends')}
          </PidroText>
          <PidroText role="label" tone="soft">
            {formatNumber(friendCount)}
          </PidroText>
          <Icon name="chevron-right" size={18} />
        </PressableFX>
        {!user?.guest ? (
          <TextLink label={t('blocks.title')} onPress={() => router.push('/blocked-players')} />
        ) : null}
        {refreshError && (
          <PidroText role="metadata" tone="danger" accessibilityRole="alert">
            {t('profile.refresh_error')}
          </PidroText>
        )}
        <View className={twoColumns ? 'flex-row items-start gap-4' : 'gap-4'}>
          <View
            testID="profile-identity-column"
            className={twoColumns ? 'w-[38%] gap-4' : 'w-full gap-4'}>
            <View style={styles.identity}>
              <PressableFX
                testID="profile-avatar-button"
                accessibilityRole="button"
                accessibilityLabel={t(user?.guest ? 'profile.badges' : 'profile.photo_and_ring')}
                onPress={() => setBadgesOpen(true)}
                style={styles.avatarButton}>
                <PlayerAvatar
                  testID="profile-avatar"
                  size={avatarSize}
                  uri={user?.avatar_url}
                  level={veteran?.level}
                  pin={pin}
                />
                {!user?.guest ? (
                  <View
                    testID="profile-camera-badge"
                    style={styles.camera}
                    pointerEvents="none"
                    aria-hidden>
                    <Coin material="glass" size={32} rim={2} style={styles.inlineCoin}>
                      <Icon name="camera" size={18} />
                    </Coin>
                  </View>
                ) : null}
              </PressableFX>
              <PidroText style={styles.name} align="center" numberOfLines={2}>
                {name}
              </PidroText>
              {veteran ? (
                <PidroText role="label" align="center">
                  {title ? `${title} · ` : ''}
                  {t('profile.level', { number: formatNumber(veteran.level) })}
                </PidroText>
              ) : null}
              {classic ? (
                <PressableFX
                  testID="profile-classic-chip"
                  accessibilityRole="button"
                  onPress={() => setBadgesOpen(true)}
                  style={styles.classicChip}>
                  <Coin material="wood" size={28} rim={2} style={styles.inlineCoin}>
                    <Icon name="spade" size={13} color={PidroBevel.textGold} />
                  </Coin>
                  <PidroText role="label">
                    {t('profile.classic_app')}
                    {classic.level != null
                      ? ` · ${t('profile.level', { number: formatNumber(classic.level) })}`
                      : ''}
                  </PidroText>
                  <Icon name="chevron-right" size={16} color={PidroBevel.rim} />
                </PressableFX>
              ) : null}
            </View>
            {twoColumns && saveProgress}
          </View>
          <View
            testID="profile-bio-column"
            className={twoColumns ? 'min-w-0 flex-1 gap-4' : 'w-full gap-4'}>
            {answered ? (
              <>
                {veteran?.xp != null ? (
                  <Surface variant="window" padded style={styles.xp} testID="profile-xp">
                    <View style={styles.xpTop}>
                      <View style={styles.figure}>
                        <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                          {t('profile.all_time')}
                        </PidroText>
                        <PidroText role="title" style={styles.number}>
                          {formatNumber(veteran.xp)} XP
                        </PidroText>
                      </View>
                      {level.caption ? (
                        <PidroText role="metadata" tone="soft" align="right">
                          {level.caption}
                        </PidroText>
                      ) : null}
                    </View>
                    <View
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel={level.caption ?? t('profile.level_progress')}
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: Math.round(level.fraction * 100),
                      }}
                      style={styles.well}>
                      <View
                        style={[
                          styles.fill,
                          gradientBg(PidroBevel.goldRimGradient),
                          { width: `${level.fraction * 100}%` },
                        ]}
                      />
                    </View>
                    {identity?.xp ? (
                      <>
                        <View style={styles.rule} />
                        <View style={styles.periods}>
                          <View style={styles.figure}>
                            <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                              {t('social.this_week')}
                            </PidroText>
                            <PidroText role="title" style={styles.number}>
                              {formatNumber(identity.xp.this_week)} XP
                            </PidroText>
                            <TextLink
                              label={t('profile.leagues_coming')}
                              size={14}
                              onPress={() => router.replace('/league')}
                              style={styles.leagueLink}
                            />
                          </View>
                          <View style={[styles.figure, styles.month]}>
                            <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                              {monthName()}
                            </PidroText>
                            <PidroText role="title" style={styles.number}>
                              {formatNumber(identity.xp.this_month)} XP
                            </PidroText>
                          </View>
                        </View>
                      </>
                    ) : null}
                  </Surface>
                ) : null}
                {identity?.record ? (
                  <Surface variant="subtle" style={styles.record} testID="profile-record">
                    {[
                      {
                        label: t('profile.games_played'),
                        caption: t('profile.games'),
                        value: formatNumber(identity.record.games),
                      },
                      {
                        label: t('profile.wins'),
                        caption: t('profile.wins_caption'),
                        value: formatNumber(identity.record.wins),
                      },
                      {
                        label: t('profile.win_rate'),
                        caption: t('profile.win_rate_caption'),
                        value: winRate(identity.record.win_rate),
                      },
                    ].map((stat, index) => (
                      <View
                        key={stat.label}
                        accessible
                        accessibilityLabel={`${stat.label}: ${stat.value}`}
                        style={[styles.stat, index === 1 && styles.middleStat]}>
                        <PidroText role="title" align="center" style={styles.number}>
                          {stat.value}
                        </PidroText>
                        <PidroText role="metadata" tone="soft" align="center">
                          {stat.caption}
                        </PidroText>
                      </View>
                    ))}
                  </Surface>
                ) : null}
                <Surface variant="subtle" className="gap-3" padded>
                  <View className="flex-row items-center justify-between gap-3">
                    <PidroText role="label">{t('profile.about')}</PidroText>
                    {editor !== 'bio' ? (
                      <Button
                        label={t(user?.bio ? 'profile.edit' : 'profile.add')}
                        accessibilityLabel={t(user?.bio ? 'profile.edit_bio' : 'profile.add_bio')}
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onPress={beginEdit}
                      />
                    ) : null}
                  </View>
                  {editor === 'bio' ? (
                    <>
                      <Input
                        accessibilityLabel={t('profile.about')}
                        autoFocus
                        multiline
                        numberOfLines={shortWindow ? 3 : 5}
                        value={bioDraft}
                        editable={!busy}
                        onChangeText={(text) => {
                          setBioDraft(text);
                          setError(null);
                        }}
                        error={bioValidation(bioDraft) ?? errorText}
                        className={shortWindow ? 'min-h-20 py-3' : 'min-h-28 py-3'}
                        textAlignVertical="top"
                        placeholder={t('profile.bio_placeholder')}
                      />
                      <View className="flex-row flex-wrap justify-between gap-3">
                        <PidroText role="metadata" tone="muted">
                          {t('profile.visible')}
                        </PidroText>
                        <PidroText
                          role="metadata"
                          tone={bioLength(bioDraft) > BIO_MAX_LENGTH ? 'danger' : 'muted'}
                          align="right">
                          {t('profile.remaining', {
                            number: formatNumber(BIO_MAX_LENGTH - bioLength(bioDraft)),
                          })}
                        </PidroText>
                      </View>
                      <View className="flex-row gap-2">
                        <View className="flex-1">
                          <Button
                            label={t('common.cancel')}
                            variant="outline"
                            disabled={busy}
                            onPress={closeEditor}
                          />
                        </View>
                        <View className="flex-1">
                          <Button
                            label={t('profile.save_bio')}
                            loading={busy}
                            disabled={!dirty || !!bioError(bioDraft)}
                            onPress={saveBio}
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <PidroText
                      role="body"
                      className="break-words"
                      tone={user?.bio ? 'default' : 'muted'}>
                      {user?.bio || t('profile.bio_help')}
                    </PidroText>
                  )}
                  {status && (
                    <PidroText role="metadata" tone="cyan" accessibilityLiveRegion="polite">
                      {t(status)}
                    </PidroText>
                  )}
                </Surface>
                {!twoColumns && saveProgress}
                <PressableFX
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.account')}
                  accessibilityHint={user?.email ?? undefined}
                  onPress={() => router.replace('/settings')}
                  style={styles.accountRow}>
                  <Icon name="mail" size={20} />
                  <View style={styles.accountCopy}>
                    <PidroText role="label">{t('profile.account')}</PidroText>
                    <PidroText role="metadata" tone="soft" numberOfLines={1}>
                      {user?.email ??
                        t(user?.guest ? 'profile.guest_unsaved' : 'profile.sign_out_delete')}
                    </PidroText>
                  </View>
                  <Icon name="chevron-right" size={18} />
                </PressableFX>
                {identity && !classic ? (
                  <Surface variant="panel" padded style={styles.claim}>
                    <View style={styles.claimHeading}>
                      <PidroText role="label">{t('profile.classic_app')}</PidroText>
                      <PidroText role="body" tone="soft">
                        {t('profile.classic_help')}
                      </PidroText>
                    </View>
                    <BevelButton
                      label={t('profile.claim')}
                      material="glass"
                      size="sm"
                      fullWidth
                      onPress={() => router.push('/(auth)/claim-classic')}
                    />
                  </Surface>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </View>
      <Modal
        isOpen={!!confirmation}
        title={confirmation ? t(confirmation.title) : undefined}
        description={confirmation ? t(confirmation.description) : undefined}
        onClose={() => setConfirmation(null)}>
        {confirmation && (
          <View className="gap-2">
            {confirmation.cancelLabel && (
              <Button
                label={t(confirmation.cancelLabel)}
                variant="outline"
                onPress={() => setConfirmation(null)}
              />
            )}
            <Button
              label={t(confirmation.label)}
              variant={confirmation.cancelLabel ? 'destructive' : 'outline'}
              onPress={() => {
                const proceed = confirmation.proceed;
                setConfirmation(null);
                proceed();
              }}
            />
          </View>
        )}
      </Modal>
      <AuthSheet
        isOpen={accountSheetOpen}
        onClose={() => setAccountSheetOpen(false)}
        showClaimClassic={!classic}
        onClaimClassic={() => {
          setAccountSheetOpen(false);
          router.push('/(auth)/claim-classic');
        }}
      />
      <BadgeSheet
        isOpen={badgesOpen}
        onClose={() => setBadgesOpen(false)}
        uri={user?.avatar_url}
        fixture={photoFixture}
        level={veteran?.level}
        classic={classic}
        pin={pin}
        onChoosePin={(choice) => user && setPin(user.id, choice)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    gap: 6,
  },
  avatarButton: {
    borderRadius: PidroRadii.full,
    marginBottom: PidroSpacing.sm,
  },
  camera: { position: 'absolute', left: 0, bottom: PidroSpacing.md },
  name: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 32,
    lineHeight: 40,
    color: PidroBevel.textGold,
    textShadowColor: 'rgba(20, 8, 0, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  classicChip: {
    minHeight: PidroLayout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    marginTop: 6,
    paddingLeft: PidroSpacing.xxs,
    paddingRight: PidroSpacing.sm,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroBevel.rim,
    backgroundColor: PidroColors.panel,
  },
  inlineCoin: { position: 'relative' },
  xp: { gap: PidroSpacing.sm },
  xpTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: PidroSpacing.sm,
  },
  figure: { minWidth: 0, flex: 1, gap: 2 },
  eyebrow: { letterSpacing: 1, textTransform: 'uppercase' },
  number: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  well: {
    height: 12,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.ink,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: PidroRadii.full },
  rule: { height: 1, backgroundColor: PidroColors.border },
  periods: { flexDirection: 'row', gap: PidroSpacing.sm },
  month: {
    borderLeftWidth: 1,
    borderLeftColor: PidroColors.border,
    paddingLeft: PidroSpacing.sm,
  },
  leagueLink: { alignSelf: 'flex-start', alignItems: 'flex-start', paddingHorizontal: 0 },
  record: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: PidroSpacing.xs },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  middleStat: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: PidroColors.border,
  },
  accountRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xs,
    paddingHorizontal: 14,
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.glass,
  },
  accountCopy: { minWidth: 0, flex: 1, gap: 2 },
  claim: { gap: PidroSpacing.md },
  claimHeading: { gap: PidroSpacing.xxs },
});
