import { createLeagueApi } from '@pidro/shared';
import { api } from './client';

export const leagueApi = createLeagueApi(api);
