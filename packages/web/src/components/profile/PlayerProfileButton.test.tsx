import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProfileButton } from './PlayerProfileButton';
import { profileApi } from '../../api/profile';

vi.mock('../../api/profile', () => ({ profileApi: { getPlayer: vi.fn() } }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});

describe('public profile name', () => {
  it.each([
    null,
    '',
    '   ',
    'iOS 1',
    'Edited 🦊',
    'Same name',
  ])('uses username rather than display_name %j', async (display_name) => {
    vi.mocked(profileApi.getPlayer).mockResolvedValue({
      user_id: 'stable-ios-id',
      username: 'mfios1',
      display_name,
      avatar_url: null,
      bio: null,
      classic: null,
      level: 1,
      prestige: 0,
      title: null,
      pin: null,
      record: { games: 0, win_rate: 0 },
      medals: 0,
      together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
    });
    render(
      <PlayerProfileButton playerId="stable-ios-id" name="mfios1">
        Open
      </PlayerProfileButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: "View mfios1's profile" }));
    expect(await screen.findByRole('heading', { name: 'mfios1' })).toBeInTheDocument();
    expect(profileApi.getPlayer).toHaveBeenCalledWith('stable-ios-id');
    expect(screen.queryByText('@mfios1')).not.toBeInTheDocument();
    if (display_name?.trim()) expect(screen.queryByText(display_name)).not.toBeInTheDocument();
  });
});
