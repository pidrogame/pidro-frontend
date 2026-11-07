import { createPushApi } from '@pidro/shared';
import { api } from './client';

export const pushApi = createPushApi(api);
