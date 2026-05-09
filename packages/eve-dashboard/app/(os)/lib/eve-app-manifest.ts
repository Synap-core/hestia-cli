export type EveAppRendererType = "external" | "iframe-srcdoc";

export interface EveAppManifest {
  id: string;
  name: string;
  rendererType: EveAppRendererType;
  url?: string;
  srcdoc?: string;
  icon?: string;
  origin?: string;
  requiresAuth?: boolean;
  workspaceId?: string;
}

export interface AppEntityLike {
  id: string;
  name?: string;
  properties?: Record<string, unknown>;
}

function stringProp(
  props: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function booleanProp(
  props: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

function normalizeRendererType(
  raw: string | undefined,
  hasUrl: boolean,
  hasSrcdoc: boolean,
): EveAppRendererType | null {
  if (raw === "external" || raw === "iframe-srcdoc") return raw;
  if (hasSrcdoc) return "iframe-srcdoc";
  if (hasUrl) return "external";
  return null;
}

function originFor(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function normalizeAppEntityToManifest(
  entity: AppEntityLike,
): EveAppManifest | null {
  const props = entity.properties ?? {};
  const url = stringProp(props, ["url", "appUrl", "deployUrl", "launchUrl"]);
  const srcdoc = stringProp(props, ["srcdoc", "srcDoc", "html"]);
  const rendererType = normalizeRendererType(
    stringProp(props, ["rendererType", "renderer"]),
    Boolean(url),
    Boolean(srcdoc),
  );

  if (!rendererType) return null;
  if (rendererType === "external" && !url) return null;
  if (rendererType === "iframe-srcdoc" && !srcdoc) return null;

  const entityName = entity.name?.trim();
  const name =
    stringProp(props, ["name", "appName", "title", "label"]) ??
    (entityName && entityName.length > 0 ? entityName : undefined) ??
    entity.id;

  const origin = stringProp(props, ["origin"]) ?? originFor(url);
  const icon = stringProp(props, ["icon", "iconUrl", "emoji"]);
  const requiresAuth = booleanProp(props, ["requiresAuth"]);
  const workspaceId = stringProp(props, ["workspaceId"]);

  return {
    id: entity.id,
    name,
    rendererType,
    ...(rendererType === "external" && url ? { url } : {}),
    ...(rendererType === "iframe-srcdoc" && srcdoc ? { srcdoc } : {}),
    ...(icon ? { icon } : {}),
    ...(origin ? { origin } : {}),
    ...(requiresAuth !== undefined ? { requiresAuth } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

export function normalizeAppEntitiesToManifests(
  entities: AppEntityLike[],
): EveAppManifest[] {
  return entities
    .map((entity) => normalizeAppEntityToManifest(entity))
    .filter((manifest): manifest is EveAppManifest => Boolean(manifest));
}
