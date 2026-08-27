const isBrowser = typeof window !== 'undefined';
const host = isBrowser ? window.location.hostname : '127.0.0.1';
const port = isBrowser ? window.location.port : '';
const wsProto = isBrowser && window.location.protocol === 'https:' ? 'wss' : 'ws';

/** Em build de produção (UI servida pela API), same-origin. Em dev, API na :3001. */
export const API_BASE =
  import.meta.env.VITE_API_BASE !== undefined && import.meta.env.VITE_API_BASE !== ''
    ? import.meta.env.VITE_API_BASE
    : import.meta.env.PROD
      ? ''
      : `http://${host}:3001`;

export const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.PROD
    ? `${wsProto}://${host}${port ? `:${port}` : ''}`
    : `ws://${host}:3001`);

export const TOKEN_STORAGE_KEY = 'forja_api_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}
