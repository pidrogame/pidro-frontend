import { expect, it } from 'bun:test';
import { normalizeRoom, roomWithReadiness, setLocale } from '@pidro/shared';
import { assignedFriendIds, chooseFriend, chooseSeat, createFailure, defaultSeats, isPractice, newTableRequest, pickerFriends, seatChoice, seatedHuman, seatEntry, seatError, tableFooter, tableHeader, tableTitle, waitingFooter } from '../../src/features/lobby/newTable';
import { seatRow } from '../../src/features/lobby/seatRow';

const maija = { user_id: 'maija', display_name: 'Maija', avatar_url: null, presence: 'online' };
const draft = () => ({ seats: { ...defaultSeats } });

it('opens a public Ostrobothnian table in one tap, with three open seats and no link positions', () => {
  expect(newTableRequest('finnish', draft())).toEqual({ rule_set: 'finnish', seats: { seat_2: 'open', seat_3: 'open', seat_4: 'open' } });
  expect(tableFooter(draft())).toBe('Open seats are listed in Tables.');
  expect(isPractice(draft())).toBe(false);
});

it('sends the partner hold, experience and password plan, never inventing a password', () => {
  const plan = chooseSeat(chooseSeat(chooseFriend(draft(), 'seat_3', maija), 'seat_2', { type: 'open', min_games: 100 }), 'seat_4', { type: 'open', min_games: 0, password: true });
  expect(newTableRequest('louisiana', plan)).toEqual({ rule_set: 'louisiana', seats: { seat_2: { type: 'open', min_games: 100 }, seat_3: { type: 'held', user_id: 'maija' }, seat_4: { type: 'open', min_games: 0, password: true } } });
  expect(tableFooter(plan)).toBe('Open seats are listed in Tables. Maija gets an invitation.');
  expect(seatRow({ team: 'opponent', opened: false, type: 'open', passwordRequired: true })).toMatchObject({ status: 'Password', token: { kind: 'open', locked: true, badge: null } });
});

it('changes one whole seat at a time, dropping the former hold or requirement', () => {
  const before = chooseFriend(chooseSeat(draft(), 'seat_2', { type: 'open', min_games: 1000 }), 'seat_3', maija);
  expect(assignedFriendIds(before, 'seat_4')).toEqual(['maija']);
  expect(assignedFriendIds(before, 'seat_3')).toEqual([]);
  const after = chooseSeat(chooseSeat(before, 'seat_3', 'ai'), 'seat_2', 'open');
  expect(newTableRequest('finnish', after).seats).toEqual({ seat_2: 'open', seat_3: 'ai', seat_4: 'open' });
  expect(newTableRequest('finnish', before).seats).toEqual({ seat_2: { type: 'open', min_games: 1000 }, seat_3: { type: 'held', user_id: 'maija' }, seat_4: 'open' });
});

it('distinguishes invite-only from practice and retranslates the footer and header', () => {
  const bots = { seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' } };
  expect(isPractice(bots)).toBe(true);
  expect(tableFooter(bots)).toBe('A practice game with three bots.');
  expect(tableFooter(chooseFriend(bots, 'seat_3', maija))).toBe('Only the people you invite can join.');
  const room = normalizeRoom({ code: 'TEST', config: { rule_set: 'louisiana' }, seats: { north: { user_id: 'host', occupant_type: 'human' }, south: { occupant_type: 'vacant', password: true } } });
  expect(tableHeader(room)).toBe('Listed in Tables · Louisiana');
  expect(tableHeader({ ...room, seats: [{ status: 'free', player: null, held_for: maija }] })).toBe('Invite only · Louisiana');
  try {
    setLocale('sv');
    expect(tableFooter(chooseFriend(draft(), 'seat_3', maija))).toBe('Lediga platser visas i Bord. Maija får en inbjudan.');
    expect(tableHeader(room)).toBe('Visas i Bord · Louisiana');
    expect(tableFooter(bots)).toBe('Ett övningsspel med tre botar.');
  } finally { setLocale('en'); }
});

it('calls three bots a quick game, not invite-only, and keeps human tables distinct', () => {
  const host = { status: 'occupied', player: { id: 'host', username: 'Bertil' } };
  const bots = [2, 3, 4].map((id) => ({ status: 'occupied', player: { id: `bot_${id}`, is_bot: true } }));
  const room = { host_id: 'host', seats: [host, ...bots] };
  expect(tableHeader(room)).toBe('Quick game · Ostrobothnian');
  const positions = { north: 'host', east: 'bot_TEST_east', south: 'bot_TEST_south', west: 'bot_TEST_west' };
  const readiness = { room_id: 'room', status: 'ready', positions, seats: Object.fromEntries(Object.keys(positions).map((position) => [position, { occupant_type: position === 'north' ? 'human' : 'bot', user_id: position === 'north' ? 'host' : null }])) };
  expect(tableHeader(roomWithReadiness(room, readiness))).toBe('Quick game · Ostrobothnian');
  expect(tableHeader({ ...room, config: { rule_set: 'louisiana' } })).toBe('Quick game · Louisiana');
  expect(tableHeader({ ...room, seats: [host, ...bots.map((seat) => ({ ...seat, player: { id: seat.player.id } }))] })).toBe('Quick game · Ostrobothnian');
  expect(tableHeader({ ...room, seats: [host, ...bots.slice(0, 2), { status: 'free', player: null }] })).toBe('Listed in Tables · Ostrobothnian');
  expect(tableHeader({ ...room, seats: [host, ...bots.slice(0, 2), { status: 'free', player: null, held_for: maija }] })).toBe('Invite only · Ostrobothnian');
  expect(tableHeader({ ...room, seats: [host, ...bots.slice(0, 2), { status: 'occupied', player: { id: 'maija' } }] })).toBe('Invite only · Ostrobothnian');
  try {
    setLocale('sv');
    expect(tableHeader(room)).toBe('Snabbspel · Österbottnisk');
  } finally { setLocale('en'); }
});

it('calls the table yours only for its host; a player who joined sees whose it is', () => {
  const snapshot = { room_id: 'room', status: 'waiting', positions: { north: 'bertil', east: 'you', south: null, west: null }, seats: { north: { occupant_type: 'human', user_id: 'bertil', username: 'Bertil' }, east: { occupant_type: 'human', user_id: 'you', username: 'you' }, south: { occupant_type: 'vacant' }, west: { occupant_type: 'vacant' } } };
  const room = roomWithReadiness({ code: 'TEST', host_id: 'bertil', seats: [] }, snapshot);
  expect(tableTitle(room, 'bertil')).toBe('Your table');
  expect(tableTitle(room, 'you')).toBe('Bertil’s table');
  try {
    setLocale('sv');
    expect(tableTitle(room, 'you')).toBe('Bertils bord');
  } finally { setLocale('en'); }
});

it('renders password and requirements from readiness, and readiness from the server for a non-host', () => {
  const snapshot = { room_id: 'room', status: 'waiting', positions: { north: 'host', east: 'you', south: null, west: null }, seats: { north: { occupant_type: 'human' }, east: { occupant_type: 'human' }, south: { occupant_type: 'vacant', min_games: 100, password: true }, west: { occupant_type: 'vacant', held_for: maija } } };
  const room = roomWithReadiness({ code: 'TEST', seat_password: '4821', seats: [] }, snapshot);
  expect(room.seat_password).toBe('4821');
  expect(room.seats.find((seat) => seat.position === 'south')).toMatchObject({ min_games: 100, password: true, player: null });
  expect(room.seats.find((seat) => seat.position === 'west').held_for).toEqual(maija);
  expect(seatRow({ team: 'you', host: false, opened: true, type: 'open', editable: false, ready: false })).toMatchObject({ name: 'You', status: 'Not ready', tappable: false });
  expect(seatRow({ team: 'opponent', opened: true, type: 'open', passwordRequired: true, editable: false })).toMatchObject({ status: 'Waiting…', tappable: false });
});

it('maps server friend presence and assignment to selectable rows', () => {
  const entries = [maija, { ...maija, user_id: 'bots', presence: 'at_table', table_company: 'bots' }, { ...maija, user_id: 'busy', presence: 'at_table', table_company: 'people' }, { ...maija, user_id: 'off', presence: 'offline' }];
  expect(pickerFriends(entries).map(({ section, availability }) => [section, availability])).toEqual([['online', 'online'], ['online', 'bots'], ['busy', 'others'], ['offline', 'offline']]);
  expect(pickerFriends(entries, 'maija', ['off']).map((friend) => friend.availability)).toEqual(['selected', 'bots', 'others', 'taken']);
  // A table without a known company may have people at it: nobody is pulled out of that game.
  expect(pickerFriends([{ ...maija, presence: 'at_table' }]).map(({ section, availability }) => [section, availability])).toEqual([['busy', 'others']]);
});

it('sends each picker choice as one whole entry, and the draft it builds is the plan sent on Open', () => {
  const choices = ['ai', 'open', '100', '1000', 'password'];
  expect(choices.map(seatEntry)).toEqual(['ai', 'open', { type: 'open', min_games: 100 }, { type: 'open', min_games: 1000 }, { type: 'open', min_games: 0, password: true }]);
  const plan = chooseSeat(chooseSeat(chooseFriend(draft(), 'seat_2', maija), 'seat_3', seatEntry('password')), 'seat_4', seatEntry('1000'));
  expect(newTableRequest('finnish', plan).seats).toEqual({ seat_2: { type: 'held', user_id: 'maija' }, seat_3: { type: 'open', min_games: 0, password: true }, seat_4: { type: 'open', min_games: 1000 } });
  // Back from a friend to a bot drops the invitation from the plan.
  expect(newTableRequest('finnish', chooseSeat(plan, 'seat_2', seatEntry('ai'))).seats.seat_2).toBe('ai');
  for (const choice of choices) expect(seatChoice(seatEntry(choice))).toBe(choice);
  expect(seatChoice({ type: 'held', friend: maija })).toBe('friend');
});

it('reopens the picker on the choice the server has for the seat', () => {
  const live = (seat) => ({ seat_index: 3, position: 'west', status: 'free', player: null, min_games: 0, password: false, held_for: null, ...seat });
  expect(seatChoice(live({}))).toBe('open');
  expect(seatChoice(live({ min_games: 100 }))).toBe('100');
  expect(seatChoice(live({ min_games: 1000 }))).toBe('1000');
  expect(seatChoice(live({ password: true }))).toBe('password');
  expect(seatChoice(live({ held_for: maija }))).toBe('friend');
  const bot = live({ status: 'occupied', player: { id: 'bot_west', username: 'Antti', is_bot: true } });
  expect(seatChoice(bot)).toBe('ai');
  expect(seatedHuman(bot)).toBe(false);
  expect(seatedHuman(live({ status: 'occupied', player: { id: 'kalle', username: 'Kalle' } }))).toBe(true);
  expect(seatedHuman(live({ held_for: maija }))).toBe(false);
});

it('says a refused seat change in plain words', () => {
  const refused = (code) => ({ response: { status: 422, data: { errors: [{ code }] } } });
  expect(seatError(refused('ALREADY_SEATED'))).toBe('That friend already has a seat. Choose someone else.');
  expect(seatError(refused('SEAT_NOT_VACANT'))).toBe('Someone sat down in this seat.');
  // The host is at this table: the friend is the one at a table with others, not the host.
  expect(seatError(refused('ALREADY_IN_ROOM'))).toBe('That friend is playing with others now. Choose someone else.');
  expect(seatError(new Error('network'))).toBe('This seat could not be changed. Please try again.');
  try {
    setLocale('sv');
    expect(seatError(refused('SEAT_NOT_VACANT'))).toBe('Någon har satt sig på den här platsen.');
  } finally { setLocale('en'); }
});

it('blames a held friend, not the host, when opening is refused for a table elsewhere', () => {
  const refused = (code) => ({ response: { status: 422, data: { errors: [{ code }] } } });
  const held = newTableRequest('finnish', chooseFriend(draft(), 'seat_3', maija));
  expect(createFailure(refused('ALREADY_IN_ROOM'), held)).toEqual({ key: 'new_table.held_friend_busy' });
  const open = newTableRequest('finnish', draft());
  const error = refused('ALREADY_IN_ROOM');
  expect(createFailure(error, open)).toEqual({ error, key: 'social.create_error' });
  expect(createFailure(refused('ACCOUNT_REQUIRED'), held).key).toBe('social.account_error');
});

it('holds Ready for a dropped human by public name, restores it on return, and handles a freed seat', () => {
  const positions = { north: 'host', east: 'pedro', south: 'maija', west: 'bot_west' };
  const snapshot = { room_id: 'room', status: 'waiting', positions, seats: Object.fromEntries(Object.entries(positions).map(([position, id]) => [position, { user_id: id, occupant_type: id.startsWith('bot_') ? 'bot' : 'human', status: position === 'east' ? 'reconnecting' : 'normal', username: position === 'east' ? 'guest_12345678' : id, display_name: position === 'east' ? 'Pedro1' : null }])) };
  const room = roomWithReadiness({ code: 'TEST', seats: [] }, snapshot);
  expect(waitingFooter(room, false, 3)).toEqual({ full: true, ready: false, line: 'Waiting for Pedro1…' });
  try {
    setLocale('sv');
    expect(waitingFooter(room, true, 3).line).toBe('Väntar på Pedro1…');
  } finally { setLocale('en'); }
  snapshot.seats.east.status = 'connected';
  const returned = roomWithReadiness(room, snapshot);
  expect(waitingFooter(returned, false, 3)).toEqual({ full: true, ready: true, line: '3 of 4 ready' });
  snapshot.positions = { ...snapshot.positions, east: null };
  snapshot.seats.east = { occupant_type: 'vacant', user_id: null, status: null };
  const freed = roomWithReadiness(returned, snapshot);
  expect(waitingFooter(freed, false, 2)).toEqual({ full: false, ready: false, line: 'Waiting for players.' });
  expect(waitingFooter(freed, true, 2).line).toBe('Waiting for players. Tap a seat to change it.');
  const bot = returned.seats.find((seat) => seat.position === 'west');
  bot.connectionStatus = 'reconnecting';
  expect(waitingFooter(returned, false, 3).ready).toBe(true);
});

it('preserves a reconnecting status from both room payload shapes and a second normalization', () => {
  const map = normalizeRoom({ code: 'TEST', seats: { east: { user_id: 'pedro', username: 'Pedro1', status: 'reconnecting' } } });
  const array = normalizeRoom({ code: 'TEST', seats: [{ seat_index: 1, status: 'reconnecting', player: { id: 'pedro', username: 'Pedro1' } }] });
  for (const room of [map, array, normalizeRoom(map)]) {
    expect(room.seats[0]).toMatchObject({ status: 'occupied', connectionStatus: 'reconnecting' });
    expect(waitingFooter(room, false, 0).line).toBe('Waiting for Pedro1…');
    expect(waitingFooter(room, false, 0).ready).toBe(false);
  }
  const vacant = normalizeRoom({ code: 'TEST', seats: { east: { user_id: null, status: null } } });
  expect(normalizeRoom(vacant)).toEqual(vacant);
});
