import { describe, expect, it } from "vitest";
import {
  normalizeAppEntitiesToManifests,
  normalizeAppEntityToManifest,
} from "../eve-app-manifest";

describe("eve app manifest normalization", () => {
  it("normalizes external app entity properties", () => {
    expect(
      normalizeAppEntityToManifest({
        id: "crm",
        name: "CRM",
        properties: {
          appName: "Field CRM",
          deployUrl: "https://crm.example.com/app",
          iconUrl: "https://cdn.example.com/crm.png",
          requiresAuth: "true",
          workspaceId: "ws_builder",
        },
      }),
    ).toEqual({
      id: "crm",
      name: "Field CRM",
      rendererType: "external",
      url: "https://crm.example.com/app",
      icon: "https://cdn.example.com/crm.png",
      origin: "https://crm.example.com",
      requiresAuth: true,
      workspaceId: "ws_builder",
    });
  });

  it("normalizes generated srcdoc apps without requiring a URL", () => {
    expect(
      normalizeAppEntityToManifest({
        id: "tiny-tool",
        name: "Tiny Tool",
        properties: {
          rendererType: "iframe-srcdoc",
          srcdoc: "<!doctype html><button>Run</button>",
          emoji: "T",
          requiresAuth: false,
        },
      }),
    ).toEqual({
      id: "tiny-tool",
      name: "Tiny Tool",
      rendererType: "iframe-srcdoc",
      srcdoc: "<!doctype html><button>Run</button>",
      icon: "T",
      requiresAuth: false,
    });
  });

  it("drops entities without a launch surface", () => {
    expect(
      normalizeAppEntitiesToManifests([
        { id: "notes", properties: { appName: "Notes" } },
        { id: "live", properties: { url: "http://localhost:7777" } },
      ]),
    ).toEqual([
      {
        id: "live",
        name: "live",
        rendererType: "external",
        url: "http://localhost:7777",
        origin: "http://localhost:7777",
      },
    ]);
  });
});
