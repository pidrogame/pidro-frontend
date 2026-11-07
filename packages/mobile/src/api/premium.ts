import { createPremiumApi } from '@pidro/shared';
import { api } from './client';

export const premiumApi = createPremiumApi(api);
