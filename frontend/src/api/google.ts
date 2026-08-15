import { apiClient } from './client';
import type { Deal } from './deals';

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  updatedAt: string | null;
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  return (await apiClient.get<GoogleStatus>('/integrations/google/status')).data;
}

export async function connectGoogle(): Promise<void> {
  const { authorizationUrl } = (await apiClient.post<{ authorizationUrl: string }>('/integrations/google/connect')).data;
  window.location.assign(authorizationUrl);
}

export async function disconnectGoogle(): Promise<void> {
  await apiClient.delete('/integrations/google');
}

export async function syncDealToCalendar(id: number): Promise<{ count: number; failed: number; deal: Deal }> {
  return (await apiClient.post<{ count: number; failed: number; deal: Deal }>(`/deals/${id}/calendar`)).data;
}
