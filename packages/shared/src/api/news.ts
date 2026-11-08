import type { ApiClient } from './client';
import type { Locale } from '../i18n';

/** A localized post. Bodies allow bold, line breaks and links. Fields are additive for old servers. */
export interface NewsPost {
  id: number;
  title: string;
  body: string;
  published_at: string;
  eyebrow?: string | null;
  image_url?: string | null;
  button_label?: string | null;
  button_url?: string | null;
  show_as_popup?: boolean;
  app_update?: boolean;
  show_below_android?: string | null;
  show_below_ios?: string | null;
}

/** Newest first; `unread` counts the posts published since the player last opened News. */
export interface NewsPage {
  posts: NewsPost[];
  unread: number;
  popup?: NewsPost | null;
}

export function createNewsApi(api: ApiClient) {
  return {
    list: async (
      locale: Locale,
      client?: { platform: string; app_version: string | null; app_build: string | null }
    ): Promise<NewsPage> => {
      const response = await api.get<{ data?: Partial<NewsPage> }>('/api/v1/news', {
        params: { locale, ...client },
      });
      const data = response.data?.data;
      return { posts: data?.posts ?? [], unread: data?.unread ?? 0, popup: data?.popup };
    },

    seen: async (): Promise<void> => {
      await api.post('/api/v1/news/seen');
    },

    popupSeen: async (id: number): Promise<void> => {
      await api.post(`/api/v1/news/${id}/seen`);
    },
  };
}

export type NewsApi = ReturnType<typeof createNewsApi>;
