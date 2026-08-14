import { apiClient } from './client';

export async function getGoogleLoginUrl() {
  const { data } = await apiClient.get<{ authorizationUrl: string }>('/auth/google');
  return data.authorizationUrl;
}
