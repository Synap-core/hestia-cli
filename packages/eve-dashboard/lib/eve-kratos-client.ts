import type { PodRuntimeContext } from "@/lib/pod-runtime-context";
import {
  DashboardApiException,
  parseKratosErrorResponse,
  parseKratosFlowResponse,
  parseKratosSuccessResponse,
  type KratosSuccessResponse,
} from "@/lib/pod-response-parsers";

type AuthMode = "login" | "registration";
type RecoveryMode = "password" | "verification";

export interface KratosAuthInput {
  mode: AuthMode;
  email: string;
  password: string;
  name?: string;
}

export function createEveKratosClient(context: PodRuntimeContext) {
  const kratosBase = context.kratosPublicBaseUrl;

  return {
    async submitPasswordAuth(input: KratosAuthInput): Promise<KratosSuccessResponse> {
      const flow = await initFlow(
        input.mode === "login"
          ? `${kratosBase}/self-service/login/api`
          : `${kratosBase}/self-service/registration/api`,
        "Kratos flow init",
      );

      const submitEndpoint =
        input.mode === "login"
          ? `${kratosBase}/self-service/login?flow=${encodeURIComponent(flow.id)}`
          : `${kratosBase}/self-service/registration?flow=${encodeURIComponent(flow.id)}`;

      const submitBody =
        input.mode === "login"
          ? { method: "password", identifier: input.email, password: input.password }
          : {
              method: "password",
              traits: { email: input.email, name: input.name ?? input.email.split("@")[0] },
              password: input.password,
            };

      return submitKratosForm(submitEndpoint, submitBody);
    },

    async startRecovery(mode: RecoveryMode, email: string): Promise<void> {
      const flow = await initFlow(
        mode === "password"
          ? `${kratosBase}/self-service/recovery/api`
          : `${kratosBase}/self-service/verification/api`,
        `Kratos ${mode} flow init`,
      );

      const submitEndpoint =
        mode === "password"
          ? `${kratosBase}/self-service/recovery?flow=${encodeURIComponent(flow.id)}`
          : `${kratosBase}/self-service/verification?flow=${encodeURIComponent(flow.id)}`;

      await submitKratosForm(submitEndpoint, { method: "link", email });
    },
  };
}

async function initFlow(endpoint: string, label: string): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    throw new DashboardApiException(
      {
        error: "pod-unreachable",
        detail: err instanceof Error ? err.message : "Pod unreachable",
      },
      502,
    );
  }

  if (!response.ok) {
    throw new DashboardApiException(
      {
        error: "pod-unreachable",
        detail: `${label} returned ${response.status}`,
      },
      502,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  const flow = parseKratosFlowResponse(body);
  if (!flow) {
    throw new DashboardApiException(
      { error: "pod-unreachable", detail: "No flow id in Kratos response" },
      502,
    );
  }

  return { id: flow.id };
}

async function submitKratosForm(endpoint: string, body: unknown): Promise<KratosSuccessResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new DashboardApiException(
      {
        error: "pod-unreachable",
        detail: err instanceof Error ? err.message : "Pod unreachable",
      },
      502,
    );
  }

  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = parseKratosErrorResponse(responseBody);
    throw new DashboardApiException(
      {
        error: "kratos-error",
        messages: friendlyMessages(parsed.messages),
        status: response.status,
      },
      422,
    );
  }

  return parseKratosSuccessResponse(responseBody) ?? {};
}

function friendlyMessages(raw: string[]): string[] {
  return raw.map((message) => {
    const lower = message.toLowerCase();
    if (
      lower.includes("provided credentials are invalid") ||
      lower.includes("invalid credentials") ||
      lower.includes("identifier or password")
    ) {
      return "Wrong email or password.";
    }
    if (lower.includes("already exists") || lower.includes("already registered")) {
      return "An account with that email already exists. Try signing in instead.";
    }
    if (lower.includes("password") && lower.includes("too short")) {
      return "Password is too short (minimum 8 characters).";
    }
    if (lower.includes("valid email")) {
      return "Enter a valid email address.";
    }
    return message;
  });
}
