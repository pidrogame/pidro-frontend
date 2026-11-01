import { createFeedbackApi } from '@pidro/shared';
import { api } from './client';

export const feedbackApi = createFeedbackApi(api);
