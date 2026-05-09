export interface SetupStatusData {
  initialized: boolean;
  version?: string;
}

export interface KratosFlowResponse {
  id: string;
  ui?: KratosUi;
  error?: KratosFlowError;
}

export interface KratosSuccessResponse {
  session_token?: string;
  session?: { expires_at?: string };
  identity?: {
    id?: string;
    traits?: {
      email?: string;
      name?: string;
    };
  };
}

export interface KratosErrorResponse {
  messages: string[];
}

export interface DashboardApiError {
  error: string;
  messages?: string[];
  detail?: string;
  status?: number;
}

interface KratosUiMessage {
  text?: string;
  type?: string;
}

interface KratosUiNode {
  messages?: KratosUiMessage[];
}

interface KratosUi {
  messages?: KratosUiMessage[];
  nodes?: KratosUiNode[];
}

interface KratosFlowError {
  reason?: string;
  message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function getString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === "string" ? child : undefined;
}

export function parseTrpcJsonEnvelope<T>(
  json: unknown,
  parsePayload: (payload: unknown) => T | null,
): T | null {
  const envelope = Array.isArray(json) ? json[0] : json;
  const result = getRecord(envelope, "result");
  const data = result?.data;
  const payload = isRecord(data) && "json" in data ? data.json : data;
  return parsePayload(payload);
}

export function parseSetupStatusResponse(json: unknown): SetupStatusData | null {
  return parseTrpcJsonEnvelope(json, (payload) => {
    if (!isRecord(payload) || typeof payload.initialized !== "boolean") {
      return null;
    }
    const version = typeof payload.version === "string" ? payload.version : undefined;
    return { initialized: payload.initialized, version };
  });
}

export function parseKratosFlowResponse(json: unknown): KratosFlowResponse | null {
  if (!isRecord(json)) return null;
  const id = getString(json, "id");
  if (!id) return null;

  return {
    id,
    ui: parseKratosUi(json.ui),
    error: parseKratosFlowError(json.error),
  };
}

export function parseKratosSuccessResponse(json: unknown): KratosSuccessResponse | null {
  if (!isRecord(json)) return null;

  const session = getRecord(json, "session");
  const identity = getRecord(json, "identity");
  const traits = getRecord(identity, "traits");

  return {
    session_token: getString(json, "session_token"),
    session: session ? { expires_at: getString(session, "expires_at") } : undefined,
    identity: identity
      ? {
          id: getString(identity, "id"),
          traits: traits
            ? {
                email: getString(traits, "email"),
                name: getString(traits, "name"),
              }
            : undefined,
        }
      : undefined,
  };
}

export function parseKratosErrorResponse(json: unknown): KratosErrorResponse {
  const body = isRecord(json) ? json : null;
  const ui = parseKratosUi(body?.ui);
  const error = parseKratosFlowError(body?.error);
  const messages: string[] = [];

  for (const message of ui?.messages ?? []) {
    if (message.text) messages.push(message.text);
  }
  for (const node of ui?.nodes ?? []) {
    for (const message of node.messages ?? []) {
      if (message.text) messages.push(message.text);
    }
  }
  if (error?.reason) messages.push(error.reason);
  if (error?.message) messages.push(error.message);

  return {
    messages: messages.length ? messages : ["Authentication failed. Check your credentials."],
  };
}

export function toDashboardApiError(error: unknown, fallback = "request-failed"): DashboardApiError {
  if (error instanceof DashboardApiException) {
    return error.body;
  }
  if (error instanceof Error) {
    return { error: fallback, detail: error.message };
  }
  return { error: fallback };
}

export class DashboardApiException extends Error {
  constructor(
    readonly body: DashboardApiError,
    readonly httpStatus: number,
  ) {
    super(body.detail ?? body.messages?.join(" ") ?? body.error);
    this.name = "DashboardApiException";
  }
}

function parseKratosUi(value: unknown): KratosUi | undefined {
  if (!isRecord(value)) return undefined;

  return {
    messages: parseKratosMessages(value.messages),
    nodes: Array.isArray(value.nodes)
      ? value.nodes.map((node) => ({
          messages: parseKratosMessages(isRecord(node) ? node.messages : undefined),
        }))
      : undefined,
  };
}

function parseKratosFlowError(value: unknown): KratosFlowError | undefined {
  if (!isRecord(value)) return undefined;
  return {
    reason: getString(value, "reason"),
    message: getString(value, "message"),
  };
}

function parseKratosMessages(value: unknown): KratosUiMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((message) => {
    if (!isRecord(message)) return [];
    return [{ text: getString(message, "text"), type: getString(message, "type") }];
  });
}
