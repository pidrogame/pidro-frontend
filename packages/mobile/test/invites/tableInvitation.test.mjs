import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import {
  tableInvitation,
  tableInvitationLine,
  unnoticedInvitations,
} from '../../src/features/invites/tableInvitation.ts';

const human = { occupant_type: 'human', status: 'connected', user_id: 'u' };
const bot = { occupant_type: 'bot', status: 'connected', user_id: null, has_reservation: false };

function readiness(seats) {
  return {
    room_id: 'r',
    ready_epoch: 1,
    snapshot_revision: 1,
    status: 'playing',
    positions: {},
    seats: { north: bot, east: bot, west: bot, south: human, ...seats },
    ready_players: [],
  };
}

const later = {
  code: 'LATE',
  position: 'north',
  host_id: 'h2',
  held_since: '2026-10-19T12:05:00Z',
};
const older = {
  code: 'OLDR',
  position: 'east',
  host_id: 'h1',
  held_since: '2026-10-19T12:00:00Z',
};

describe('tableInvitation', () => {
  it('shows the oldest invitation to a player among bots', () => {
    expect(tableInvitation([later, older], readiness(), 'south', 'player')).toBe(older);
  });

  it('never shows with another person at the table', () => {
    expect(tableInvitation([later], readiness({ east: human }), 'south', 'player')).toBeNull();
  });

  it('counts a bot keeping a player seat as that player', () => {
    const keeping = { ...bot, has_reservation: true };
    expect(tableInvitation([later], readiness({ west: keeping }), 'south', 'player')).toBeNull();
  });

  it('counts only the other seats, so a bot game seen from east still shows it', () => {
    const fromEast = readiness({ south: bot, east: human });
    expect(tableInvitation([later], fromEast, 'east', 'player')).toBe(later);
    expect(tableInvitation([later], fromEast, 'south', 'player')).toBeNull();
  });

  it('shows nothing while spectating, without an invitation or before the seats are known', () => {
    expect(tableInvitation([later], readiness(), 'south', 'spectator')).toBeNull();
    expect(tableInvitation([], readiness(), 'south', 'player')).toBeNull();
    expect(tableInvitation([later], null, 'south', 'player')).toBeNull();
  });
});

describe('tableInvitationLine', () => {
  it('names the rules and the seat, or the rules alone', () => {
    setLocale('en');
    const finnish = { ...later, rule_set: 'finnish' };
    expect(tableInvitationLine({ ...finnish, join_as: 'partner' }, 'Bertil')).toBe(
      'Finnish · as Bertil’s partner'
    );
    expect(tableInvitationLine({ ...finnish, join_as: 'opponent' }, 'Bertil')).toBe(
      'Finnish · as Bertil’s opponent'
    );
    expect(tableInvitationLine(finnish, 'Bertil')).toBe('Finnish');
  });
});

describe('unnoticedInvitations', () => {
  it('leaves out only the invitation whose own seat notice is waiting or on screen', () => {
    const astrid = { user_id: 'astrid', display_name: 'Astrid', avatar_url: null };
    const notices = [
      { kind: 'seat', invitation: { ...older } },
      { kind: 'request', player: astrid },
      // The same seat held again later is a new invitation, with its own notice to come.
      { kind: 'seat', invitation: { ...later, held_since: '2026-10-19T11:00:00Z' } },
    ];
    expect(unnoticedInvitations([later, older], notices)).toEqual([later]);
    expect(unnoticedInvitations([later, older], [])).toEqual([later, older]);
  });
});
