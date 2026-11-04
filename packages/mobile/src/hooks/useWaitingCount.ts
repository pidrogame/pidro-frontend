import { friendNoticeFixture } from '@/features/friends/fixtures';
import { waitingCount } from '@/features/friends/waitingCount';
import { seatInvitationsFixture } from '@/features/lobby/fixtures';
import { newsFixture } from '@/features/news';
import { useAuthStore } from '@/stores/auth';
import { useFriendsStore } from '@/stores/friends';

/** Home and the tab count the same answers, including seats received by guests. */
export function useWaitingCount(fixture?: string) {
  const guest = useAuthStore((state) => Boolean(state.user?.guest));
  const seats = useAuthStore((state) => state.seatInvitations);
  const requests = useFriendsStore((state) => state.requests_waiting);
  const addedYou = useFriendsStore((state) => state.added_you);
  const waiting = useFriendsStore((state) => state.waiting_for_you);
  const notices = friendNoticeFixture(fixture);
  const previewSeats = seatInvitationsFixture(fixture);
  const news = newsFixture(fixture);
  if (news) return news.requests;
  if (notices) {
    return waitingCount(
      {
        added_you: [],
        requests_waiting: guest ? 0 : notices.filter((n) => n.kind === 'request').length,
      },
      notices.flatMap((n) => (n.kind === 'seat' ? [n.invitation] : []))
    );
  }
  return waitingCount(
    {
      added_you: addedYou,
      requests_waiting: guest ? 0 : __DEV__ && fixture === 'waiting' ? 3 : requests,
      waiting_for_you:
        guest || previewSeats || (__DEV__ && fixture === 'waiting') ? undefined : waiting,
    },
    previewSeats ?? seats
  );
}
