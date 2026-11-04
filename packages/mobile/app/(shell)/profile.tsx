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
import { BackButton } from '@/components/ui/BackButton';
import { gradientBg } from '@/components/ui/Bevel';
import { BevelButton } from '@/components/ui/BevelButton';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { Coin, PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
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
import {
  classicRecordLine,
  legendProgress,
  levelProgress,
  medalShelf,
  monthName,
  sinceYear,
  titleLine,
  winRate,
  wornPin,
} from '@/features/profile';
import { authStore, useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { useProfileIdentity } from '@/hooks/useProfileIdentity';
import { usePillClearance } from '@/components/shell/TabPill';
import { friendsFixture } from '@/features/friends/fixtures';
import { profileFixture } from '@/features/profileFixtures';
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
  const preview = profileFixture(fixture);
  const previewFriends = preview ?? friendsFixture(fixture);
  const storedFriends = useFriendsStore((state) => state.friends);
  const friends = previewFriends?.friends ?? storedFriends;
  const friendsOn = friends.filter((friend) => friend.presence !== 'offline').length;
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
  const [medalsOpen, setMedalsOpen] = useState(false);
  const [identity, setIdentity] = useState<ProfileIdentity | undefined>(preview?.identity);
  const classic = identity?.classic ?? null;
  const pinChoice = useSettingsStore((state) => (user ? state.pins[user.id] : undefined));
  const setPin = useSettingsStore((state) => state.setPin);
  const pin = wornPin(pinChoice, !!classic);
  // The cards wait for the profile's answer so nothing below them moves when it lands.
  const [answered, setAnswered] = useState(!!preview);
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
      if (profileFixture(fixture)) return;
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
  const title = titleLine(veteran);
  const since = identity ? sinceYear(identity) : null;
  const avatarSize = shortWindow ? 104 : 136;
  const legend = legendProgress(veteran);
  const level = legend ?? { ...levelProgress(veteran), next: t('profile.all_time') };
  const shelf = medalShelf(identity?.achievements, identity?.achievements_catalog);
  const classicSince = classic ? sinceYear({ classic }) : null;
  const openFriends = () =>
    router.push({
      pathname: '/friends',
      params: { from: 'profile', ...(__DEV__ && fixture ? { fixture } : {}) },
    });

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
        <BackButton onPress={() => router.back()} />
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
                  prestige={veteran?.prestige}
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
              {title.text ? (
                <PidroText
                  testID="profile-title"
                  role="label"
                  align="center"
                  style={[styles.title, title.legend && styles.gold]}>
                  {title.text}
                </PidroText>
              ) : null}
              {veteran ? (
                <PidroText testID="profile-since" role="metadata" tone="soft" align="center">
                  {since
                    ? t('profile.level_since', {
                        level: formatNumber(veteran.level),
                        year: String(since),
                      })
                    : t('profile.level', { number: formatNumber(veteran.level) })}
                </PidroText>
              ) : null}
              {classic ? (
                <PressableFX
                  testID="profile-classic-chip"
                  accessibilityRole="button"
                  onPress={() => setBadgesOpen(true)}
                  style={styles.chipTarget}>
                  <View style={styles.classicChip}>
                    <Coin material="wood" size={24} rim={2} style={styles.inlineCoin}>
                      <Icon name="spade" size={11} color={PidroBevel.textGold} />
                    </Coin>
                    <PidroText role="label" style={styles.chipLabel}>
                      {t('profile.classic_app')}
                    </PidroText>
                  </View>
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
                <Surface variant="window" style={styles.record} testID="profile-record">
                  {identity?.record ? (
                    <>
                      <View
                        accessible
                        accessibilityLabel={`${t('profile.games_played')}: ${formatNumber(identity.record.games)}`}
                        style={styles.stat}>
                        <PidroText role="title" align="center" style={styles.number}>
                          {formatNumber(identity.record.games)}
                        </PidroText>
                        <PidroText role="metadata" tone="soft" align="center">
                          {t('profile.games')}
                        </PidroText>
                      </View>
                      <View
                        accessible
                        accessibilityLabel={`${t('profile.win_rate')}: ${winRate(identity.record.win_rate)}`}
                        style={[styles.stat, styles.middleStat]}>
                        <PidroText role="title" align="center" style={styles.number}>
                          {winRate(identity.record.win_rate)}
                        </PidroText>
                        <PidroText role="metadata" tone="soft" align="center">
                          {t('profile.won')}
                        </PidroText>
                      </View>
                    </>
                  ) : null}
                  <PressableFX
                    testID="profile-friends-cell"
                    accessibilityRole="button"
                    accessibilityLabel={
                      friendsOn
                        ? t('profile.friends_on_label', {
                            number: formatNumber(friends.length),
                            online: formatNumber(friendsOn),
                          })
                        : t('profile.friends_label', { number: formatNumber(friends.length) })
                    }
                    onPress={openFriends}
                    style={styles.stat}>
                    <View style={styles.friendsCount}>
                      <PidroText role="title" tone="cyan" style={styles.number}>
                        {formatNumber(friends.length)}
                      </PidroText>
                      <Icon name="chevron-right" size={18} color={PidroColors.cyanText} />
                    </View>
                    <View style={styles.friendsCaption}>
                      {friendsOn ? <View style={styles.onlineDot} /> : null}
                      <PidroText role="metadata" tone="soft" numberOfLines={1}>
                        {friendsOn
                          ? t('profile.friends_on', { number: formatNumber(friendsOn) })
                          : t('profile.friends_caption', { count: friends.length })}
                      </PidroText>
                    </View>
                  </PressableFX>
                </Surface>
                {veteran?.xp != null ? (
                  <Surface variant="window" padded style={styles.xp} testID="profile-xp">
                    <View style={styles.xpTop}>
                      <View style={styles.figure}>
                        <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                          {level.next}
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
                {shelf.medals.length ? (
                  <Surface variant="subtle" style={styles.medals} testID="profile-medals">
                    <View style={styles.medalsHeading}>
                      <PidroText role="label">{t('profile.medals')}</PidroText>
                      {shelf.total > shelf.medals.length ? (
                        <TextLink
                          testID="profile-medals-all"
                          label={t('profile.medals_all', { number: formatNumber(shelf.total) })}
                          accessibilityLabel={t('profile.medals_all_label', {
                            number: formatNumber(shelf.total),
                          })}
                          onPress={() => setMedalsOpen(true)}
                          style={styles.medalsAll}
                        />
                      ) : null}
                    </View>
                    <View style={styles.shelf}>
                      {shelf.medals.map((medal) => (
                        <View
                          key={medal.key}
                          accessible
                          accessibilityLabel={
                            medal.earned
                              ? medal.name
                              : t('profile.medal_locked', { name: medal.name })
                          }
                          style={styles.medal}>
                          <MedalCoin name={medal.name} earned={medal.earned} size={50} />
                          <PidroText
                            role="metadata"
                            tone="soft"
                            align="center"
                            style={styles.medalName}>
                            {medal.name}
                          </PidroText>
                        </View>
                      ))}
                    </View>
                  </Surface>
                ) : null}
                {classic ? (
                  <PressableFX
                    testID="profile-classic-row"
                    accessibilityRole="button"
                    onPress={() => setBadgesOpen(true)}
                    style={[styles.accountRow, styles.classicRow]}>
                    <Coin material="wood" size={48} rim={3} style={styles.inlineCoin}>
                      <Icon name="spade" size={20} color={PidroBevel.textGold} />
                    </Coin>
                    <View style={styles.accountCopy}>
                      <PidroText role="label">
                        {classicSince
                          ? t('profile.classic_years', {
                              from: String(classicSince),
                              to: String(new Date().getFullYear()),
                            })
                          : t('profile.classic_app')}
                      </PidroText>
                      <PidroText role="metadata" tone="soft">
                        {classicRecordLine(classic)}
                      </PidroText>
                    </View>
                  </PressableFX>
                ) : identity ? (
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
                  accessibilityActions={
                    user?.guest ? undefined : [{ name: 'blocked', label: t('blocks.title') }]
                  }
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'blocked') router.push('/blocked-players');
                  }}
                  onPress={() => router.replace('/settings')}
                  style={styles.accountRow}>
                  <Icon name="mail" size={20} />
                  <View style={styles.accountCopy}>
                    {/* Above the link's 44pt target, so a tap on the title opens the account. */}
                    <PidroText role="label" style={styles.accountTitle}>
                      {t('profile.account')}
                    </PidroText>
                    <View style={styles.accountLine}>
                      <PidroText
                        role="metadata"
                        tone="soft"
                        numberOfLines={user?.email ? 1 : undefined}
                        style={styles.email}>
                        {user?.email ??
                          t(user?.guest ? 'profile.guest_unsaved' : 'profile.sign_out_delete')}
                      </PidroText>
                      {!user?.guest ? (
                        <>
                          <PidroText role="metadata" tone="soft">
                            ·
                          </PidroText>
                          <TextLink
                            testID="profile-blocked-link"
                            label={t('blocks.title')}
                            size={14}
                            onPress={() => router.push('/blocked-players')}
                            style={styles.blockedLink}
                          />
                        </>
                      ) : null}
                    </View>
                  </View>
                  <Icon name="chevron-right" size={18} />
                </PressableFX>
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
      <Modal
        isOpen={medalsOpen}
        title={t('profile.medals')}
        onClose={() => setMedalsOpen(false)}
        scrollable>
        <View testID="profile-medals-list" style={styles.medalList}>
          {medalShelf(identity?.achievements, identity?.achievements_catalog, Infinity).medals.map(
            (medal) => (
              <View
                key={medal.key}
                accessible
                accessibilityLabel={
                  medal.earned ? medal.name : t('profile.medal_locked', { name: medal.name })
                }
                style={styles.medalRow}>
                <MedalCoin name={medal.name} earned={medal.earned} size={36} />
                <PidroText role="label" tone={medal.earned ? 'default' : 'muted'}>
                  {medal.name}
                </PidroText>
              </View>
            )
          )}
          <TextLink label={t('profile.close')} onPress={() => setMedalsOpen(false)} />
        </View>
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
        prestige={veteran?.prestige}
        classic={classic}
        pin={pin}
        onChoosePin={(choice) => user && setPin(user.id, choice)}
      />
    </ScreenShell>
  );
}

/** A medal: a gold-rimmed wood coin with its initial once earned, dim glass until then. */
function MedalCoin({ name, earned, size }: { name: string; earned: boolean; size: number }) {
  return (
    <View style={!earned && styles.locked}>
      <Coin material={earned ? 'wood' : 'glass'} size={size} rim={3} style={styles.inlineCoin}>
        <PidroText
          maxFontSizeMultiplier={1}
          style={[
            styles.medalInitial,
            { fontSize: Math.round(size * 0.36), lineHeight: Math.round(size * 0.48) },
            !earned && styles.lockedInitial,
          ]}>
          {name.charAt(0)}
        </PidroText>
      </Coin>
    </View>
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
    fontSize: 34,
    lineHeight: 40,
    color: PidroBevel.textGold,
    textShadowColor: 'rgba(20, 8, 0, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  title: { fontSize: 17, lineHeight: 22 },
  gold: { color: PidroBevel.textGold },
  // The chip is drawn 32 tall; the touch target around it is the full 44.
  chipTarget: {
    minHeight: PidroLayout.touchTarget,
    justifyContent: 'center',
    marginTop: 2,
  },
  classicChip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    paddingLeft: 4,
    paddingRight: 14,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroBevel.rim,
    backgroundColor: PidroColors.panel,
  },
  chipLabel: { fontSize: 13, lineHeight: 18 },
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
  record: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 6 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
  friendsCount: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  friendsCaption: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PidroColors.presenceOnline,
  },
  medals: { gap: 12, paddingVertical: 14, paddingHorizontal: PidroSpacing.md },
  medalsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  medalsAll: { marginVertical: -12, marginRight: -12 },
  shelf: { flexDirection: 'row', gap: 6 },
  medal: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  medalName: { fontSize: 11, lineHeight: 13 },
  medalInitial: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    color: PidroBevel.textGold,
    textAlign: 'center',
  },
  locked: { opacity: 0.4 },
  lockedInitial: { color: PidroColors.text },
  medalList: { gap: PidroSpacing.sm },
  medalRow: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm },
  classicRow: { gap: 14, paddingVertical: 14, paddingHorizontal: PidroSpacing.md },
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
  accountTitle: { zIndex: 1 },
  accountLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 },
  email: { flexShrink: 1 },
  // The link keeps its 44 target without making the row taller.
  blockedLink: { marginVertical: -13, paddingHorizontal: 2 },
  claim: { gap: PidroSpacing.md },
  claimHeading: { gap: PidroSpacing.xxs },
});
