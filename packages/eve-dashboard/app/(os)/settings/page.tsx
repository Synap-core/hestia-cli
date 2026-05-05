"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner, Chip, addToast } from "@heroui/react";
import {
  RefreshCw, KeyRound, RotateCw, Eye, EyeOff, Copy, Check,
  Download, Sun, Moon, Monitor, LogIn, LogOut, Plug,
} from "lucide-react";
import { useTheme } from "next-themes";
import { ThemeToggle } from "../../components/theme-toggle";
import { usePodPairing } from "../hooks/use-pod-pairing";
import { PodPairDialog } from "../components/pod-pair-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsData {
  eveVersion: string | null;
  initializedAt: string | null;
  hostname: string | null;
  platform: string | null;
  dashboardSecretSet: boolean;
  dashboardPort: number;
  registryPath: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Newly-rotated secret, surfaced once so the user can copy it before logout.
  const [rotated, setRotated] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) setData(await res.json() as SettingsData);
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function rotateSecret() {
    if (!confirm("Rotate the dashboard key?\n\nYou'll be signed out. Save the new key BEFORE you sign out — it's the only time it's shown.")) return;
    setRotating(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "rotate-secret" }),
      });
      if (res.ok) {
        const data = await res.json() as { newSecret?: string };
        if (data.newSecret) setRotated(data.newSecret);
        addToast({ title: "Dashboard key rotated", color: "success" });
      } else {
        addToast({ title: "Rotation failed", color: "danger" });
      }
    } catch {
      addToast({ title: "Rotation failed", color: "danger" });
    } finally { setRotating(false); }
  }

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Header
       * -------------------------------------------------------------- */}
      <header>
        <p className="text-sm font-medium text-default-500">Eve</p>
        <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
          Settings
        </h1>
        <p className="mt-1 max-w-2xl text-default-500">
          Configuration that belongs to Eve itself, not to your installed components.
        </p>
      </header>

      {/* -----------------------------------------------------------------
       * Pod connection — sign in / out of the user's pod
       * -------------------------------------------------------------- */}
      <Section
        title="Pod connection"
        description="Eve signs into your pod as you, not as itself. Use this to manage the cached user-channel session."
      >
        <Surface className="p-5">
          <PodConnectionPanel />
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Dashboard key — show + rotate
       * -------------------------------------------------------------- */}
      <Section
        title="Dashboard access"
        description="The key you typed to unlock this panel."
      >
        <Surface className="p-5 space-y-4">
          {rotated ? (
            <RotatedKeyBanner secret={rotated} onSignOut={async () => {
              await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
              router.push("/login");
            }} />
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-[260px]">
                <Stat
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  label="Status"
                  value={
                    data.dashboardSecretSet ? (
                      <Chip size="sm" color="success" variant="flat" radius="sm">configured</Chip>
                    ) : (
                      <Chip size="sm" color="warning" variant="flat" radius="sm">not set</Chip>
                    )
                  }
                />
                <p className="mt-3 text-xs text-default-500">
                  The current key is hidden by design. Rotate to generate a new one — your
                  current session will sign out.
                </p>
              </div>
              <Button
                color="primary"
                radius="md"
                size="sm"
                startContent={<RotateCw className="h-3.5 w-3.5" />}
                isLoading={rotating}
                onPress={() => void rotateSecret()}
              >
                Rotate key
              </Button>
            </div>
          )}
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Theme — explicit picker (rail also has a compact toggle)
       * -------------------------------------------------------------- */}
      <Section
        title="Appearance"
        description="Light, dark, or follow your system."
      >
        <Surface className="p-5">
          <ThemePicker />
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * Backup — placeholder until export is wired
       * -------------------------------------------------------------- */}
      <Section
        title="Backup"
        description="Snapshot of your Eve state and secrets — keep this somewhere safe."
      >
        <Surface className="p-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-[260px]">
              <p className="text-sm font-medium text-foreground">Export entity</p>
              <p className="mt-1 text-xs text-default-500">
                Not yet wired in the UI. For now, run on the host:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-content2 px-3 py-2 font-mono text-xs text-foreground">
                <code>tar -czf eve-backup.tar.gz /opt/eve/.eve ~/.local/share/eve</code>
              </pre>
            </div>
            <Button
              size="sm"
              variant="bordered"
              radius="md"
              startContent={<Download className="h-3.5 w-3.5" />}
              isDisabled
            >
              Download tarball
            </Button>
          </div>
        </Surface>
      </Section>

      {/* -----------------------------------------------------------------
       * About
       * -------------------------------------------------------------- */}
      <Section title="About" description="What's running this dashboard.">
        <Surface className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Eve version" value={
              data.eveVersion
                ? <span className="font-mono text-sm text-foreground">v{data.eveVersion}</span>
                : <span className="text-sm text-default-400">unknown</span>
            } />
            <Stat label="Hostname" value={
              data.hostname
                ? <span className="font-mono text-xs text-foreground">{data.hostname}</span>
                : <span className="text-sm text-default-400">—</span>
            } />
            <Stat label="Platform" value={
              data.platform
                ? <span className="font-mono text-xs text-foreground">{data.platform}</span>
                : <span className="text-sm text-default-400">—</span>
            } />
            <Stat label="Initialized" value={
              data.initializedAt
                ? <span className="text-xs text-foreground">{new Date(data.initializedAt).toLocaleString()}</span>
                : <span className="text-sm text-default-400">—</span>
            } />
          </div>
        </Surface>
      </Section>

      {/* Theme toggle exists in the rail too — but offering it explicitly here
          makes it visible on mobile where the rail is collapsed. */}
      <p className="hidden">
        <ThemeToggle />
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-default-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Surface({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-divider bg-content1 ${className}`}>{children}</div>
  );
}

function Stat({
  icon, label, value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-default-400">
        {icon && <span className="text-default-400">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="mt-1.5">{value}</div>
    </div>
  );
}

function RotatedKeyBanner({ secret, onSignOut }: { secret: string; onSignOut: () => void }) {
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <p className="text-sm font-semibold text-foreground">New dashboard key</p>
      <p className="mt-1 text-xs text-default-500">
        This is the only time it&apos;s shown. Save it somewhere safe before signing out.
      </p>
      <div className="mt-3 flex items-stretch gap-2">
        <div className="flex-1 min-w-0 rounded-lg border border-divider bg-content2 px-3 py-2 font-mono text-xs text-foreground break-all">
          {visible ? secret : "•".repeat(64)}
        </div>
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="inline-flex items-center justify-center rounded-lg border border-divider bg-content1 px-3 text-default-500 hover:text-foreground transition-colors"
          aria-label={visible ? "Hide key" : "Show key"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => {
              setCopied(true);
              addToast({ title: "Key copied", color: "success" });
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="inline-flex items-center justify-center rounded-lg border border-divider bg-content1 px-3 text-default-500 hover:text-foreground transition-colors"
          aria-label="Copy key"
        >
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" color="primary" radius="md" onPress={() => void onSignOut()}>
          I&apos;ve saved it — sign out
        </Button>
      </div>
    </div>
  );
}

function PodConnectionPanel() {
  const { state, userEmail, podUrl, expiresAt, refetch } = usePodPairing();
  const [isPairOpen, setIsPairOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // The dialog opens in "quick re-sign-in" mode if we have an email,
  // otherwise full email-prompt mode. Same component, parent passes
  // `defaultEmail` based on cached state.
  const openDialog = () => setIsPairOpen(true);

  async function signOut() {
    if (!confirm("Sign out of your pod?\n\nEve will keep your email so signing back in is one click. Cached marketplace data stays.")) return;
    setSigningOut(true);
    try {
      const res = await fetch("/api/auth/pod-signout", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        addToast({ title: "Signed out of pod", color: "success" });
        refetch();
      } else {
        addToast({ title: "Couldn't sign out", color: "danger" });
      }
    } catch {
      addToast({ title: "Couldn't sign out", color: "danger" });
    } finally {
      setSigningOut(false);
    }
  }

  const isPaired = state === "paired" || state === "needs-refresh";
  const isLoading = state === "loading";

  // Status pill mapping — keeps the visual identity tight.
  let statusChip: React.ReactNode;
  if (isLoading) {
    statusChip = <Chip size="sm" variant="flat" radius="sm">checking…</Chip>;
  } else if (state === "unconfigured") {
    statusChip = <Chip size="sm" color="warning" variant="flat" radius="sm">no pod URL</Chip>;
  } else if (isPaired) {
    statusChip = (
      <Chip size="sm" color="success" variant="flat" radius="sm">
        signed in
      </Chip>
    );
  } else {
    statusChip = <Chip size="sm" color="warning" variant="flat" radius="sm">not signed in</Chip>;
  }

  // Primary action: depends on state. Sign in when unpaired, sign out
  // when paired. Both share the dialog for sign-in flows.
  const primaryAction = (() => {
    if (isLoading || state === "unconfigured") return null;
    if (isPaired) {
      return (
        <Button
          size="sm"
          color="default"
          variant="flat"
          radius="md"
          startContent={<LogOut className="h-3.5 w-3.5" />}
          isLoading={signingOut}
          onPress={() => void signOut()}
        >
          Sign out of pod
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        color="primary"
        variant="solid"
        radius="md"
        startContent={
          state === "unpaired" ? (
            <LogIn className="h-3.5 w-3.5" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )
        }
        onPress={openDialog}
      >
        {state === "unpaired" && userEmail
          ? `Sign in as ${userEmail}`
          : "Sign in to pod"}
      </Button>
    );
  })();

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[260px] space-y-3">
          <Stat
            icon={<Plug className="h-3.5 w-3.5" />}
            label="Status"
            value={statusChip}
          />
          <Stat
            label="Pod URL"
            value={
              podUrl ? (
                <span className="font-mono text-xs text-foreground break-all">
                  {podUrl}
                </span>
              ) : (
                <span className="text-sm text-default-400">not configured</span>
              )
            }
          />
          <Stat
            label="Signed in as"
            value={
              userEmail ? (
                <span className="font-mono text-xs text-foreground">{userEmail}</span>
              ) : (
                <span className="text-sm text-default-400">—</span>
              )
            }
          />
          <Stat
            label="Token expires"
            value={
              expiresAt ? (
                <span className="text-xs text-foreground tabular-nums">
                  {new Date(expiresAt).toLocaleString()}
                </span>
              ) : (
                <span className="text-sm text-default-400">—</span>
              )
            }
          />
          {state === "unconfigured" && (
            <p className="text-xs text-default-500">
              Eve doesn&apos;t know which pod to talk to yet. Set a pod URL via
              the CLI (<code className="font-mono">eve setup pod</code>) or by
              editing <code className="font-mono">~/.eve/secrets.json</code>.
            </p>
          )}
          {state === "needs-refresh" && (
            <p className="text-xs text-warning">
              Your token has expired. The next pod call will auto-refresh, or
              sign in again to refresh now.
            </p>
          )}
        </div>
        {primaryAction && <div className="self-start">{primaryAction}</div>}
      </div>

      <PodPairDialog
        isOpen={isPairOpen}
        onClose={() => setIsPairOpen(false)}
        defaultEmail={userEmail}
        onSuccess={refetch}
      />
    </>
  );
}

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-12" aria-hidden />;

  const options = [
    { id: "light",  label: "Light",  Icon: Sun },
    { id: "dark",   label: "Dark",   Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ] as const;

  return (
    <div className="grid grid-cols-3 gap-2 max-w-md">
      {options.map(({ id, label, Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            className={
              "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 transition-colors " +
              (active
                ? "border-primary/60 bg-primary/5 text-primary"
                : "border-divider bg-content1 text-default-500 hover:text-foreground hover:border-default-400")
            }
            aria-pressed={active}
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
