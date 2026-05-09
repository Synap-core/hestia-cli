export interface EmbeddedAppLaunchOptions {
  id: string;
  name: string;
  url: string;
  requiresAuth?: boolean;
}

export function createEmbeddedAppHref({
  id,
  name,
  url,
  requiresAuth,
}: EmbeddedAppLaunchOptions): string {
  const params = new URLSearchParams({
    name,
    url,
  });
  if (requiresAuth) params.set("auth", "1");
  return `/apps/${encodeURIComponent(id)}?${params.toString()}`;
}
