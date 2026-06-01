export function getApiUpstreamUrl(): string {
  return (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
}
