"use client";

/**
 * Stalwart Mail config panel — embedded as the Config tab in the component
 * drawer when the selected component is `stalwart`.
 *
 * Sections:
 *  - Header: mail domain + admin console link + live/down badge
 *  - Domains: list + add-domain inline form
 *  - Accounts/Mailboxes: list + add-mailbox form
 *  - Deliverability hint: DKIM/SPF/DMARC + PTR callout linking to `eve doctor`
 */

import { useEffect, useState, useCallback } from "react";
import { Input, Button, Spinner, Chip, addToast } from "@heroui/react";
import {
  Mail, Globe, Plus, ExternalLink, User, AlertTriangle, Copy, Check,
} from "lucide-react";
import type { StalwartPrincipal } from "@eve/mouth";

interface StatusData {
  domain: string | null;
  live: boolean;
}

export function StalwartConfigPanel() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/components/stalwart/status", { credentials: "include" });
        if (res.ok) setStatus(await res.json());
      } catch {
        // ignore — badge will show "down"
      } finally {
        setStatusLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <HeaderCard status={status} loading={statusLoading} />
      <DomainsSection />
      <AccountsSection domain={status?.domain ?? null} />
      <DeliverabilityHint />
    </div>
  );
}

function HeaderCard({ status, loading }: { status: StatusData | null; loading: boolean }) {
  const domain = status?.domain;
  const adminUrl = domain ? `https://mail.${domain}/admin` : null;

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Mail className="h-3.5 w-3.5" />
          <span>Stalwart Mail</span>
        </div>
        {loading ? (
          <Spinner size="sm" />
        ) : (
          <Chip
            size="sm"
            variant="flat"
            radius="sm"
            color={status?.live ? "success" : "danger"}
          >
            {status?.live ? "live" : "down"}
          </Chip>
        )}
      </div>

      {domain ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-default-400 mb-0.5">
              Mail domain
            </p>
            <code className="font-mono text-xs text-foreground">{domain}</code>
          </div>
          {adminUrl && (
            <Button
              as="a"
              href={adminUrl}
              target="_blank"
              rel="noreferrer"
              size="sm"
              variant="bordered"
              radius="md"
              startContent={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Admin console
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-default-500">
          Mail domain not configured. Run <code className="font-mono">eve add stalwart</code> to provision.
        </p>
      )}
    </div>
  );
}

function DomainsSection() {
  const [domains, setDomains] = useState<StalwartPrincipal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/components/stalwart/domains", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { domains: StalwartPrincipal[] };
        setDomains(data.domains);
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setError(err.error ?? "Failed to load domains");
      }
    } catch {
      setError("Failed to load domains");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDomains(); }, [fetchDomains]);

  const onAdd = useCallback(async () => {
    if (!name.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/components/stalwart/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        addToast({ title: `Domain "${name.trim()}" created`, color: "success" });
        setName("");
        void fetchDomains();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't create domain", color: "danger" });
      }
    } catch {
      addToast({ title: "Couldn't create domain", color: "danger" });
    } finally { setAdding(false); }
  }, [name, fetchDomains]);

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
        <Globe className="h-3.5 w-3.5" />
        <span>Domains</span>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            size="sm"
            variant="bordered"
            label="New domain"
            labelPlacement="outside"
            placeholder="example.com"
            value={name}
            onValueChange={(v) => { setName(v); setError(null); }}
            isDisabled={adding}
            onKeyDown={(e) => { if (e.key === "Enter") void onAdd(); }}
          />
        </div>
        <Button
          size="sm"
          color="primary"
          radius="md"
          startContent={<Plus className="h-3.5 w-3.5" />}
          isLoading={adding}
          isDisabled={!name.trim()}
          onPress={() => void onAdd()}
          className="mb-[1px]"
        >
          Add
        </Button>
      </div>

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner size="sm" color="primary" />
        </div>
      ) : !domains || domains.length === 0 ? (
        <div className="rounded-md border border-divider bg-content1 px-4 py-5 text-center">
          <Globe className="h-4 w-4 mx-auto mb-1.5 text-default-400" />
          <p className="text-xs text-default-500">No domains yet — add one above.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-divider">
          {domains.map((d, i) => (
            <PrincipalRow key={d.name} label={d.name} copyValue={d.name} ariaLabel="Copy domain name" isFirst={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountsSection({ domain }: { domain: string | null }) {
  const [accounts, setAccounts] = useState<StalwartPrincipal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/components/stalwart/accounts", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { accounts: StalwartPrincipal[] };
        setAccounts(data.accounts);
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setError(err.error ?? "Failed to load accounts");
      }
    } catch {
      setError("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  const onAdd = useCallback(async () => {
    if (!email.trim() || !password) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/components/stalwart/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          password,
          description: description.trim() || undefined,
        }),
      });
      if (res.ok) {
        addToast({ title: `Mailbox "${email.trim()}" created`, color: "success" });
        setEmail("");
        setPassword("");
        setDescription("");
        void fetchAccounts();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't create mailbox", color: "danger" });
      }
    } catch {
      addToast({ title: "Couldn't create mailbox", color: "danger" });
    } finally { setAdding(false); }
  }, [email, password, description, fetchAccounts]);

  const emailPlaceholder = domain ? `alice@${domain}` : "alice@example.com";

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
        <User className="h-3.5 w-3.5" />
        <span>Mailboxes</span>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            size="sm"
            variant="bordered"
            label="Email"
            labelPlacement="outside"
            placeholder={emailPlaceholder}
            type="email"
            value={email}
            onValueChange={(v) => { setEmail(v); setError(null); }}
            isDisabled={adding}
          />
          <Input
            size="sm"
            variant="bordered"
            label="Initial password"
            labelPlacement="outside"
            type="password"
            placeholder="•••••••••"
            value={password}
            onValueChange={setPassword}
            isDisabled={adding}
            onKeyDown={(e) => { if (e.key === "Enter") void onAdd(); }}
          />
        </div>
        <Input
          size="sm"
          variant="bordered"
          label="Description"
          labelPlacement="outside"
          placeholder="Alice Smith (optional)"
          value={description}
          onValueChange={setDescription}
          isDisabled={adding}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            radius="md"
            startContent={<Plus className="h-3.5 w-3.5" />}
            isLoading={adding}
            isDisabled={!email.trim() || !password}
            onPress={() => void onAdd()}
          >
            Add mailbox
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner size="sm" color="primary" />
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="rounded-md border border-divider bg-content1 px-4 py-5 text-center">
          <User className="h-4 w-4 mx-auto mb-1.5 text-default-400" />
          <p className="text-xs text-default-500">No mailboxes yet — add one above.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-divider">
          {accounts.map((a, i) => (
            <PrincipalRow
              key={a.name}
              label={a.name}
              sublabel={a.description}
              copyValue={a.name}
              ariaLabel="Copy email address"
              isFirst={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single principal row (domain or mailbox) with a hover copy affordance. */
function PrincipalRow({
  label, sublabel, copyValue, ariaLabel, isFirst,
}: {
  label: string;
  sublabel?: string;
  copyValue: string;
  ariaLabel: string;
  isFirst: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    await navigator.clipboard.writeText(copyValue).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [copyValue]);

  return (
    <div
      className={
        "group flex items-center gap-3 px-3 py-2.5 " +
        (isFirst ? "" : "border-t border-divider")
      }
    >
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm text-foreground truncate block">{label}</span>
        {sublabel && (
          <p className="text-xs text-default-500 truncate mt-0.5">{sublabel}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={ariaLabel}
        className={
          "flex h-7 w-7 items-center justify-center rounded-md " +
          "text-default-400 transition-colors transition-opacity duration-150 " +
          "hover:bg-content3 hover:text-foreground " +
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 " +
          "active:scale-[0.96]"
        }
      >
        {copied
          ? <Check className="h-3.5 w-3.5 text-success" />
          : <Copy className="h-3.5 w-3.5" />
        }
      </button>
    </div>
  );
}

function DeliverabilityHint() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-warning-600 dark:text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Deliverability checklist</span>
      </div>
      <p className="text-xs text-default-600 leading-relaxed">
        For mail to reach inboxes, publish <strong>SPF</strong>, <strong>DKIM</strong>, and{" "}
        <strong>DMARC</strong> DNS records for your domain, and set a{" "}
        <strong>PTR (reverse DNS)</strong> record at your VPS provider pointing your server IP
        back to your mail hostname.
      </p>
      <p className="text-xs text-default-500">
        Run{" "}
        <code className="font-mono text-xs bg-content2 border border-divider rounded px-1 py-0.5">
          eve doctor
        </code>{" "}
        to check your DNS configuration and see exactly which records are missing.
      </p>
    </div>
  );
}
