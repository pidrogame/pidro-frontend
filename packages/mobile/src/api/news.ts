import { createNewsApi } from '@pidro/shared';
import { api } from './client';

export const newsApi = createNewsApi(api);
