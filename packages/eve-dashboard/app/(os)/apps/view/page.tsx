import { EmbeddedExternalAppPage } from "../[id]/page-client";

interface ViewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ViewPage({ searchParams }: ViewPageProps) {
  const query = await searchParams;
  const url = firstParam(query.url);
  const name = firstParam(query.name);
  const sendAuth = firstParam(query.auth) === "1";

  return (
    <EmbeddedExternalAppPage
      appId={name ?? url ?? "app"}
      name={name}
      url={url}
      sendAuth={sendAuth}
      shareUrl={url ? buildShareUrl(url, name, sendAuth) : undefined}
    />
  );
}

function buildShareUrl(url: string, name: string | undefined, auth: boolean): string {
  const params = new URLSearchParams({ url });
  if (name) params.set("name", name);
  if (auth) params.set("auth", "1");
  return `/apps/view?${params.toString()}`;
}
