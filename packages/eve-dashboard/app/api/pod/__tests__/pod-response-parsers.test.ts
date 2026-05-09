import { describe, expect, it } from "vitest";
import {
  parseKratosErrorResponse,
  parseKratosFlowResponse,
  parseSetupStatusResponse,
  parseTrpcJsonEnvelope,
} from "@/lib/pod-response-parsers";

describe("pod response parsers", () => {
  it("unwraps plain and superjson tRPC envelopes", () => {
    const parseValue = (payload: unknown) =>
      payload && typeof payload === "object" && "value" in payload
        ? (payload as { value: string })
        : null;

    expect(parseTrpcJsonEnvelope({ result: { data: { value: "plain" } } }, parseValue)).toEqual({
      value: "plain",
    });
    expect(parseTrpcJsonEnvelope({ result: { data: { json: { value: "wrapped" } } } }, parseValue)).toEqual({
      value: "wrapped",
    });
  });

  it("parses setup.status payloads", () => {
    expect(
      parseSetupStatusResponse({
        result: { data: { json: { initialized: true, version: "1.2.3" } } },
      }),
    ).toEqual({ initialized: true, version: "1.2.3" });

    expect(parseSetupStatusResponse({ result: { data: { initialized: "yes" } } })).toBeNull();
  });

  it("parses Kratos flow ids and UI errors", () => {
    const body = {
      id: "flow-123",
      ui: {
        messages: [{ text: "top-level", type: "error" }],
        nodes: [{ messages: [{ text: "node-level", type: "error" }] }],
      },
      error: { reason: "reason", message: "message" },
    };

    expect(parseKratosFlowResponse(body)?.id).toBe("flow-123");
    expect(parseKratosErrorResponse(body).messages).toEqual([
      "top-level",
      "node-level",
      "reason",
      "message",
    ]);
  });
});
