import type { ApiClient } from './client';
import type { ClassicAlreadyClaimed, ClassicNewAccount } from './classic';
import type { AdsState } from './ads';
import type { FriendPlayer } from './friends';
import type { PremiumSource } from './premium';
import type { SeatInvitation } from '../types/lobby';

export const TERMS_VERSION = '1';

export type AgeBand = '13_17' | '18_plus' | 'unknown';
export type DeclaredAgeBand = Exclude<AgeBand, 'unknown'> | 'under_13';

export interface AgeTermsRequest {
  age_band?: DeclaredAgeBand;
  terms_version?: string;
}

/** The slug of the player whose link brought a newcomer, sent only while one is pending. */
export interface FriendLinkRequest {
  friend_slug?: string;
}

/** What a sign-up or guest save sends next to its own fields. */
export type SignUpExtras = AgeTermsRequest & FriendLinkRequest;

export interface LoginRequest extends AgeTermsRequest {
  username: string;
  password: string;
}

export type User = {
  id: string;
  email: string | null;
  username: string;
  display_name?: string | null;
  guest?: boolean;
  avatar_url?: string | null;
  share_slug?: string | null;
  bio?: string | null;
  age_band?: AgeBand;
  terms_version?: string | null;
  // Owned by the server (PID-125). Absent from an older server: not Premium.
  premium?: boolean;
  premium_until?: string | null;
  premium_source?: PremiumSource | null;
  /** From `/me` only; absent from an older server, which means no ads. */
  ads?: AdsState;
};

interface AuthResponseEnvelope {
  data: {
    token: string;
    user: User;
    /** The friend a `friend_slug` made, on a sign-up that made one. */
    linked_friend?: FriendPlayer;
  };
}

export type AuthProvider = 'apple' | 'facebook';

export type FacebookCredential =
  | { type: 'access_token'; token: string }
  | { type: 'authentication_token'; token: string; nonce: string };

export type ProviderCredential = { type: 'identity_token'; token: string } | FacebookCredential;

export interface ClassicPreview {
  name: string;
  games_played: number;
  level: number;
  member_since: string | null;
  name_allowed?: boolean | null;
  new_account?: ClassicNewAccount | null;
}

export interface ClassicFound {
  classic_found: true;
  classic: ClassicPreview;
  ticket: string;
  expires_at: string;
  already_claimed?: ClassicAlreadyClaimed | null;
}

export type ProviderLoginResponse =
  | { status: 'signed_in'; session: LoginResponse }
  | { status: 'classic_found'; claim: ClassicFound }
  | { status: 'unknown_identity' };

type ProviderAuthEnvelope =
  | AuthResponseEnvelope
  | {
      data: ClassicFound;
    };

export type LoginResponse = AuthResponseEnvelope['data'];
export type RegisterResponse = AuthResponseEnvelope['data'];
export type UpgradeGuestResponse = AuthResponseEnvelope['data'];

export interface CreateGuestRequest {
  display_name?: string;
  invite_code?: string;
  creation_token?: string;
  platform?: 'ios' | 'android' | 'web';
  install_id?: string;
  age_band?: DeclaredAgeBand;
  terms_version?: string;
}

export interface RegisterRequest extends SignUpExtras {
  user: {
    username: string;
    email: string;
    password: string;
  };
}

export interface UpgradeGuestRequest extends SignUpExtras {
  username: string;
  email: string;
  password: string;
}

export type ProviderAuthRequest = SignUpExtras &
  (
    | {
        identity_token: string;
        access_token?: never;
        authentication_token?: never;
        nonce?: never;
        install_id: string;
      }
    | {
        access_token: string;
        identity_token?: never;
        authentication_token?: never;
        nonce?: never;
        install_id: string;
      }
    | {
        authentication_token: string;
        nonce: string;
        identity_token?: never;
        access_token?: never;
        install_id: string;
      }
  );

export interface SetAgeRequest {
  age_band: DeclaredAgeBand;
  terms_version: string;
}

interface GuestResponseEnvelope extends AuthResponseEnvelope {
  data: AuthResponseEnvelope['data'] & { state?: string };
}

export type CreateGuestResponse = GuestResponseEnvelope['data'];

interface PasswordResetRequestEnvelope {
  data: {
    message: string;
    reset_token?: string;
    reset_url?: string;
  };
}

interface UserResponseEnvelope {
  data: {
    user: User;
    ads?: AdsState;
    seat_invitations?: SeatInvitation[];
  };
}

export type PasswordResetRequestResponse = PasswordResetRequestEnvelope['data'];

// This build can show the ad /me may say is due; the server counts an offer only on such reads.
const AD_AWARE = { params: { ads_aware: true } };

export function createAuthApi(api: ApiClient) {
  const providerLogin = async (
    provider: AuthProvider,
    credential: ProviderCredential,
    installId: string,
    ageTerms: SignUpExtras = {}
  ): Promise<ProviderLoginResponse> => {
    const credentials =
      credential.type === 'identity_token'
        ? { identity_token: credential.token }
        : credential.type === 'access_token'
          ? { access_token: credential.token }
          : { authentication_token: credential.token, nonce: credential.nonce };
    const response = await api.post<ProviderAuthEnvelope>(
      `/api/v1/auth/${provider}`,
      {
        ...credentials,
        install_id: installId,
        ...ageTerms,
      } satisfies ProviderAuthRequest,
      // An unrecognized provider identity is an expected sign-in result. Let
      // the caller handle it without the client's global 401 session clearer.
      {
        validateStatus: (status) => (status >= 200 && status < 300) || status === 401,
      }
    );

    if (response.status === 401) return { status: 'unknown_identity' };

    const data = response.data.data;
    if ('token' in data) {
      return { status: 'signed_in', session: data };
    }
    return { status: 'classic_found', claim: data };
  };

  return {
    login: async (
      username: string,
      password: string,
      ageTerms: AgeTermsRequest = {}
    ): Promise<LoginResponse> => {
      const request: LoginRequest = { username, password, ...ageTerms };
      const response = await api.post<AuthResponseEnvelope>('/api/v1/auth/login', request, {
        preserveSessionOnUnauthorized: true,
      });
      return response.data.data;
    },

    register: async (
      username: string,
      email: string,
      password: string,
      ageTerms: SignUpExtras = {}
    ): Promise<RegisterResponse> => {
      const request: RegisterRequest = {
        user: { username, email, password },
        ...ageTerms,
      };
      const response = await api.post<AuthResponseEnvelope>('/api/v1/auth/register', request);
      return response.data.data;
    },

    upgradeGuest: async (
      displayName: string,
      email: string,
      password: string,
      ageTerms: SignUpExtras = {}
    ): Promise<UpgradeGuestResponse> => {
      const request: UpgradeGuestRequest = {
        username: displayName,
        email,
        password,
        ...ageTerms,
      };
      const response = await api.post<AuthResponseEnvelope>('/api/v1/auth/upgrade', request, {
        preserveSessionOnUnauthorized: true,
      });
      return response.data.data;
    },

    createGuest: async (request: CreateGuestRequest): Promise<CreateGuestResponse> => {
      const response = await api.post<GuestResponseEnvelope>('/api/v1/auth/guest', request);
      return response.data.data;
    },

    getMe: async (): Promise<User> => {
      const response = await api.get<UserResponseEnvelope>('/api/v1/auth/me', AD_AWARE);
      const { user, ads } = response.data.data;
      return ads ? { ...user, ads } : user;
    },

    getSeatInvitations: async (): Promise<SeatInvitation[]> => {
      const response = await api.get<UserResponseEnvelope>('/api/v1/auth/me', AD_AWARE);
      return response.data.data.seat_invitations ?? [];
    },

    setAge: async (request: SetAgeRequest): Promise<User> => {
      const response = await api.post<UserResponseEnvelope>('/api/v1/auth/age', request);
      return response.data.data.user;
    },

    requestPasswordReset: async (identifier: string): Promise<PasswordResetRequestResponse> => {
      const response = await api.post<PasswordResetRequestEnvelope>('/api/v1/auth/password-reset', {
        identifier,
      });
      return response.data.data;
    },

    resetPassword: async (token: string, password: string): Promise<LoginResponse> => {
      const response = await api.post<AuthResponseEnvelope>('/api/v1/auth/password-reset/confirm', {
        token,
        password,
      });
      return response.data.data;
    },

    // No body: the server answers 400 to an empty JSON body.
    deleteAccount: async (): Promise<void> => {
      await api.delete('/api/v1/auth/me');
    },

    providerLogin,
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
