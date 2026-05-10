import { EmbeddedExternalAppPage } from "./page-client";

interface AppRouteProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AppPage({ params, searchParams }: AppRouteProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const url = firstParam(query.url);
  const name = firstParam(query.name);
  const sendAuth = firstParam(query.auth) === "1";

  const shareUrl = url
    ? `/apps/view?${new URLSearchParams({ url, ...(name ? { name } : {}), ...(sendAuth ? { auth: "1" } : {}) }).toString()}`
    : undefined;

  return (
    <EmbeddedExternalAppPage
      appId={decodeURIComponent(id)}
      name={name}
      url={url}
      sendAuth={sendAuth}
      shareUrl={shareUrl}
    />
  );
}
