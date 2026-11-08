import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import {
  botPlay,
  builtinBotName,
  isBuiltinBot,
  localizedError,
  publicPlayerName,
  useGameStore,
  type BotPersona,
  type FriendLists,
  type LeagueId,
  type PlayerSheet as SheetData,
} from '@pidro/shared';
import { profileApi } from '@/api/profile';
import { LeagueCard } from '@/components/league/LeagueCard';
import { MedalCoin } from '@/components/profile/MedalCoin';
import { BevelButton } from '@/components/ui/BevelButton';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal as PidroModal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { Coin, PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import { botPersonas } from '@/components/ui/botPersonas';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import { useBotProfile } from '@/features/bots';
import { sheetRelation, type SheetRelation } from '@/features/friends';
import { ordinal } from '@/features/league';
import {
  MORE,
  medalBox,
  presenceLine,
  seatTitle,
  sheetTitle,
  togetherLines,
  winRate,
} from '@/features/profile';
import { formatNumber, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import {
  addFriend,
  blockPlayer,
  ignoreFriend,
  removeFriend,
  useFriendsStore,
} from '@/stores/friends';

export type SheetPresence = 'table' | 'online' | 'offline';

interface Props {
  playerId: string | null;
  persona?: BotPersona | null;
  /** At your table, online, or not: what the sheet says under the title. */
  presence?: SheetPresence;
  onClose: () => void;
  /** The friends lists the screen shows; elsewhere the store's. */
  lists?: Pick<FriendLists, 'friends' | 'requested'> & Partial<Pick<FriendLists, 'added_you'>>;
  fixture?: SheetData;
  standing?: { league: LeagueId; place: number };
  /** At a table, whose side they play on: one quiet line under the name (PID-383). */
  team?: string | null;
  /**
   * A game going on at a talk table (PID-406): Quiet and Report wait in the
   * sheet's •••, and Block and the guest line speak of this game.
   */
  talk?: { quiet: boolean; onQuiet: () => void; onReport: () => void } | null;
}

/**
 * Anyone's sheet (PID-340): who they are, befriending them, what they earned,
 * and the two of you (PID-406). A bot keeps its persona sheet.
 */
export function PlayerSheet({
  playerId,
  persona,
  presence,
  onClose,
  lists,
  fixture,
  standing,
  team = null,
  talk,
}: Props) {
  if (persona) return <BotSheet persona={persona} team={team} onClose={onClose} talk={talk} />;
  return playerId ? (
    <PersonSheet
      key={playerId}
      playerId={playerId}
      presence={presence}
      onClose={onClose}
      lists={lists}
      fixture={__DEV__ ? fixture : undefined}
      standing={standing}
      team={team}
      talk={talk}
    />
  ) : null;
}

function BotSheet({
  persona,
  team,
  onClose,
  talk,
}: {
  persona: BotPersona;
  team: string | null;
  onClose: () => void;
  /** At a talk table a bot can be quieted for the game (PID-408); it has nothing to report. */
  talk?: Props['talk'];
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const snapshot = useGameStore(
    (state) =>
      Object.values(state.playerMeta).find((seat) => seat.bot_persona === persona)?.bot_profile
  );
  const profile = useBotProfile(persona, snapshot);
  const bot = isBuiltinBot(persona) ? botPersonas[persona] : null;
  const name = profile?.name || builtinBotName(persona) || t('game.bot');
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
            {name}
          </PidroText>
          {team ? (
            <PidroText testID="player-sheet-team" role="metadata" tone="soft" align="center">
              {team}
            </PidroText>
          ) : null}
          {typeof profile?.description === 'string' && profile.description ? (
            <PidroText role="body" align="center">
              {profile.description}
            </PidroText>
          ) : null}
          <PidroText role="body" align="center">
            {t(botPlay(profile?.strategy))}
          </PidroText>
          {bot ? (
            <PidroText role="body" tone="soft" align="center">
              {t(bot.saying)}
            </PidroText>
          ) : null}
        </View>
      </View>
      {talk ? (
        <BevelButton
          testID="player-sheet-quiet"
          label={t(talk.quiet ? 'player_sheet.unquiet' : 'player_sheet.quiet', { name })}
          material="glass"
          onPress={() => {
            talk.onQuiet();
            onClose();
          }}
        />
      ) : null}
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
  standing,
  team,
  talk,
}: {
  playerId: string;
  presence?: SheetPresence;
  onClose: () => void;
  lists?: Props['lists'];
  fixture?: SheetData;
  standing?: Props['standing'];
  team: string | null;
  talk?: Props['talk'];
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  const user = useAuthStore((state) => state.user);
  const friends = useFriendsStore((state) => state.friends);
  const addedYou = useFriendsStore((state) => state.added_you);
  const requested = useFriendsStore((state) => state.requested);
  const [sheet, setSheet] = useState<SheetData | null>(fixture ?? null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'menu' | 'block' | 'blocked' | 'remove' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  // What your last tap settled, while the friends lists still say what they said before it.
  const [settled, setSettled] = useState<{
    relation: SheetRelation | 'friends-now';
    over: SheetRelation | null;
  } | null>(null);
  // iOS presents the report question only once this sheet has gone.
  const [leaving, setLeaving] = useState(false);
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
  const atTable = presence === 'table';
  const name = sheet
    ? publicPlayerName(sheet.username, t('social.player'), sheet.display_name)
    : '';
  const listed = sheetRelation(
    lists ?? { friends, added_you: addedYou, requested },
    playerId,
    user?.id
  );
  const relation = settled && settled.over === listed ? settled.relation : listed;
  const settle = (next: SheetRelation | 'friends-now') =>
    setSettled({ relation: next, over: listed });
  // One request at a time, even for two taps before a render.
  const locked = useRef(false);
  const [failedKind, setFailedKind] = useState<string | null>(null);
  const run = async (kind: string, action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(kind);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setFailedKind(kind);
      setActionError(cause ?? true);
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  // Each step starts clean: an Add that failed says nothing on Block.
  const go = (next: typeof step) => {
    setActionError(null);
    setStep(next);
  };
  const back = () => {
    if (busy) return;
    if (step && step !== 'blocked') go(null);
    else onClose();
  };
  // At the table the seat shares the title's line, and where they are goes without saying.
  const title = sheet ? (atTable ? seatTitle(sheet, team) : sheetTitle(sheet)) : null;
  // Your own seat needs no word on where you are.
  const where = sheet ? presenceLine(you || atTable ? undefined : presence, sheet.classic) : null;
  const together = sheet ? togetherLines(sheet.together) : null;
  // The ••• menu, in its order: quiet and report at a talk table, then remove and block.
  const menu: {
    key: string;
    icon: IconName;
    label: string;
    warn?: boolean;
    onPress: () => void;
  }[] = [];
  if (!you && talk)
    menu.push(
      {
        key: 'quiet',
        icon: 'chat',
        label: t(talk.quiet ? 'player_sheet.unquiet' : 'player_sheet.quiet', { name }),
        onPress: () => {
          talk.onQuiet();
          onClose();
        },
      },
      {
        key: 'report',
        icon: 'alert',
        label: t('player_sheet.report', { name }),
        onPress: () => (Platform.OS === 'ios' ? setLeaving(true) : talk.onReport()),
      }
    );
  if (!you && !guest && (relation === 'friends' || relation === 'friends-now'))
    menu.push({
      key: 'remove',
      icon: 'person-minus',
      label: t('friend_sheet.remove'),
      onPress: () => go('remove'),
    });
  if (!you && !guest)
    menu.push({
      key: 'block',
      icon: 'block',
      label: t('friend_sheet.block', { name }),
      warn: true,
      onPress: () => go('block'),
    });

  const identity = sheet ? (
    <View style={[styles.identity, wide && styles.wideIdentity]}>
      <PlayerAvatar
        testID="player-sheet-avatar"
        size={wide ? 76 : 100}
        uri={sheet.avatar_url}
        level={sheet.level}
        prestige={sheet.prestige}
        pin={sheet.pin}
      />
      <View style={[styles.identityCopy, wide && styles.wideIdentityCopy]}>
        <PidroText
          role="display"
          accessibilityRole="header"
          align={wide ? 'left' : 'center'}
          numberOfLines={1}
          style={styles.name}>
          {name}
        </PidroText>
        {title?.text ? (
          <PidroText
            testID="player-sheet-title"
            role="label"
            align={wide ? 'left' : 'center'}
            tone={title.legend ? undefined : 'soft'}
            style={title.legend && styles.gold}>
            {title.text}
          </PidroText>
        ) : null}
        {/* Away from the table the seat has its own line, as for a bot. */}
        {team && !atTable ? (
          <PidroText testID="player-sheet-team" role="metadata" tone="soft" align="center">
            {team}
          </PidroText>
        ) : null}
        {standing ? (
          <View testID="player-sheet-league" style={styles.presence}>
            <LeagueCard league={standing.league} size={20} />
            <PidroText role="metadata" tone="soft">
              {t('league.line.placed', { place: ordinal(standing.place) })}
            </PidroText>
          </View>
        ) : null}
        {where ? (
          <View style={[styles.presence, wide && styles.wideStart]}>
            {presence && presence !== 'offline' && !atTable ? (
              <View style={[styles.dot, styles.dotOnline]} />
            ) : null}
            <PidroText role="metadata" tone="soft" align="center" style={styles.presenceText}>
              {where}
            </PidroText>
          </View>
        ) : null}
      </View>
    </View>
  ) : null;

  const friendsChip = (now: boolean) => (
    <View testID="player-sheet-friends" style={styles.chip}>
      <Icon name="check" size={16} strokeWidth={2.6} color={PidroColors.success} />
      <PidroText role="label" style={styles.chipLabel}>
        {t(now ? 'player_sheet.friends_now' : 'friends.are_friends')}
      </PidroText>
    </View>
  );

  const offer = you ? null : guest ? (
    <PidroText role="body" tone="soft" align="center">
      {t(talk ? 'player_sheet.guest_table' : 'social.free_account')}
    </PidroText>
  ) : relation === 'asked' ? (
    <View testID="player-sheet-asked" style={styles.ask}>
      <PidroText role="label" align="center">
        {t('player_sheet.asked', { name })}
      </PidroText>
      <View style={styles.askButtons}>
        <BevelButton
          testID="player-sheet-accept"
          label={t('friends.accept')}
          accessibilityLabel={t('friends.accept_player', { name })}
          loading={busy === 'accept'}
          disabled={!!busy}
          style={styles.askButton}
          // Mutual means friends: accepting is adding them back.
          onPress={() =>
            void run('accept', async () => {
              const answer = fixture ? undefined : await addFriend(playerId);
              // A request withdrawn meanwhile makes this a new one of yours.
              settle(
                answer && !answer.friends.some((p) => p.user_id === playerId)
                  ? 'sent'
                  : 'friends-now'
              );
            })
          }
        />
        <BevelButton
          testID="player-sheet-not-now"
          material="glass"
          label={t('friend_notice.not_now')}
          accessibilityLabel={t('friends.ignore_player', { name })}
          loading={busy === 'ignore'}
          disabled={!!busy}
          style={styles.askButton}
          onPress={() =>
            void run('ignore', async () => {
              if (!fixture) await ignoreFriend(playerId);
              settle('none');
            })
          }
        />
      </View>
    </View>
  ) : relation === 'sent' ? (
    <BevelButton
      testID="player-sheet-sent"
      material="glass"
      label={t('player_sheet.sent')}
      leadingIcon={<Icon name="check" size={18} strokeWidth={2.6} color={PidroColors.success} />}
      fullWidth
      disabled
    />
  ) : relation === 'friends' || relation === 'friends-now' ? (
    friendsChip(relation === 'friends-now')
  ) : (
    <BevelButton
      testID="player-sheet-add"
      material="glass"
      label={t('player_sheet.add')}
      leadingIcon={<Icon name="person-plus" size={20} color={PidroBevel.textGold} />}
      fullWidth
      loading={busy === 'add'}
      disabled={!!busy}
      accessibilityLabel={t('friends.add_player', { name })}
      onPress={() =>
        void run('add', async () => {
          const answer = fixture ? undefined : await addFriend(playerId);
          settle(answer?.friends.some((p) => p.user_id === playerId) ? 'friends-now' : 'sent');
        })
      }
    />
  );

  const failed = actionError ? (
    <PidroText role="body" tone="danger" align="center" accessibilityRole="alert">
      {localizedError(
        actionError,
        failedKind === 'ignore' ? 'friends.update_failed' : 'friends.add_failed'
      )}
    </PidroText>
  ) : null;

  const stats = sheet ? (
    <Surface
      variant="window"
      style={[styles.stats, wide && styles.wideBox, wide && styles.wideStats]}
      testID="player-sheet-stats">
      {[
        [formatNumber(sheet.record.games), t('profile.games')],
        [winRate(sheet.record.win_rate), t('profile.won')],
      ].map(([number, caption], index) => (
        <View
          key={caption}
          accessible
          accessibilityLabel={`${number} ${caption}`}
          style={[styles.stat, index === 1 && styles.secondStat]}>
          <PidroText role={wide ? 'label' : 'title'} align="center" style={styles.number}>
            {number}
          </PidroText>
          <PidroText role="metadata" tone="soft" align="center">
            {caption}
          </PidroText>
        </View>
      ))}
    </Surface>
  ) : null;

  const youTwo =
    sheet && together && !you ? (
      <Surface
        variant="window"
        style={[styles.together, wide && styles.wideBox, wide && styles.wideTogether]}
        testID="player-sheet-together">
        {wide ? null : (
          <View style={styles.pair}>
            <PlayerAvatar size={34} uri={user?.avatar_url} />
            <PlayerAvatar size={34} uri={sheet.avatar_url} style={styles.second} />
          </View>
        )}
        <View style={styles.togetherCopy}>
          <PidroText role="label">{together.title}</PidroText>
          <PidroText role="metadata" tone="soft">
            {together.detail}
          </PidroText>
        </View>
      </Surface>
    ) : null;

  const medals = sheet ? (
    <MedalsBox list={sheet.medal_list} total={sheet.medal_total} wide={wide} />
  ) : null;

  const bio = sheet?.bio ? (
    <PidroText
      role="body"
      tone="soft"
      align="center"
      numberOfLines={wide ? 1 : 3}
      style={styles.about}>
      {sheet.bio}
    </PidroText>
  ) : null;

  const corner = (
    <View style={styles.corner}>
      {sheet && !step && menu.length ? (
        <BevelButton
          testID="player-sheet-more"
          accessibilityLabel={t('player_sheet.more', { name })}
          material="glass"
          size="icon"
          disabled={!!busy}
          onPress={() => go('menu')}>
          <PidroText role="label" style={styles.more}>
            •••
          </PidroText>
        </BevelButton>
      ) : step ? null : (
        <DismissButton accessibilityLabel={t('profile.close')} disabled={!!busy} onPress={back} />
      )}
    </View>
  );

  const confirm = (
    kind: 'block' | 'remove',
    {
      title: heading,
      body,
      label,
      keep,
    }: { title: string; body: string; label: string; keep: string }
  ) => (
    <View style={styles.column}>
      <PidroText role="title" accessibilityRole="header">
        {heading}
      </PidroText>
      <PidroText role="body" tone="soft">
        {body}
      </PidroText>
      {actionError ? (
        <PidroText role="body" tone="danger" accessibilityRole="alert">
          {localizedError(
            actionError,
            kind === 'block' ? 'blocks.block_failed' : 'friends.remove_failed'
          )}
        </PidroText>
      ) : null}
      <BevelButton
        testID={`player-sheet-${kind}-confirm`}
        label={label}
        material="glass"
        tone="danger"
        fullWidth
        loading={busy === kind}
        onPress={() =>
          void run(kind, async () => {
            if (kind === 'remove') {
              if (!fixture) await removeFriend(playerId);
              settle('none');
              return go(null);
            }
            if (!fixture) await blockPlayer(playerId);
            // Blocked is quiet too, for the rest of this game.
            if (talk && !talk.quiet) talk.onQuiet();
            if (talk) go('blocked');
            else onClose();
          })
        }
      />
      <BevelButton
        label={keep}
        material="glass"
        fullWidth
        disabled={!!busy}
        onPress={() => go(null)}
      />
    </View>
  );

  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={!leaving}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'slide'}
      // Gone mid-dismiss (game over, they left): the sheet closes rather than stay hidden.
      onDismiss={() => {
        if (leaving) (talk ? talk.onReport : onClose)();
      }}
      onRequestClose={() => {
        if (!busy) onClose();
      }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityLabel={t('profile.close')}
            disabled={!!busy}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID="player-sheet"
            onAccessibilityEscape={back}
            accessibilityViewIsModal
            style={[styles.sheet, wide && styles.wideSheet]}>
            <View style={styles.grabber} />
            {corner}
            {/* Below about 700 tall the sheet scrolls rather than cut anything. */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.scrolled, wide && !step && styles.wideScrolled]}
              bounces={false}>
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
                <View style={styles.menu} testID="player-sheet-menu">
                  <PidroText role="title" accessibilityRole="header" style={styles.menuTitle}>
                    {name}
                  </PidroText>
                  {menu.map((item, index) => (
                    <PressableFX
                      key={item.key}
                      testID={`player-sheet-${item.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      style={[styles.line, index > 0 && styles.lineRule]}
                      pressedStyle={styles.pressed}
                      onPress={item.onPress}>
                      <Icon
                        name={item.icon}
                        size={22}
                        color={item.warn ? PidroColors.danger : PidroColors.text}
                      />
                      <PidroText role="label" style={[styles.lineLabel, item.warn && styles.warn]}>
                        {item.label}
                      </PidroText>
                    </PressableFX>
                  ))}
                  <BevelButton
                    label={t('player_sheet.back')}
                    material="glass"
                    fullWidth
                    onPress={() => go(null)}
                    style={styles.menuBack}
                  />
                </View>
              ) : step === 'block' ? (
                confirm('block', {
                  title: t('friend_sheet.block_title', { name }),
                  body: t(talk ? 'player_sheet.block_body' : 'blocks.confirm', { name }),
                  label: t('blocks.block'),
                  keep: t('common.cancel'),
                })
              ) : step === 'remove' ? (
                confirm('remove', {
                  title: t('friend_sheet.remove_title', { name }),
                  body: t('friend_sheet.remove_body', { name }),
                  label: t('friend_sheet.remove_confirm'),
                  keep: t('friend_sheet.keep', { name }),
                })
              ) : step === 'blocked' ? (
                <View style={styles.column}>
                  <View style={styles.done} accessibilityRole="alert">
                    <Icon name="check" size={20} strokeWidth={2.6} color={PidroColors.success} />
                    <PidroText role="label" style={styles.doneText}>
                      {t('player_sheet.blocked', { name })}
                    </PidroText>
                  </View>
                  <BevelButton
                    testID="player-sheet-back-to-game"
                    label={t('player_sheet.back_to_game')}
                    fullWidth
                    onPress={onClose}
                  />
                </View>
              ) : wide ? (
                <View style={styles.columns}>
                  <View style={styles.half}>
                    {identity}
                    {offer}
                    {failed}
                  </View>
                  <View style={[styles.half, styles.wideDetails]}>
                    {medals}
                    <View style={styles.wideRow}>
                      {stats}
                      {youTwo}
                    </View>
                    {bio}
                  </View>
                </View>
              ) : (
                <View style={styles.column}>
                  {identity}
                  {offer}
                  {failed}
                  {medals}
                  {stats}
                  {youTwo}
                  {bio}
                </View>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * Their medals (PID-406), newest first: a tap on a coin says what it is for,
 * a second tap the newest again; "+N" names the rest. Locked ones never show.
 */
function MedalsBox({
  list,
  total,
  wide,
}: {
  list: SheetData['medal_list'];
  total?: number;
  wide: boolean;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const box = medalBox(list, picked);
  if (!box || !list) return null;
  const pick = (key: string) => setPicked(picked === key ? null : key);
  return (
    <Surface
      variant="window"
      style={[styles.medals, wide && styles.wideBox]}
      testID="player-sheet-medals">
      <View style={styles.medalsTop}>
        <PidroText role="label">{t('profile.medals')}</PidroText>
        {total ? (
          <PidroText role="metadata" tone="soft" testID="player-sheet-medal-count">
            {t('player_sheet.medals_of', {
              number: formatNumber(list.length),
              total: formatNumber(total),
            })}
          </PidroText>
        ) : null}
      </View>
      <View style={styles.coins}>
        {box.coins.map((medal) => (
          <PressableFX
            key={medal.key}
            testID={`player-sheet-medal-${medal.key}`}
            accessibilityRole="button"
            accessibilityLabel={medal.name}
            accessibilityState={{ selected: picked === medal.key }}
            onPress={() => pick(medal.key)}
            style={styles.coinCell}>
            <View style={[styles.coinRing, picked === medal.key && styles.coinPicked]}>
              <MedalCoin name={medal.name} earned size={COIN} />
            </View>
            <PidroText
              role="metadata"
              align="center"
              numberOfLines={2}
              style={[styles.coinName, picked === medal.key && styles.gold]}>
              {medal.name}
            </PidroText>
          </PressableFX>
        ))}
        {box.more.length ? (
          <PressableFX
            testID="player-sheet-medal-more"
            accessibilityRole="button"
            accessibilityLabel={t('player_sheet.medals_more_label', {
              count: box.more.length,
              number: formatNumber(box.more.length),
            })}
            accessibilityState={{ selected: picked === MORE }}
            onPress={() => pick(MORE)}
            style={styles.coinCell}>
            <View style={[styles.coinRing, picked === MORE && styles.coinPicked]}>
              <Coin material="glass" size={COIN} rim={3} style={styles.moreCoin}>
                <PidroText role="label" maxFontSizeMultiplier={1}>
                  +{formatNumber(box.more.length)}
                </PidroText>
              </Coin>
            </View>
            <PidroText
              role="metadata"
              align="center"
              style={[styles.coinName, picked === MORE && styles.gold]}>
              {t('player_sheet.medals_more')}
            </PidroText>
          </PressableFX>
        ) : null}
      </View>
      <PidroText
        testID="player-sheet-medal-line"
        role="label"
        align="center"
        accessibilityLiveRegion="polite">
        {box.line}
      </PidroText>
    </Surface>
  );
}

const COIN = 46;

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.backdrop },
  sheet: {
    alignSelf: 'center',
    flexShrink: 1,
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingTop: 10,
  },
  wideSheet: { maxWidth: 760 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  corner: { position: 'absolute', top: 18, right: 18, zIndex: 1 },
  more: { color: PidroColors.text, letterSpacing: 1 },
  scroll: { flexGrow: 0 },
  scrolled: { paddingHorizontal: 20, paddingTop: PidroSpacing.sm, paddingBottom: PidroSpacing.lg },
  // In landscape ••• has its own band above the two halves.
  wideScrolled: { paddingTop: 44, paddingBottom: PidroSpacing.md },
  loading: { paddingVertical: PidroSpacing.xl },
  columns: { flexDirection: 'row', gap: PidroSpacing.lg },
  // Between the face and the request box, a clear 20.
  half: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 20 },
  wideDetails: { gap: PidroSpacing.sm },
  wideRow: { flexDirection: 'row', gap: PidroSpacing.sm },
  wideBox: { paddingVertical: 8 },
  column: { gap: PidroSpacing.md },
  identity: { alignItems: 'center', gap: 4, paddingTop: PidroSpacing.xs },
  wideIdentity: { flexDirection: 'row', gap: PidroSpacing.md, paddingTop: 0 },
  identityCopy: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  wideIdentityCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
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
  wideStart: { justifyContent: 'flex-start' },
  presenceText: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOnline: { backgroundColor: PidroColors.presenceOnline },
  ask: {
    gap: PidroSpacing.sm,
    padding: PidroSpacing.sm,
    borderRadius: PidroRadii.lg,
    borderWidth: 1.5,
    borderColor: PidroColors.friendAskBorder,
    backgroundColor: PidroColors.friendAskBg,
  },
  askButtons: { flexDirection: 'row', gap: PidroSpacing.sm },
  askButton: { flex: 1 },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: PidroSpacing.sm,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroColors.success,
    backgroundColor: PidroColors.successBg,
  },
  chipLabel: { color: PidroColors.success },
  medals: { gap: PidroSpacing.sm, paddingVertical: 12, paddingHorizontal: PidroSpacing.sm },
  medalsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coins: { flexDirection: 'row', justifyContent: 'center' },
  coinCell: { width: '20%', alignItems: 'center', gap: 4, minHeight: 44 },
  coinRing: {
    padding: 2,
    borderRadius: PidroRadii.full,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  coinPicked: { borderColor: PidroBevel.textGold },
  coinName: { fontSize: 11, lineHeight: 13 },
  moreCoin: { position: 'relative' },
  stats: { flexDirection: 'row', paddingVertical: 12 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
  secondStat: { borderLeftWidth: 1, borderColor: PidroColors.border },
  number: { fontVariant: ['tabular-nums'] },
  together: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.md,
    paddingVertical: 12,
    paddingHorizontal: PidroSpacing.md,
  },
  wideStats: { flex: 1, minWidth: 0 },
  wideTogether: { flex: 1.4, minWidth: 0, paddingHorizontal: PidroSpacing.sm },
  pair: { flexDirection: 'row' },
  second: { marginLeft: -10 },
  togetherCopy: { flex: 1, minWidth: 0, gap: 2 },
  about: { fontStyle: 'italic' },
  menu: { gap: 0 },
  menuTitle: { marginBottom: PidroSpacing.xs },
  menuBack: { marginTop: PidroSpacing.md },
  line: {
    minHeight: 56,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: PidroRadii.panel,
  },
  lineRule: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: PidroColors.borderStrong },
  lineLabel: { flex: 1 },
  warn: { color: PidroColors.danger },
  pressed: { backgroundColor: PidroColors.actionPill },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingTop: PidroSpacing.xs,
  },
  doneText: { flex: 1 },
  center: { alignSelf: 'center' },
  bot: { alignItems: 'center', gap: PidroSpacing.md },
  botLandscape: { flexDirection: 'row' },
  botCopy: { flexShrink: 1, gap: PidroSpacing.sm },
});
