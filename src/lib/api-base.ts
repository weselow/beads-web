const configuredApiBase = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();

export function getApiBase(): string {
  if (!configuredApiBase) return "";
  return configuredApiBase.replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}${normalizedPath}`;
}
