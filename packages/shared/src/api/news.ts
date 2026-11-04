import type { ApiClient } from './client';
import type { Locale } from '../i18n';

/** A post from us, in the player's language: plain text, line breaks kept. */
export interface NewsPost {
  id: number;
  title: string;
  body: string;
  published_at: string;
}

/** Newest first; `unread` counts the posts published since the player last opened News. */
export interface NewsPage {
  posts: NewsPost[];
  unread: number;
}

export function createNewsApi(api: ApiClient) {
  return {
    list: async (locale: Locale): Promise<NewsPage> => {
      const response = await api.get<{ data?: Partial<NewsPage> }>('/api/v1/news', {
        params: { locale },
      });
      const data = response.data?.data;
      return { posts: data?.posts ?? [], unread: data?.unread ?? 0 };
    },

    seen: async (): Promise<void> => {
      await api.post('/api/v1/news/seen');
    },
  };
}

export type NewsApi = ReturnType<typeof createNewsApi>;
