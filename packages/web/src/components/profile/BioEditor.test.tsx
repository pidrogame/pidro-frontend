import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { profileApi } from '../../api/profile';
import { BioEditor } from './BioEditor';
import { PlayerProfileButton } from './PlayerProfileButton';

vi.mock('../../api/profile', () => ({ profileApi: { updateBio: vi.fn(), getPlayer: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it('cancels without saving and preserves a failed draft for retry', async () => {
  const saved = vi.fn();
  render(<BioEditor bio="Original" onSaved={saved} />);
  fireEvent.click(screen.getByText('Edit bio'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Different' } });
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByText('Original')).toBeTruthy();
  expect(profileApi.updateBio).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Edit bio'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '你好 🙂\nReady to play!' } });
  vi.mocked(profileApi.updateBio)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ bio: '你好 🙂\nReady to play!' });
  fireEvent.click(screen.getByText('Save bio'));
  expect(await screen.findByRole('alert')).toHaveTextContent('draft is still here');
  expect(screen.getByRole('textbox')).toHaveValue('你好 🙂\nReady to play!');
  fireEvent.click(screen.getByText('Save bio'));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('你好 🙂\nReady to play!'));
});

it('validates scalar count and permits clearing', async () => {
  const saved = vi.fn();
  render(<BioEditor bio="Original" onSaved={saved} />);
  fireEvent.click(screen.getByText('Edit bio'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '🙂'.repeat(281) } });
  expect(screen.getByText('Save bio')).toBeDisabled();
  expect(screen.getByText('1 characters over the limit')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  vi.mocked(profileApi.updateBio).mockResolvedValue({ bio: null });
  fireEvent.click(screen.getByText('Save bio'));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(null));
});

it('shows the public profile as text without an editor, and closes without navigation', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.mocked(profileApi.getPlayer).mockResolvedValue({
    user_id: 'other',
    username: 'Anna',
    display_name: null,
    avatar_url: null,
    bio: '<script>alert(1)</script>',
    classic: null,
    level: 1,
    prestige: 0,
    title: null,
    pin: null,
    record: { games: 0, win_rate: 0 },
    medals: 0,
    together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
  });
  const { container } = render(
    <PlayerProfileButton playerId="other" name="Anna">
      Anna
    </PlayerProfileButton>,
  );
  fireEvent.click(screen.getByRole('button', { name: "View Anna's profile" }));
  expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy();
  expect(document.querySelector('dialog script')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByText('Close'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(container.textContent).toBe('Anna');
});
