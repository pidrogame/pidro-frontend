import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { PlatformConfig } from '../platform/types';

declare module 'axios' {
  interface AxiosRequestConfig {
    preserveSessionOnUnauthorized?: boolean;
    /** Sends no Authorization header, even while someone is signed in. */
    withoutSession?: boolean;
  }
}

export type TokenGetter = () => string | null;
export type SessionClearer = () => void;

interface ApiClientDeps {
  config: PlatformConfig;
  getToken: TokenGetter;
  clearSession: SessionClearer;
  shouldPreserveSessionOnUnauthorized?: () => boolean;
}

export function createApiClient({
  config,
  getToken,
  clearSession,
  shouldPreserveSessionOnUnauthorized,
}: ApiClientDeps) {
  const instance = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  instance.interceptors.request.use(
    (reqConfig: InternalAxiosRequestConfig) => {
      const token = getToken();
      if (token && !reqConfig.withoutSession) {
        reqConfig.headers.Authorization = `Bearer ${token}`;
      }
      return reqConfig;
    },
    (error: AxiosError) => Promise.reject(error),
  );

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const authorization = error.config?.headers?.Authorization;
      const requestToken =
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length)
          : null;
      if (
        error.response?.status === 401 &&
        !error.config?.preserveSessionOnUnauthorized &&
        !shouldPreserveSessionOnUnauthorized?.() &&
        requestToken != null &&
        requestToken === getToken()
      ) {
        clearSession();
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

export type ApiClient = ReturnType<typeof createApiClient>;
