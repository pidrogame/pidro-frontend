import type { ApiClient } from './client';
import type { User } from './auth';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const BIO_MAX_LENGTH = 280;

// Frozen ECMAScript edge whitespace; keep identical to User.bio_changeset/2.
const BIO_EDGE_WHITESPACE =
  /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;

export function normalizeBio(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(BIO_EDGE_WHITESPACE, '');
}

export function bioLength(value: string): number {
  return Array.from(normalizeBio(value)).length;
}

export function bioError(value: string): string | null {
  const points = Array.from(value);
  if (
    points.some((point) => {
      const code = point.codePointAt(0)!;
      return code === 0 || (code >= 0xd800 && code <= 0xdfff);
    })
  )
    return 'Your bio contains an unsupported character.';
  return bioLength(value) > BIO_MAX_LENGTH
    ? `Keep your bio to ${BIO_MAX_LENGTH} characters.`
    : null;
}

export interface ProfileIdentity {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  /** As on the current user (PID-395); absent from an older server. */
  avatar_face?: 'a' | 'b' | null;
  has_photo?: boolean;
  bio: string | null;
  games_played?: number;
  veteran?: {
    level: number;
    xp?: number;
    title?: string;
    /** XP into the current level and the level's span, or "max" at the top. */
    progress?: [number, number] | 'max';
    /** Legend stars: one per 500,000 XP past level 100. */
    prestige?: number;
    /** XP into the next star and the star's span; null below level 100. */
    prestige_progress?: [number, number] | null;
  };
  /** XP earned since Monday and since the 1st, both UTC. */
  xp?: { this_week: number; this_month: number };
  /** Pidro and Classic games added up. `win_rate` is 0 to 1. */
  record?: { games: number; wins: number; losses: number; win_rate: number };
  /** When the account was made. */
  first_seen_at?: string | null;
  /** Earned medals, in the order they were earned. */
  achievements?: Achievement[];
  /** Every medal there is to earn, each marked earned or not. */
  achievements_catalog?: AchievementCatalogEntry[];
  classic: ClassicProfile | null;
}

/**
 * Another player's sheet, from `GET /api/v1/profiles/:id`: who they are, with
 * the sheet's answers on top (PID-337).
 */
export interface PlayerSheet {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  level: number;
  /** Legend stars past level 100. */
  prestige: number;
  title: string | null;
  pin: 'classic' | null;
  classic: {
    username?: string | null;
    member_since?: string | null;
    games_played?: number | null;
  } | null;
  /** Pidro and Classic games added up. `win_rate` is 0 to 1. */
  record: { games: number; win_rate: number };
  /** How many medals they have earned. */
  medals: number;
  /** The viewer and this player: as partners, and against each other. */
  together: {
    games: number;
    won_as_partners: number;
    against_games: number;
    against_won: number;
  };
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  tier: number;
  awarded_at: string;
}

export interface AchievementCatalogEntry {
  key: string;
  name: string;
  description: string;
  tier: number;
  earned: boolean;
}

export interface ClassicProfile {
  name?: string;
  games_played?: number;
  wins?: number;
  losses?: number;
  win_rate?: number;
  level?: number;
  member_since?: string;
  claimed_at?: string;
}

export function createProfileApi(api: ApiClient) {
  return {
    getIdentity: async (): Promise<ProfileIdentity> => {
      const response = await api.get<{ data: ProfileIdentity }>('/api/v1/profile');
      return response.data.data;
    },
    getPlayer: async (id: string): Promise<PlayerSheet> => {
      const response = await api.get<{ data: PlayerSheet }>(
        `/api/v1/profiles/${encodeURIComponent(id)}`
      );
      return response.data.data;
    },
    /** The player behind `pidro.online/play/<slug>`. */
    getPlayerBySlug: async (slug: string): Promise<PlayerSheet> => {
      const response = await api.get<{ data: PlayerSheet }>(
        `/api/v1/players/by-slug/${encodeURIComponent(slug)}`
      );
      return response.data.data;
    },
    updateBio: async (draft: string) => {
      const error = bioError(draft);
      if (error) throw new Error(error);
      const response = await api.patch<{ data: { bio: string | null } }>('/api/v1/profile', {
        bio: normalizeBio(draft) || null,
      });
      return response.data.data;
    },
    uploadAvatar: async (
      file: Blob | { uri: string; name: string; type: string },
      onProgress?: (percent: number) => void
    ) => {
      const data = new FormData();
      // React Native's FormData accepts a file URI instead of a browser Blob.
      data.append('avatar', file as Blob);
      const response = await api.post<{ data: { avatar_url: string } }>(
        '/api/v1/profile/avatar',
        data,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60_000,
          onUploadProgress: ({ loaded, total }) => {
            if (total) onProgress?.(Math.min(100, Math.round((loaded / total) * 100)));
          },
        }
      );
      return response.data.data;
    },
    removeAvatar: async () => {
      const response = await api.delete<{ data: { avatar_url: string | null } }>(
        '/api/v1/profile/avatar'
      );
      return response.data.data;
    },
    /** Picks the face shown without a photo; guests too. Answers with the current user. */
    setFace: async (face: 'a' | 'b'): Promise<User> => {
      const response = await api.put<{ data: { user: User } }>('/api/v1/profile/avatar/face', {
        face,
      });
      return response.data.data.user;
    },
  };
}
