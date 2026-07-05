import { useCallback } from 'react';

export function getApiUrl(path: string): string {
  if (location.port === '5173') {
    return `http://192.168.50.226:16980/api/${path}`;
  }
  const protocol = location.protocol === 'https:' ? 'https' : 'http';
  const port = location.port ? `:${location.port}` : '';
  return `${protocol}://${location.hostname}${port}/api/${path}`;
}

export function useApiUrl() {
  const stableGetApiUrl = useCallback((path: string): string => {
    return getApiUrl(path);
  }, []);

  return { getApiUrl: stableGetApiUrl };
}

