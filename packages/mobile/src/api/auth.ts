import { createAuthApi } from '@pidro/shared';
import { api } from './client';

export type {
  AgeBand,
  AgeTermsRequest,
  AuthProvider,
  ClassicFound,
  ClassicPreview,
  CreateGuestRequest,
  CreateGuestResponse,
  FacebookCredential,
  LoginResponse,
  PasswordLoginResponse,
  ProviderCredential,
  ProviderLoginResponse,
  RegisterResponse,
  UpgradeGuestResponse,
  User,
} from '@pidro/shared';

const authApi = createAuthApi(api);

export const login = authApi.login;
export const passwordLogin = authApi.passwordLogin;
export const register = authApi.register;
export const upgradeGuest = authApi.upgradeGuest;
export const createGuest = authApi.createGuest;
export const deleteAccount = authApi.deleteAccount;
export const getMe = authApi.getMe;
export const getSeatInvitations = authApi.getSeatInvitations;
export const setAge = authApi.setAge;
export const requestPasswordReset = authApi.requestPasswordReset;
export const resetPassword = authApi.resetPassword;
export const providerLogin = authApi.providerLogin;
