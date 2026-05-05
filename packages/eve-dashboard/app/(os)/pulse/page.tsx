"use client";

/**
 * Eve OS — Pulse (`/pulse`).
 *
 * The system-health snapshot. Operators come here to answer
 * "is everything green?" without grepping logs.
 *
 * Top → bottom layout (concentric radii: pane 32 → gutter 20 → card 12):
 *
 *   1. Headline strip — "All systems green" or 3 numbers (running /
 *      degraded / errors).
 *   2. Components grid — one compact health card per installed component,
 *      glass-icon glyph + name + state pill + click-to-open.
 *   3. Connectivity — Pod / CP / Domain sub-cards (paired? signed in?
 *      reachable?). Pulled from /api/secrets-summary, /api/networking,
 *      /api/components/synap/info.
 *   4. Recent issues (collapsible, default closed) — last 10 doctor-
 *      reported issues with a per-row Repair button when the doctor
 *      ships a `repair.kind`.
 *
 * Data sources, all fetched in parallel. Each `Promise.allSettled` so a
 * single 500 doesn't blank the whole page — partial-load is surfaced
 * via a small chip at the top.
 *
 *   GET /api/components             — local component states
 *   GET /api/secrets-summary        — CP/pod credential presence
 *   GET /api/networking             — domain config, traefik state
 *   GET /api/components/synap/info  — pod URL + admin metadata
 *   GET /api/doctor                 — diagnostic checks (issues feed)
 *
 * This page replaces the old /settings/stack-pulse sub-tab — promoted
 * to a top-level Eve OS app surface.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Spinner, addToast } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { PaneHeader } from "../components/pane-header";
import { Headline } from "./components/headline";
import { ComponentsGrid } from "./components/components-grid";
import { Connectivity } from "./components/connectivity";
import { Issues } from "./components/issues";
import type {
  ComponentRow,
  SecretsSummary,
  NetworkingInfo,
  PodInfo,
  DoctorReport,
} from "./components/types";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PulsePage() {
  const router = useRouter();

  const [components, setComponents] = useState<ComponentRow[] | null>(null);
  const [secrets, setSecrets] = useState<SecretsSummary | null>(null);
  const [networking, setNetworking] = useState<NetworkingInfo | null>(null);
  const [podInfo, setPodInfo] = useState<PodInfo | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreachable, setUnreachable] = useState<number>(0);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);

    const [
      componentsRes,
      secretsRes,
      networkingRes,
      podInfoRes,
      doctorRes,
    ] = await Promise.allSettled([
      fetch("/api/components",             { credentials: "include", cache: "no-store" }),
      fetch("/api/secrets-summary",        { credentials: "include", cache: "no-store" }),
      fetch("/api/networking",             { credentials: "include", cache: "no-store" }),
      fetch("/api/components/synap/info",  { credentials: "include", cache: "no-store" }),
      fetch("/api/doctor",                 { credentials: "include", cache: "no-store" }),
    ]);

    // Auth: if any source 401s, kick to /login. We check raw responses
    // before reading bodies so we don't waste a parse.
    const responses = [componentsRes, secretsRes, networkingRes, podInfoRes, doctorRes];
    if (responses.some(r => r.status === "fulfilled" && r.value.status === 401)) {
      router.push("/login");
      return;
    }

    let failed = 0;

    if (componentsRes.status === "fulfilled" && componentsRes.value.ok) {
      const data = await componentsRes.value.json() as { components: ComponentRow[] };
      setComponents(data.components);
    } else {
      failed += 1;
    }

    if (secretsRes.status === "fulfilled" && secretsRes.value.ok) {
      setSecrets(await secretsRes.value.json() as SecretsSummary);
    } else {
      failed += 1;
    }

    if (networkingRes.status === "fulfilled" && networkingRes.value.ok) {
      setNetworking(await networkingRes.value.json() as NetworkingInfo);
    } else {
      failed += 1;
    }

    if (podInfoRes.status === "fulfilled" && podInfoRes.value.ok) {
      setPodInfo(await podInfoRes.value.json() as PodInfo);
    } else {
      // Pod info is optional — pod may simply not be installed. Don't
      // count this as a hard "unreachable" unless the request itself
      // failed (rejection or 5xx, not 404).
      if (podInfoRes.status === "fulfilled" && podInfoRes.value.status >= 500) {
        failed += 1;
      }
    }

    if (doctorRes.status === "fulfilled" && doctorRes.value.ok) {
      setDoctor(await doctorRes.value.json() as DoctorReport);
    } else {
      failed += 1;
    }

    setUnreachable(failed);
    setLoading(false);
    setRefreshing(false);
  }, [router]);

  useEffect(() => {
    void fetchAll();
    // Auto-refresh every 30s while the tab is visible. We can't pause on
    // hidden because we don't know how long the operator will be away —
    // but 30s is gentle enough for a control surface.
    const interval = setInterval(() => void fetchAll(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Hard failure path — every endpoint returned an error.
  const allFailed =
    !loading &&
    components === null &&
    secrets === null &&
    networking === null &&
    doctor === null;

  return (
    <>
      <PaneHeader
        title="Pulse"
        back={() => router.push("/")}
        actions={
          <>
            {!loading && unreachable > 0 && !allFailed && (
              <Chip
                size="sm"
                variant="flat"
                color="warning"
                classNames={{ content: "text-[11px] font-medium" }}
              >
                Partial — {unreachable} {unreachable === 1 ? "source" : "sources"} unreachable
              </Chip>
            )}
            <Button
              isIconOnly
              variant="light"
              size="sm"
              radius="full"
              aria-label="Refresh"
              onPress={() => {
                void fetchAll().then(() => {
                  addToast({ title: "Pulse refreshed", color: "default" });
                });
              }}
              isLoading={refreshing}
              className="text-foreground/55 hover:text-foreground"
            >
              {!refreshing && <RefreshCw className="h-4 w-4" strokeWidth={2} />}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4 sm:px-6 sm:pt-5">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : allFailed ? (
          <AllUnreachable onRetry={() => void fetchAll()} />
        ) : (
          <div className="flex flex-col gap-6">
            <Headline components={components} doctor={doctor} />

            <ComponentsGrid components={components} />

            <Connectivity
              secrets={secrets}
              networking={networking}
              podInfo={podInfo}
            />

            <Issues doctor={doctor} onRepaired={() => void fetchAll(true)} />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Hard-error empty state ──────────────────────────────────────────────────

function AllUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div
        className="
          flex max-w-md flex-col items-center gap-3 rounded-xl
          bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
          px-6 py-8 text-center
        "
      >
        <h2 className="text-[15px] font-medium text-foreground">
          Couldn&apos;t load Pulse data
        </h2>
        <p className="text-[12.5px] text-foreground/55">
          None of the dashboard&apos;s data endpoints responded. Check that
          the Eve dashboard service is running and try again.
        </p>
        <Button
          size="sm"
          radius="full"
          color="primary"
          variant="flat"
          startContent={<RefreshCw className="h-3.5 w-3.5" />}
          onPress={onRetry}
          className="font-medium"
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
