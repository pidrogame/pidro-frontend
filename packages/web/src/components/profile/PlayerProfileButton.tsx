import type { PlayerSheet } from '@pidro/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { profileApi } from '../../api/profile';
import { Button } from '../ui/Button';
import { PlayerAvatar } from './PlayerAvatar';

/** A profile peek never navigates away from (or disconnects) the table. */
export function PlayerProfileButton({
  playerId,
  name,
  children,
}: {
  playerId?: string | null;
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!playerId || playerId.startsWith('bot_')) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-label={`View ${name}'s profile`}
        title={`View ${name}'s profile`}
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 rounded-full outline-offset-4 focus-visible:outline-2 focus-visible:outline-cyan-100"
      >
        {children}
      </button>
      {open && <PlayerProfileDialog playerId={playerId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlayerProfileDialog({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<PlayerSheet>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setError(false);
    profileApi
      .getPlayer(playerId)
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [playerId, attempt]);

  return createPortal(
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="player-profile-heading"
      className="pidro-window m-auto p-6 text-white backdrop:bg-black/70"
      style={{
        position: 'fixed',
        width: 'min(92vw,440px)',
        maxHeight: '85dvh',
        overflowY: 'auto',
        borderRadius: 20,
      }}
    >
      <h2 id="player-profile-heading" className="mb-5 text-xl font-bold">
        Player profile
      </h2>
      {error ? (
        <div role="alert" className="space-y-3">
          <p>Could not load this player’s profile.</p>
          <Button size="sm" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </Button>
        </div>
      ) : !profile ? (
        <p role="status">Loading profile…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <PlayerAvatar
              src={profile.avatar_url ?? undefined}
              name={profile.username}
              initial={profile.username[0]}
              size={72}
            />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h3 className="text-lg font-bold">{profile.username}</h3>
            </div>
          </div>
          <h3 className="text-sm font-bold text-cyan-100">About me</h3>
          <p
            dir="auto"
            className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
          >
            {profile.bio || 'No bio yet.'}
          </p>
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
