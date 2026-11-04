import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import {
  builtinBotName,
  isBuiltinBot,
  localizedError,
  publicPlayerName,
  useGameStore,
  type BotPersona,
  type FriendLists,
  type PlayerSheet as SheetData,
} from '@pidro/shared';
import { profileApi } from '@/api/profile';
import { FriendState } from '@/components/friends/FriendRow';
import { BevelButton } from '@/components/ui/BevelButton';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon } from '@/components/ui/Icon';
import { Modal as PidroModal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import { botPersonas } from '@/components/ui/botPersonas';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import { useBotProfile } from '@/features/bots';
import { linkProfileAction } from '@/features/friends';
import { presenceLine, sheetTitle, togetherLines, winRate } from '@/features/profile';
import { formatNumber, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { addFriend, blockPlayer, useFriendsStore } from '@/stores/friends';

export type SheetPresence = 'table' | 'online' | 'offline';

interface Props {
  playerId: string | null;
  persona?: BotPersona | null;
  /** At your table, online, or not: what the sheet says under the title. */
  presence?: SheetPresence;
  onClose: () => void;
  /** The friends lists the screen shows; elsewhere the store's. */
  lists?: Pick<FriendLists, 'friends' | 'requested'>;
  fixture?: SheetData;
}

/**
 * Anyone's sheet (PID-340): who they are, what they earned, and the two of you.
 * A bot keeps its persona sheet.
 */
export function PlayerSheet({ playerId, persona, presence, onClose, lists, fixture }: Props) {
  if (persona) return <BotSheet persona={persona} onClose={onClose} />;
  return playerId ? (
    <PersonSheet
      key={playerId}
      playerId={playerId}
      presence={presence}
      onClose={onClose}
      lists={lists}
      fixture={__DEV__ ? fixture : undefined}
    />
  ) : null;
}

function BotSheet({ persona, onClose }: { persona: BotPersona; onClose: () => void }) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const snapshot = useGameStore(
    (state) =>
      Object.values(state.playerMeta).find((seat) => seat.bot_persona === persona)?.bot_profile
  );
  const profile = useBotProfile(persona, snapshot);
  const bot = isBuiltinBot(persona) ? botPersonas[persona] : null;
  return (
    <PidroModal isOpen title={t('bots.title')} onClose={onClose} testID="bot-profile-modal">
      <View style={[styles.bot, width > height && styles.botLandscape]}>
        <PlayerAvatar
          kind="bot"
          persona={persona}
          botProfile={profile}
          size={104}
          style={styles.center}
        />
        <View style={styles.botCopy} testID="bot-profile-copy">
          <PidroText role="title" align="center">
            {profile?.name || builtinBotName(persona) || t('game.bot')}
          </PidroText>
          <PidroText role="body" align="center">
            {bot ? t(bot.play) : profile?.description}
          </PidroText>
          <PidroText role="body" tone="soft" align="center">
            {bot ? t(bot.saying) : null}
          </PidroText>
        </View>
      </View>
      <BevelButton label={t('profile.close')} material="glass" onPress={onClose} />
    </PidroModal>
  );
}

function PersonSheet({
  playerId,
  presence,
  onClose,
  lists,
  fixture,
}: {
  playerId: string;
  presence?: SheetPresence;
  onClose: () => void;
  lists?: Props['lists'];
  fixture?: SheetData;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  const user = useAuthStore((state) => state.user);
  const friends = useFriendsStore((state) => state.friends);
  const requested = useFriendsStore((state) => state.requested);
  const [sheet, setSheet] = useState<SheetData | null>(fixture ?? null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'menu' | 'block' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [sent, setSent] = useState<'sent' | 'friends' | null>(null);
  useEffect(() => {
    if (fixture) return;
    let active = true;
    profileApi
      .getPlayer(playerId)
      .then((answer) => {
        if (active) setSheet(answer);
      })
      .catch((cause) => {
        if (active) setError(cause ?? true);
      });
    return () => {
      active = false;
    };
  }, [playerId, attempt, fixture]);

  const guest = !user || !!user.guest;
  const you = user?.id === playerId;
  const name = sheet
    ? publicPlayerName(sheet.username, t('social.player'), sheet.display_name)
    : '';
  // Add, Sent once asked, or nothing to ask for a friend.
  const relation =
    sent ?? linkProfileAction(lists ?? { friends, requested }, playerId, user?.id) ?? 'friends';
  // One request at a time, even for two taps before a render.
  const locked = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause ?? true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  // Each step starts clean: an Add that failed says nothing on Block.
  const go = (next: typeof step) => {
    setActionError(null);
    setStep(next);
  };
  const back = () => {
    if (busy) return;
    if (step) go(null);
    else onClose();
  };
  const title = sheet ? sheetTitle(sheet) : null;
  // Your own seat needs no word on where you are.
  const where = sheet ? presenceLine(you ? undefined : presence, sheet.classic) : null;
  const together = sheet ? togetherLines(sheet.together) : null;

  const identity = sheet ? (
    <View style={styles.identity}>
      <PlayerAvatar
        testID="player-sheet-avatar"
        size={wide ? 76 : 100}
        uri={sheet.avatar_url}
        level={sheet.level}
        prestige={sheet.prestige}
        pin={sheet.pin}
      />
      <PidroText
        role="display"
        accessibilityRole="header"
        align="center"
        numberOfLines={1}
        style={styles.name}>
        {name}
      </PidroText>
      {title?.text ? (
        <PidroText
          role="label"
          align="center"
          tone={title.legend ? undefined : 'soft'}
          style={title.legend && styles.gold}>
          {title.text}
        </PidroText>
      ) : null}
      {where ? (
        <View style={styles.presence}>
          {presence && presence !== 'offline' ? (
            <View style={[styles.dot, presence === 'table' ? styles.dotTable : styles.dotOnline]} />
          ) : null}
          <PidroText role="metadata" tone="soft" align="center" style={styles.presenceText}>
            {where}
          </PidroText>
        </View>
      ) : null}
    </View>
  ) : null;

  const details = sheet ? (
    <>
      <Surface
        variant="window"
        style={[styles.stats, wide && styles.wideStats]}
        testID="player-sheet-stats">
        {[
          [formatNumber(sheet.record.games), t('profile.games')],
          [winRate(sheet.record.win_rate), t('profile.won')],
          [formatNumber(sheet.medals), t('profile.medals_caption', { count: sheet.medals })],
        ].map(([number, caption], index) => (
          <View
            key={caption}
            accessible
            accessibilityLabel={`${number} ${caption}`}
            style={[styles.stat, index === 1 && styles.middleStat]}>
            <PidroText role="title" align="center" style={styles.number}>
              {number}
            </PidroText>
            <PidroText role="metadata" tone="soft" align="center">
              {caption}
            </PidroText>
          </View>
        ))}
      </Surface>
      {together && !you ? (
        <Surface
          variant="window"
          style={[styles.together, wide && styles.wideStats]}
          testID="player-sheet-together">
          <View style={styles.pair}>
            <PlayerAvatar size={34} uri={user?.avatar_url} />
            <PlayerAvatar size={34} uri={sheet.avatar_url} style={styles.second} />
          </View>
          <View style={styles.togetherCopy}>
            <PidroText role="label">{together.title}</PidroText>
            <PidroText role="metadata" tone="soft">
              {together.detail}
            </PidroText>
          </View>
        </Surface>
      ) : null}
      {sheet.bio ? (
        <PidroText role="body" tone="soft" align="center" numberOfLines={3} style={styles.about}>
          {sheet.bio}
        </PidroText>
      ) : null}
    </>
  ) : null;

  const offer = you ? null : guest ? (
    <PidroText role="metadata" tone="soft" align="center">
      {t('social.free_account')}
    </PidroText>
  ) : relation !== 'add' ? (
    <View style={styles.center}>
      <FriendState state={relation} />
    </View>
  ) : (
    <BevelButton
      testID="player-sheet-add"
      label={t('player_sheet.add')}
      leadingIcon={<Icon name="person-plus" size={20} color={PidroBevel.textGold} />}
      fullWidth
      loading={busy}
      accessibilityLabel={t('friends.add_player', { name })}
      onPress={() =>
        void run(async () => {
          const answer = fixture ? undefined : await addFriend(playerId);
          setSent(answer?.friends.some((p) => p.user_id === playerId) ? 'friends' : 'sent');
        })
      }
    />
  );

  const corner = (
    <View style={[styles.corner, wide && sheet && !step && styles.wideCorner]}>
      {sheet && !guest && !you && !step ? (
        <BevelButton
          testID="player-sheet-more"
          accessibilityLabel={t('player_sheet.more', { name })}
          material="glass"
          size="icon"
          disabled={busy}
          onPress={() => go('menu')}>
          <PidroText role="label" style={styles.more}>
            •••
          </PidroText>
        </BevelButton>
      ) : (
        <DismissButton accessibilityLabel={t('profile.close')} disabled={busy} onPress={back} />
      )}
    </View>
  );

  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible
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
            testID="player-sheet"
            onAccessibilityEscape={back}
            accessibilityViewIsModal
            style={[styles.sheet, wide && styles.wideSheet]}>
            <View style={styles.grabber} />
            {wide && !step && sheet ? null : corner}
            {error ? (
              <View style={styles.column}>
                <PidroText role="body" tone="danger">
                  {localizedError(error, 'profile.player_error')}
                </PidroText>
                <BevelButton
                  label={t('profile.retry')}
                  onPress={() => {
                    setError(null);
                    setAttempt(attempt + 1);
                  }}
                />
              </View>
            ) : !sheet ? (
              <PidroText role="body" tone="soft" align="center" style={styles.loading}>
                {t('profile.loading')}
              </PidroText>
            ) : step === 'menu' ? (
              <View style={styles.column}>
                <PidroText role="title" accessibilityRole="header">
                  {name}
                </PidroText>
                <PressableFX
                  testID="player-sheet-block"
                  accessibilityRole="button"
                  accessibilityLabel={t('friend_sheet.block', { name })}
                  style={styles.line}
                  pressedStyle={styles.pressed}
                  onPress={() => go('block')}>
                  <Icon name="block" size={22} color={PidroColors.danger} />
                  <PidroText role="label" style={[styles.lineLabel, styles.warn]}>
                    {t('friend_sheet.block', { name })}
                  </PidroText>
                </PressableFX>
              </View>
            ) : step === 'block' ? (
              <View style={styles.column}>
                <PidroText role="title" accessibilityRole="header">
                  {t('friend_sheet.block_title', { name })}
                </PidroText>
                <PidroText role="body" tone="soft">
                  {t('blocks.confirm', { name })}
                </PidroText>
                {actionError ? (
                  <PidroText role="body" tone="danger" accessibilityRole="alert">
                    {localizedError(actionError, 'blocks.block_failed')}
                  </PidroText>
                ) : null}
                <BevelButton
                  label={t('blocks.block')}
                  fullWidth
                  loading={busy}
                  onPress={() =>
                    void run(async () => {
                      if (!fixture) await blockPlayer(playerId);
                      onClose();
                    })
                  }
                />
                <BevelButton
                  label={t('common.cancel')}
                  material="glass"
                  fullWidth
                  disabled={busy}
                  onPress={() => go(null)}
                />
              </View>
            ) : (
              <View style={[styles.content, wide && styles.columns]}>
                <View style={wide && styles.half}>
                  {identity}
                  {/* Beside the stats there is no room: the corner of the face's half. */}
                  {wide ? corner : null}
                </View>
                <View style={[styles.column, wide && styles.half, wide && styles.wideColumn]}>
                  {details}
                  {actionError ? (
                    <PidroText role="body" tone="danger" align="center" accessibilityRole="alert">
                      {localizedError(actionError, 'friends.add_failed')}
                    </PidroText>
                  ) : null}
                  {offer}
                </View>
              </View>
            )}
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
  wideSheet: { maxWidth: 760, gap: PidroSpacing.sm, paddingBottom: PidroSpacing.md },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  corner: { position: 'absolute', top: 18, right: 18, zIndex: 1 },
  wideCorner: { top: 0, right: 0 },
  more: { color: PidroColors.text, letterSpacing: 1 },
  loading: { paddingVertical: PidroSpacing.xl },
  content: { gap: PidroSpacing.md },
  columns: { flexDirection: 'row', gap: PidroSpacing.lg },
  half: { flex: 1, minWidth: 0, justifyContent: 'center' },
  wideColumn: { gap: PidroSpacing.sm },
  wideStats: { paddingVertical: 8 },
  column: { gap: PidroSpacing.md },
  identity: { alignItems: 'center', gap: 4, paddingTop: PidroSpacing.sm },
  name: {
    marginTop: 6,
    fontFamily: PidroFonts.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '400',
    color: PidroBevel.textGold,
  },
  gold: { color: PidroBevel.textGold },
  presence: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  presenceText: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOnline: { backgroundColor: PidroColors.presenceOnline },
  dotTable: { backgroundColor: PidroBevel.textGold },
  stats: { flexDirection: 'row', paddingVertical: 12 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
  middleStat: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: PidroColors.border },
  number: { fontVariant: ['tabular-nums'] },
  together: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.md,
    paddingVertical: 12,
    paddingHorizontal: PidroSpacing.md,
  },
  pair: { flexDirection: 'row' },
  second: { marginLeft: -10 },
  togetherCopy: { flex: 1, minWidth: 0, gap: 2 },
  about: { fontStyle: 'italic' },
  center: { alignSelf: 'center' },
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
  bot: { alignItems: 'center', gap: PidroSpacing.md },
  botLandscape: { flexDirection: 'row' },
  botCopy: { flexShrink: 1, gap: PidroSpacing.sm },
});
