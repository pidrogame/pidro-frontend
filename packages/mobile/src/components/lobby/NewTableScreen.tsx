import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';
import { talkAt, useRoomTalk } from '@/channels/hooks/useGameChannel';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveBotProfile, useBotCatalogueStore } from '@pidro/shared';
import type {
  BotProfile,
  CreateRoomRequest,
  FriendPlayer,
  HeldPlayer,
  Position,
  Room,
  RuleSet,
  SeatType,
  TranslationKey,
} from '@pidro/shared';
import { NoticeCard } from '@/components/friends/NoticeCard';
import { SeatPickerContainer } from '@/components/invites/SeatPickerContainer';
import type { ChoiceSection } from '@/components/invites/ChoiceList';
import { BackButton } from '@/components/ui/BackButton';
import { ActionPill } from '@/components/ui/ActionPill';
import { BevelButton } from '@/components/ui/BevelButton';
import { Modal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { TextLink } from '@/components/ui/TextLink';
import { RulesExplainer, useRulesExplainer } from '@/components/rules/RulesExplainer';
import { TableFeedback } from '@/components/game/TableFeedback';
import { WatchingBadge } from '@/components/game/WatchingBadge';
import { PidroFonts, PidroLayout } from '@/design/tokens';
import { loadCatalogue } from '@/features/bots';
import { talkRefusal, type Said, type TalkItem } from '@/features/game/talk';
import { talkText } from '@/components/game/TableTalk';
import { playActionHaptic } from '@/game/useGameHaptics';
import { useHardwareBack } from '@/hooks/useFlowBack';
import { assignedRoomPlayerIds } from '@/features/invites/hostControls';
import {
  assignedFriendIds,
  botChoices,
  chooseFriend,
  chooseSeat,
  defaultSeats,
  isPractice,
  newTableRequest,
  pickerFriends,
  seatChoice,
  seatedHuman,
  seatEntry,
  seatError,
  seatPersona,
  seatChanges,
  tableFooter,
  talkOpens,
  tableHeader,
  tableTitle,
  waitingFooter,
  type SeatChoice,
  type SeatKey,
  type TableDraft,
} from '@/features/lobby/newTable';
import { seatRow, type SeatView } from '@/features/lobby/seatRow';
import { seatName } from '@/features/seatName';
import type { TableNotice } from '@/game/tableNotices';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { refreshFriends, useFriendsStore } from '@/stores/friends';
import { useSettingsStore } from '@/stores/settings';
import { localizedError } from '@/utils/apiErrors';
import { SeatRow, TeamSection, VsDivider } from './SeatRow';
import {
  Rise,
  SeatStrip,
  TALK_RINGS,
  TalkEmoji,
  TalkField,
  TalkLines,
  Travel,
  useFades,
  type Spots,
  type WaitingLine,
  type WaitingTalk,
} from './WaitingTalk';

const positions: Position[] = ['north', 'east', 'south', 'west'];
const seatKeys: Partial<Record<Position, SeatKey>> = {
  east: 'seat_2',
  south: 'seat_3',
  west: 'seat_4',
};

interface Props {
  room?: Room;
  initialDraft?: TableDraft;
  initialRuleSet?: RuleSet;
  initialPicker?: 'choices' | 'friends' | 'bots';
  initialSeat?: Position;
  partner?: string;
  fixtureFriends?: FriendPlayer[];
  fixtureBots?: BotProfile[];
  youPlayerId?: string;
  onSubmit?: (request: CreateRoomRequest) => void;
  onLeave: () => void;
  busy?: boolean;
  error?: string;
  isSpectator?: boolean;
  canManage?: boolean;
  controlsBusy?: boolean;
  joiningName?: string | null;
  readyPlayers?: Position[];
  readyDisabled?: boolean;
  onReady?: () => Promise<void>;
  onOpenInvite?: () => void;
  /** After opening, every choice is one seat entry; the screen then renders the server's room. */
  onSetSeat?: (position: Position, seat: SeatType) => Promise<void>;
  onKickPlayer?: (position: Position) => void;
  rulesFixtureSeen?: boolean;
  notice?: TableNotice | null;
  onDismissNotice?: () => void;
  /** The host's: an invited friend said Not now or sat down elsewhere. */
  declined?: { position: Position; user: HeldPlayer } | null;
  onDismissDeclined?: () => void;
  /** PID-418: a seated player's talk while the table fills. */
  talk?: WaitingTalk;
  /** Fixtures: the field focused, the seats folded. */
  initialTyping?: boolean;
}

/** The draft and the server room share their furniture, never their state. */
export function NewTableScreen({
  room,
  initialDraft,
  initialRuleSet,
  initialPicker,
  initialSeat = 'south',
  partner,
  fixtureFriends,
  fixtureBots,
  youPlayerId,
  onSubmit,
  onLeave,
  busy = false,
  error,
  isSpectator = false,
  canManage = false,
  controlsBusy = false,
  joiningName,
  readyPlayers = [],
  readyDisabled = true,
  onReady,
  onOpenInvite,
  onSetSeat,
  onKickPlayer,
  rulesFixtureSeen,
  notice,
  onDismissNotice,
  declined,
  onDismissDeclined,
  talk,
  initialTyping = false,
}: Props) {
  const { t } = useTranslation();
  const catalogue = useBotCatalogueStore((state) => state.profiles);
  const bots = fixtureBots ?? catalogue;
  useEffect(() => {
    if (!fixtureBots) loadCatalogue();
  }, [fixtureBots]);
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  // Sideways the teams sit side by side; a phone keeps every line, an iPad its own column.
  const wide = width > height;
  const tablet = Math.min(width, height) >= 600;
  const phoneLandscape = wide && !tablet;
  const compact = !wide && height < 700;
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const friendStore = useFriendsStore();
  const friends = fixtureFriends ?? friendStore.friends;
  const preferred = useSettingsStore((state) => state.preferredRuleSet);
  const [draft, setDraft] = useState<TableDraft>(initialDraft ?? { seats: { ...defaultSeats } });
  const [draftRules, setDraftRules] = useState(initialRuleSet ?? preferred);
  const [selected, setSelected] = useState<Position | null>(initialPicker ? initialSeat : null);
  const [pickerPage, setPickerPage] = useState(initialPicker);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pickerError, setPickerError] = useState<string>();
  const [prefilled, setPrefilled] = useState(false);
  const askFriends = !fixtureFriends && !!user && !user.guest;
  useEffect(() => {
    if (askFriends) void refreshFriends().catch(() => undefined);
  }, [askFriends, user]);
  // No event says a friend sat down elsewhere, so a seat's picker asks again as it opens.
  const picking = selected !== null;
  useEffect(() => {
    if (askFriends && picking) void refreshFriends().catch(() => undefined);
  }, [askFriends, picking]);
  const partnerFriend = friends.find((entry) => entry.user_id === partner);
  if (!room && !prefilled && partnerFriend) {
    setDraft(chooseFriend(draft, 'seat_3', partnerFriend));
    setPrefilled(true);
  }
  const ruleSet = room?.config?.rule_set ?? draftRules;
  const you = youPlayerId ?? user?.id ?? '';
  const youPosition = room
    ? positions.find((position) => room.positions?.[position] === you)
    : 'north';
  const start = positions.indexOf(youPosition ?? 'north');
  const order = [0, 2, 1, 3].map((offset) => positions[(start + offset) % 4]);
  const editable = !room || (canManage && !isSpectator);
  const rules = useRulesExplainer(ruleSet, !room || isSpectator || !youPosition, rulesFixtureSeen);
  const liveSeat = (position: Position) => room?.seats?.find((seat) => seat.position === position);
  // PID-418: once the table is open, a seated player talks while it fills.
  const talking = !!room && !!youPosition && !isSpectator && !!talk;
  // The room's talk, unless a fixture brings its own; after a game the waiting room starts clean.
  const roomLines = useRoomTalk();
  const lines = talk?.lines ?? roomLines;
  const live = talking && !talk.lines;
  useEffect(() => {
    if (live) talkAt(null);
  }, [live]);
  // Focusing the field folds a phone's rows into faces; the keyboard closing unfolds them.
  const [typing, setTyping] = useState(initialTyping);
  const folded = talking && typing && !tablet;
  const unfold = useCallback(() => {
    Keyboard.dismiss();
    setTyping(false);
  }, []);
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => hidden.remove();
  }, []);
  // PID-420: folded, back (the header's and Android's) unfolds; leaving is for the open rows.
  useHardwareBack(folded, unfold);
  // Each fold and unfold is a turn: the faces travel between the rows and the strip.
  const [turn, setTurn] = useState({ folded, n: 0 });
  if (turn.folded !== folded) setTurn({ folded, n: turn.n + 1 });
  const spots = useRef<Spots>({});
  const fades = useFades();
  // The talk column rises by what the rows leave, or settles back under them: their height
  // less the strip's, as each was last laid out (the strip's faces are 44 before the first fold).
  const [heights, setHeights] = useState<{ rows: number; strip: number }>({
    rows: 0,
    strip: PidroLayout.touchTarget,
  });
  const lift = turn.n && heights.rows ? (folded ? 1 : -1) * (heights.rows - heights.strip) : 0;
  // The room takes talk only where someone can read it, as the server decides.
  const talkOpen = talking && !!room && talkOpens(room, you);
  // A seat change that takes talk away while typing unfolds and closes the keyboard.
  if (typing && talking && !talkOpen) setTyping(false);
  // Why the last thing said did not go, where the field is; the next try clears it. It
  // belongs to the talk it refused: closed, it goes, even one that was still on its way.
  const [refused, setRefused] = useState<TranslationKey | null>(null);
  if (refused && !talkOpen) setRefused(null);
  useEffect(() => {
    if (!talkOpen) Keyboard.dismiss();
  }, [talkOpen]);
  const refuse = useCallback(
    (line: TranslationKey | null) => {
      setRefused(line);
      if (line) AccessibilityInfo.announceForAccessibility(t(line));
    },
    [t]
  );
  const sendFace = (item: TalkItem) =>
    void talk?.send(item).then(
      () => refuse(null),
      (error: unknown) => refuse(talkRefusal(error))
    );
  // Who came and went, as quiet lines between what was said; never the host's own edits.
  const [heard, setHeard] = useState(talk?.heard ?? []);
  const [kicked, setKicked] = useState<string[]>([]);
  const [seen, setSeen] = useState({ room, declined });
  if (seen.room !== room || seen.declined !== declined) {
    setSeen({ room, declined });
    // A removed player goes quietly; seated again, they are news again.
    if (kicked.length)
      setKicked(kicked.filter((id) => room?.seats?.some((seat) => seat.player?.id === id)));
    const said = [
      ...(seen.room && room ? seatChanges(seen.room, room, [you, ...kicked]) : []),
      ...(declined && declined !== seen.declined
        ? [t('waiting_talk.cant_come', { name: declined.user.display_name })]
        : []),
    ];
    if (talking && said.length)
      setHeard((previous) => [...previous, ...said.map((text) => ({ at: lines.length, text }))]);
  }
  const timeline: WaitingLine[] = talking
    ? [
        ...lines.map((said, at) => ({ at, key: `said-${at}`, said })),
        ...heard.map(({ at, text }, i) => ({ at: at - 0.5, key: `seat-${i}`, quiet: text })),
      ].sort((a, b) => a.at - b.at)
    : [];
  const who = (said: Said) => ({
    name:
      said.userId === you
        ? t('game.you')
        : seatName(
            room?.seats?.find((seat) => seat.player?.id === said.userId)?.player,
            t('social.player')
          ),
    ours: said.seat === order[0] || said.seat === order[1],
  });
  // PID-420: someone else's new line rings their face once, is read out once, and, while
  // the field is not focused, taps like a line at the table.
  const [pulses, setPulses] = useState<Partial<Record<Position, number>>>({});
  // News is what comes after the last line already held. A join's replay arrives with
  // the talk itself, and a reconnect's lines without the last held one: neither is news.
  const [held, setHeld] = useState({ talking, last: lines.at(-1) });
  const [news, setNews] = useState<{ read: string; tap: boolean } | null>(null);
  if (held.talking !== talking || held.last !== lines.at(-1)) {
    setHeld({ talking, last: lines.at(-1) });
    const after = held.last ? lines.indexOf(held.last) + 1 : 0;
    const fresh =
      held.talking && talking && (after > 0 || !held.last)
        ? lines.slice(after).filter((said) => said.userId !== you)
        : [];
    if (fresh.length) {
      setPulses((previous) =>
        fresh.reduce(
          (next, said) => ({ ...next, [said.seat]: (next[said.seat] ?? 0) + 1 }),
          previous
        )
      );
      setNews({
        read: fresh.map((said) => `${who(said).name}: ${talkText(said)}`).join('. '),
        tap: !typing,
      });
    }
  }
  useEffect(() => {
    if (news?.tap) playActionHaptic();
    if (news) AccessibilityInfo.announceForAccessibility(news.read);
  }, [news]);
  const view = (position: Position, index: number): SeatView => {
    const team = position === youPosition ? 'you' : index < 2 ? 'partner' : 'opponent';
    if (room) {
      const seat = liveSeat(position);
      return {
        team,
        opened: true,
        type: seat?.held_for ? 'held' : 'open',
        player: seat?.player,
        connectionStatus: seat?.connectionStatus,
        held_for: seat?.held_for,
        presence: friends.find((friend) => friend.user_id === seat?.held_for?.user_id)?.presence,
        min_games: seat?.min_games,
        passwordRequired: seat?.password,
        password: canManage && seat?.password ? room.seat_password : undefined,
        host: room.host_id === you,
        ready: readyPlayers.includes(position),
        editable,
      };
    }
    if (position === 'north')
      return {
        team: 'you',
        opened: false,
        type: 'open',
        player: { username: user?.username ?? '', avatar_url: user?.avatar_url },
      };
    const seat = draft.seats[seatKeys[position]!];
    return typeof seat === 'string'
      ? { team, opened: false, type: seat }
      : seat.type === 'held'
        ? { team, opened: false, type: 'held', held_for: seat.friend }
        : seat.type === 'ai'
          ? { team, opened: false, type: 'ai', bot: resolveBotProfile(seat.persona, null, bots) }
          : {
              team,
              opened: false,
              type: 'open',
              min_games: seat.min_games,
              passwordRequired: seat.password,
            };
  };
  // Until that seat is taken or held for someone else; the refresh may still be on its way.
  const declinedSeat = declined ? liveSeat(declined.position) : undefined;
  const showDeclined =
    !!declined &&
    editable &&
    !declinedSeat?.player &&
    (!declinedSeat?.held_for || declinedSeat.held_for.user_id === declined.user.user_id);
  const selectedLive = selected ? liveSeat(selected) : undefined;
  // Someone sat down: the picker closes, and a refusal it showed stays in the footer.
  if (room && selected && selectedPlayerId !== (selectedLive?.player?.id ?? null)) {
    setSelected(null);
  }
  const selectedDraft =
    selected && seatKeys[selected] ? draft.seats[seatKeys[selected]!] : undefined;
  const heldFriend = room
    ? selectedLive?.held_for
    : typeof selectedDraft === 'object' && selectedDraft.type === 'held'
      ? selectedDraft.friend
      : undefined;
  const occupied = seatedHuman(selectedLive);
  const seatAt = (position: Position) =>
    room ? liveSeat(position) : seatKeys[position] && draft.seats[seatKeys[position]!];
  const selectedId = seatChoice(selected ? seatAt(selected) : undefined);
  // A character sits at one seat of a table only.
  const seatedBots = positions.flatMap((position) => {
    const persona = position === selected ? null : seatPersona(seatAt(position));
    return persona ? [persona] : [];
  });
  const sections: ChoiceSection[] = [
    {
      title: t('new_table.fill'),
      items: [
        {
          id: 'friend',
          kind: 'deeper',
          title: t('new_table.friend'),
          subtitle: heldFriend?.display_name ?? t('new_table.choose_friend'),
          icon: 'person-plus',
        },
        { id: 'ai', title: t('social.bot'), subtitle: t('seat_row.right_away'), icon: 'bot' },
      ],
    },
    {
      title: t('new_table.leave_open'),
      items: [
        {
          id: 'open',
          title: t('social.anyone'),
          subtitle: t('new_table.anyone_help'),
          icon: 'plus',
        },
        {
          id: '100',
          title: t('seat_row.games', { number: '100' }),
          subtitle: t('new_table.experience'),
          shortSubtitle: t('new_table.experience_short'),
          badge: '100',
        },
        {
          id: '1000',
          title: t('seat_row.games', { number: '1000' }),
          subtitle: t('new_table.experienced'),
          shortSubtitle: t('new_table.experienced_short'),
          badge: '1k',
        },
        {
          id: 'password',
          // Only the server draws the password; until it has, the choice has no digits.
          title: room?.seat_password
            ? t('new_table.with_password_code', { code: room.seat_password })
            : t('new_table.with_password'),
          subtitle: t('new_table.password_help'),
          shortSubtitle: t('new_table.password_help_short'),
          icon: 'lock',
        },
      ],
    },
  ];
  const open = (position: Position) => {
    setQuery('');
    setSelectedPlayerId(liveSeat(position)?.player?.id ?? null);
    setSelected(position);
  };
  // The picker has already closed; a refusal opens it again on the seat as the server has it.
  const send = (position: Position, seat: SeatType) =>
    void onSetSeat?.(position, seat).catch((caught) => {
      open(position);
      setPickerError(seatError(caught));
    });
  const choose = (id: string, persona?: string | null) => {
    if (!selected || busy || controlsBusy) return;
    const seat = seatEntry(id as Exclude<SeatChoice, 'friend'>, persona);
    if (room) {
      if (editable) send(selected, seat);
    } else {
      if (selected === 'south') setPrefilled(true);
      setDraft(chooseSeat(draft, seatKeys[selected]!, seat));
    }
  };
  const footer = room ? waitingFooter(room, editable, readyPlayers.length) : null;
  const full = !!footer?.full;
  const isYouReady = !!youPosition && readyPlayers.includes(youPosition);
  const [readyBusy, setReadyBusy] = useState(false);
  const readyBusyRef = useRef(false);
  const [readyError, setReadyError] = useState<unknown>(null);
  const confirmReady = async () => {
    if (
      !onReady ||
      !footer?.ready ||
      readyDisabled ||
      readyBusyRef.current ||
      isYouReady ||
      isSpectator
    )
      return;
    readyBusyRef.current = true;
    setReadyBusy(true);
    setReadyError(null);
    try {
      await onReady();
    } catch (caught) {
      setReadyError(caught);
    } finally {
      readyBusyRef.current = false;
      setReadyBusy(false);
    }
  };
  const row = (position: Position, index: number) => (
    <SeatRow
      key={position}
      testID={`new-table-seat-${position}`}
      row={seatRow(view(position, index))}
      wrapFace={
        talking
          ? (face) => (
              <Travel
                spots={spots}
                id={`row:${position}`}
                from={`strip:${position}`}
                turn={turn.n}
                pulse={pulses[position]}
                ring={index < 2 ? TALK_RINGS.ours : TALK_RINGS.theirs}>
                {face}
              </Travel>
            )
          : undefined
      }
      onPress={() => {
        if (!busy && !controlsBusy) {
          setPickerError(undefined);
          // A bot seat opens on who sits there.
          setPickerPage(seatChoice(seatAt(position)) === 'ai' ? 'bots' : undefined);
          if (position === declined?.position) onDismissDeclined?.();
          open(position);
        }
      }}
    />
  );
  const kickPlayer = selectedLive?.player;
  // A small or sideways phone has no room above the seats: the card takes the share
  // button's place and says what the status line would.
  const declinedCard = showDeclined && (
    <NoticeCard
      testID="seat-declined-notice"
      variant="cant_come"
      title={t('friend_notice.cant_come', { name: declined.user.display_name })}
      body={t('friend_notice.seat_open_again')}
      avatarUrl={declined.user.avatar_url}
      row={phoneLandscape}
      secondary={{
        label: t('friend_notice.invite_someone_else'),
        onPress: () => {
          if (busy || controlsBusy) return;
          onDismissDeclined?.();
          setQuery('');
          setSelectedPlayerId(null);
          setPickerPage('friends');
          setSelected(declined.position);
        },
      }}
    />
  );
  const rulesLink = room && (
    <TextLink
      testID="waiting-rules-menu"
      // An upright phone's header has room for the short word only.
      label={t(talking && !wide && !tablet ? 'waiting_talk.rules' : 'rules.menu')}
      onPress={rules.show}
    />
  );
  // Phone portrait: pills over their line. Sideways: the line beside them; iPad: under them.
  const rulesChoice = !room && (
    <View style={[styles.rules, tablet && styles.rulesTablet, phoneLandscape && styles.rulesRow]}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('social.rules')}
        style={styles.pills}>
        {(['finnish', 'louisiana'] as const).map((rule) => (
          <ActionPill
            key={rule}
            label={t(`social.${rule}`)}
            selected={draftRules === rule}
            disabled={busy}
            onPress={() => setDraftRules(rule)}
            style={!wide && !tablet && styles.pill}
          />
        ))}
      </View>
      <PidroText
        role="metadata"
        tone="soft"
        align={wide || tablet ? 'right' : 'center'}
        style={phoneLandscape && styles.rulesLine}>
        {t(`social.${ruleSet}_detail`)}
      </PidroText>
    </View>
  );
  const align = phoneLandscape ? 'left' : 'center';
  const readyAction = !isSpectator && !!footer?.ready && !!onReady;
  const footerCard = (compact || phoneLandscape) && !!room && !!declinedCard && !readyAction;
  const joining = joiningName && (
    <PidroText role="metadata" align={align} accessibilityLiveRegion="polite">
      {t('table.joining', { name: joiningName })}
    </PidroText>
  );
  const action = !room ? (
    <BevelButton
      label={t(isPractice(draft) ? 'new_table.start' : 'social.open_table')}
      size="lg"
      fullWidth
      loading={busy}
      disabled={busy}
      onPress={() => onSubmit?.(newTableRequest(draftRules, draft))}
    />
  ) : readyAction ? (
    <BevelButton
      label={t(isYouReady ? 'game.you_ready' : readyBusy ? 'game.confirming' : 'game.im_ready')}
      size="lg"
      fullWidth
      loading={readyBusy}
      disabled={readyDisabled || isYouReady || readyBusy}
      onPress={() => void confirmReady()}
    />
  ) : footerCard ? (
    declinedCard
  ) : !isSpectator && editable && !full ? (
    <BevelButton
      label={t('new_table.share')}
      material="glass"
      size="lg"
      fullWidth
      disabled={controlsBusy}
      onPress={onOpenInvite}
    />
  ) : null;
  // While talking, the rows say who is waiting and who is ready; the line speaks only for news.
  const footerLine = (!talking || footer?.news) && (
    <PidroText role="metadata" tone="soft" align={align} accessibilityLiveRegion="polite">
      {footer ? footer.line : tableFooter(draft)}
    </PidroText>
  );
  const failureLine =
    error || readyError || (!selected && pickerError) ? (
      <PidroText
        testID="waiting-error"
        role="metadata"
        tone="danger"
        align={align}
        accessibilityRole="alert">
        {error || (readyError ? localizedError(readyError, 'game.ready_failed') : pickerError)}
      </PidroText>
    ) : null;
  // Typing gets the field (and the faces once it is focused); a guest or a 13 to 17 the faces alone.
  const faces = talkOpen && (talk.typing !== 'type' || typing) && (
    <TalkEmoji onSend={sendFace} inline={phoneLandscape} />
  );
  const field = talkOpen && talk.typing === 'type' && (
    <TalkField
      talk={talk}
      send={typing || tablet}
      style={phoneLandscape && styles.grow}
      onRefused={refuse}
      onFocus={() => setTyping(true)}
    />
  );
  const nudge = talkOpen && talk.typing === 'guest' && (
    <PidroText role="metadata" tone="soft" align={align}>
      {`${t('talk.guest_type')} ${t('talk.guest_account')}.`}
    </PidroText>
  );
  // PID-420: every other seat a bot, nobody reads it; opening one is how talk comes back.
  // A table made with three bots is solo for good (room/config.ex): it has no talk to promise.
  const closed = talking && !talkOpen && !room.config?.solo && (
    <PidroText testID="waiting-talk-closed" role="metadata" tone="soft" align={align}>
      {t('waiting_talk.opens')}
    </PidroText>
  );
  const refusal = talkOpen && refused && (
    <PidroText
      testID="waiting-talk-refused"
      role="metadata"
      tone="danger"
      accessibilityRole="alert">
      {t(refused)}
    </PidroText>
  );
  const hint = talkOpen && !lines.length ? t('waiting_talk.say_hi') : undefined;
  const strip = folded && (
    <SeatStrip
      faces={order.map((position, index) => ({
        position,
        token: seatRow(view(position, index)).token,
        ring: index < 2 ? TALK_RINGS.ours : TALK_RINGS.theirs,
      }))}
      onPress={unfold}
      spots={spots}
      turn={turn.n}
      pulses={pulses}
      onLayout={(event) => {
        const strip = event.nativeEvent.layout.height;
        if (strip !== heights.strip) setHeights((previous) => ({ ...previous, strip }));
      }}
    />
  );
  return (
    <>
      <ScreenShell
        testID={room ? 'waiting-table' : 'new-table-screen'}
        // Fits at every text size the boards draw; scrolls only if a larger one cannot.
        scroll={phoneLandscape && !talking}
        contentStyle={[
          styles.screen,
          compact && styles.compact,
          phoneLandscape && styles.landscape,
          tablet && (wide ? styles.tabletWide : styles.tablet),
          // The lines take what the screen has left and scroll; they never push the field off it.
          talking && styles.fit,
        ]}>
        <View testID="waiting-toolbar" style={styles.header}>
          <BackButton
            accessibilityLabel={t(
              folded
                ? 'waiting_talk.seats'
                : room
                  ? isSpectator
                    ? 'game.lobby'
                    : 'game.leave'
                  : 'social.cancel_creation'
            )}
            onPress={folded ? unfold : onLeave}
            disabled={busy}
          />
          {phoneLandscape && strip ? (
            <>
              <View style={styles.heading}>{strip}</View>
              <TextLink label={t('waiting_talk.done')} onPress={unfold} />
            </>
          ) : (
            <>
              <View style={styles.heading}>
                <PidroText role="title" tone="gold" style={styles.title}>
                  {room ? tableTitle(room, you) : t('new_table.title')}
                </PidroText>
                {room && (
                  <PidroText testID="waiting-rule-set" role="metadata" tone="soft">
                    {tableHeader(room)}
                  </PidroText>
                )}
              </View>
              {(wide || tablet || talking) && (room ? rulesLink : rulesChoice)}
            </>
          )}
        </View>
        {!compact && !phoneLandscape && declinedCard}
        {!wide && !tablet && !room && rulesChoice}
        {folded ? (
          !phoneLandscape && strip
        ) : (
          <Animated.View
            entering={turn.n ? fades.entering : undefined}
            exiting={folded || !talking || tablet ? undefined : fades.exiting}
            onLayout={(event) => {
              const rows = event.nativeEvent.layout.height;
              if (talking && rows !== heights.rows)
                setHeights((previous) => ({ ...previous, rows }));
            }}
            style={[styles.teams, compact && styles.compactTeams, wide && styles.columns]}>
            <TeamSection team="yours" style={wide && styles.column}>
              {order.slice(0, 2).map((position, index) => row(position, index))}
            </TeamSection>
            <VsDivider between={wide ? 'columns' : 'rows'} />
            <TeamSection team="opponents" style={wide && styles.column}>
              {order.slice(2).map((position, index) => row(position, index + 2))}
            </TeamSection>
          </Animated.View>
        )}
        {talking && !phoneLandscape && (
          // Each fold mounts it again where the rows or the strip left it, and it moves from there.
          <Rise key={turn.n} from={lift} style={[styles.talk, tablet && styles.talkColumn]}>
            <TalkLines lines={timeline} who={who} hint={hint} />
            {tablet && (
              <>
                {faces}
                {refusal}
                {field}
                {nudge}
                {closed}
              </>
            )}
          </Rise>
        )}
        <View
          testID="readiness-panel"
          style={[
            styles.footer,
            talking && styles.footerTalk,
            talking && tablet && styles.talkColumn,
            phoneLandscape && styles.footerRow,
            talking && phoneLandscape && styles.footerEnd,
            talking && phoneLandscape && folded && styles.grow,
          ]}>
          {room && !wide && !tablet && !talking && rulesLink}
          {talking && phoneLandscape ? (
            // One place for the field folded or not: moving it would drop its focus and the keyboard.
            <>
              <View style={[styles.words, folded && styles.stretch]}>
                {joining}
                {footerLine}
                {failureLine}
                {footerCard && declinedCard}
                <TalkLines
                  lines={folded ? timeline : timeline.slice(-2)}
                  who={who}
                  hint={hint}
                  few={!folded}
                />
                {refusal}
                <View style={styles.talkRow}>
                  {faces}
                  {field}
                </View>
                {nudge}
                {closed}
              </View>
              {!folded && !footerCard && action && <View style={styles.action}>{action}</View>}
            </>
          ) : talking && !tablet && !phoneLandscape ? (
            <>
              {joining}
              {footerLine}
              {failureLine}
              {faces}
              {refusal}
              {field}
              {nudge}
              {closed}
              {!folded && action}
            </>
          ) : phoneLandscape && footerCard ? (
            <View style={styles.words}>
              {declinedCard}
              {failureLine}
            </View>
          ) : phoneLandscape ? (
            <>
              <View style={styles.words}>
                {joining}
                {footerLine}
                {failureLine}
              </View>
              {action && <View style={styles.action}>{action}</View>}
            </>
          ) : (
            <>
              {joining}
              {action}
              {!footerCard && footerLine}
              {failureLine}
            </>
          )}
        </View>
      </ScreenShell>
      {isSpectator && <WatchingBadge />}
      <TableFeedback notice={notice ?? null} top={insets.top + 72} onDismiss={onDismissNotice} />
      {room && (
        <RulesExplainer
          ruleSet={ruleSet}
          tableCode={room.code}
          open={rules.open}
          onClose={rules.dismiss}
        />
      )}
      {selected && editable && !occupied && (
        <SeatPickerContainer
          key={selected}
          title={t(selected === order[1] ? 'social.partner_seat' : 'social.opponent')}
          subtitle={t(selected === order[1] ? 'new_table.partner_help' : 'new_table.opponent_help')}
          initialPage={pickerPage}
          error={pickerError}
          choices={{
            sections,
            selectedId,
            // Bot again keeps whoever sits there, as the server does after opening.
            onSelect: (id) =>
              choose(id, id === 'ai' && !room ? seatPersona(seatAt(selected)) : null),
          }}
          bots={{
            help: t(selected === order[1] ? 'picker.bot_partner_help' : 'picker.bot_opponent_help'),
            ...botChoices(bots, ruleSet, seatedBots, seatPersona(seatAt(selected))),
            region: t(`bots.region_${ruleSet}`),
            selected: seatPersona(seatAt(selected)),
            onSeat: (persona) => {
              // The same face again changes nothing; the server is not asked.
              if (persona !== seatPersona(seatAt(selected))) choose('ai', persona);
            },
          }}
          friends={{
            friends: pickerFriends(
              friends,
              heldFriend?.user_id,
              room
                ? assignedRoomPlayerIds(room).filter((id) => id !== heldFriend?.user_id)
                : assignedFriendIds(draft, seatKeys[selected]!)
            ),
            searchText: query,
            onSearchChange: setQuery,
            onInvite: (entry) => {
              const friend = friends.find((candidate) => candidate.user_id === entry.id);
              if (!friend || busy || controlsBusy) return;
              if (room) {
                if (editable) send(selected, { type: 'held', user_id: friend.user_id });
              } else {
                if (selected === 'south') setPrefilled(true);
                setDraft(chooseFriend(draft, seatKeys[selected]!, friend));
              }
            },
            onAddFriends: () => {
              setSelected(null);
              router.push('/friends');
            },
          }}
          onClose={() => {
            setPickerError(undefined);
            setSelected(null);
          }}
        />
      )}
      <Modal
        isOpen={!!selected && editable && occupied}
        title={t('table.managePlayer', {
          name: kickPlayer?.display_name ?? kickPlayer?.username ?? '',
        })}
        onClose={() => setSelected(null)}>
        <View style={styles.confirm}>
          <BevelButton
            label={t('table.kick')}
            material="glass"
            tone="danger"
            fullWidth
            disabled={controlsBusy}
            onPress={() => {
              if (selected && room?.positions?.[selected] === kickPlayer?.id) {
                setKicked((previous) => [...previous, kickPlayer!.id]);
                onKickPlayer?.(selected);
              }
              setSelected(null);
            }}
          />
          <TextLink label={t('common.cancel')} onPress={() => setSelected(null)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { maxWidth: 436, gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  compact: { gap: 8, paddingVertical: 8 },
  landscape: { maxWidth: 1040, paddingVertical: 12 },
  tablet: { maxWidth: 660, gap: 20, paddingVertical: 32 },
  tabletWide: { maxWidth: 1040, gap: 20, paddingVertical: 32 },
  compactTeams: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: PidroFonts.display, fontSize: 24, lineHeight: 32 },
  rules: { gap: 4 },
  rulesTablet: { alignItems: 'flex-end', gap: 8 },
  rulesRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, flexShrink: 1 },
  rulesLine: { flexShrink: 1 },
  pills: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1 },
  teams: { gap: 12 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  column: { flex: 1, minWidth: 0 },
  footer: { marginTop: 'auto', paddingTop: 12, gap: 8, alignItems: 'center' },
  footerRow: { flexDirection: 'row', gap: 20 },
  words: { flex: 1, minWidth: 0, gap: 4 },
  footerTalk: { marginTop: 0, paddingTop: 0, alignItems: 'stretch' },
  talk: { flex: 1, minHeight: 0, gap: 12 },
  talkColumn: { width: '100%', maxWidth: 660, alignSelf: 'center' },
  talkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  fit: { flexShrink: 1, minHeight: 0 },
  footerEnd: { alignItems: 'flex-end' },
  stretch: { alignSelf: 'stretch' },
  action: { width: 300 },
  confirm: { gap: 12 },
});
