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

  return (
    <EmbeddedExternalAppPage
      appId={decodeURIComponent(id)}
      name={firstParam(query.name)}
      url={firstParam(query.url)}
      sendAuth={firstParam(query.auth) === "1"}
    />
  );
}
