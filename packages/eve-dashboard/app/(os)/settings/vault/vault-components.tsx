"use client";

/**
 * Shared vault UI components — used by both the Settings vault page and
 * the VaultPermissionOverlay.
 *
 * The vault is SERVER-SIDE encrypted: there is no client master password, no
 * unlock ceremony, and no client-side crypto. Secrets are created/updated with
 * a plaintext `value` (the pod encrypts before storage) and read back via
 * `reveal` (the pod decrypts, owner-only, and audit-logs each read). The vault
 * is available as soon as the pod is connected.
 */

import { useCallback, useEffect, useState } from "react";

import {
  Button, Chip, Input, Modal, ModalBody, ModalContent,
  ModalFooter, ModalHeader, Select, SelectItem, Spinner, Textarea,
} from "@heroui/react";
import {
  Check, ChevronDown, ChevronUp, ClipboardCopy, Copy,
  CreditCard, Database, Eye, EyeOff, FileText, Globe,
  Key, KeyRound, Lock, Plus, Search, Shield,
  Terminal, Trash2, UserCircle,
} from "lucide-react";
import {
  SECRET_TYPES, SECRET_TYPE_LABELS, SECRET_TYPE_FIELDS,
  SECRET_FIELD_LABELS, makeVaultReference, isSensitiveField,
  cleanFieldKey, type SecretType,
} from "@synap-core/types";
import { podTrpcFetch } from "@/lib/pod-fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecretListItem {
  id: string;
  name: string;
  type: SecretType;
  url?: string | null;
  category?: string | null;
  description?: string | null;
  isFavorite?: boolean;
  createdAt?: string;
  tags?: string[];
}

export type DecryptedSecret = Record<string, string>;

// ─── SecretIcon ───────────────────────────────────────────────────────────────

export function SecretIcon({ type, className }: { type: SecretType; className?: string }) {
  const cls = className ?? "h-4 w-4";
  switch (type) {
    case "password":     return <Lock className={cls} />;
    case "api_key":      return <Key className={cls} />;
    case "credential":   return <KeyRound className={cls} />;
    case "note":         return <FileText className={cls} />;
    case "card":         return <CreditCard className={cls} />;
    case "identity":     return <UserCircle className={cls} />;
    case "ssh_key":      return <Terminal className={cls} />;
    case "certificate":  return <Shield className={cls} />;
    case "env_variable": return <Terminal className={cls} />;
    case "database":     return <Database className={cls} />;
    case "oauth":        return <Globe className={cls} />;
    default:             return <Key className={cls} />;
  }
}

// ─── SensitiveInput ───────────────────────────────────────────────────────────

export function SensitiveInput({
  label, value, onChange, sensitive,
}: { label: string; value: string; onChange: (v: string) => void; sensitive: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      label={label}
      type={sensitive && !show ? "password" : "text"}
      value={value}
      onValueChange={onChange}
      size="sm"
      variant="bordered"
      endContent={
        sensitive ? (
          <button type="button" onClick={() => setShow((v) => !v)} className="text-foreground/40 hover:text-foreground">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : undefined
      }
    />
  );
}

// ─── CreateSecretModal ────────────────────────────────────────────────────────

export function CreateSecretModal({
  isOpen, onClose, onCreated,
}: { isOpen: boolean; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<SecretType>("password");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const currentFields = SECRET_TYPE_FIELDS[type];

  const reset = () => { setType("password"); setName(""); setCategory(""); setFields({}); };
  const setField = (key: string, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  const create = async () => {
    if (!name.trim()) return;
    setWorking(true);
    try {
      const secretData: DecryptedSecret = {};
      for (const rawKey of currentFields) {
        const key = cleanFieldKey(rawKey);
        if (fields[key]) secretData[key] = fields[key];
      }
      // Plaintext value — the pod server-encrypts it before storage.
      await podTrpcFetch("secretsVault.create", {
        name: name.trim(), type, url: fields.url?.trim() || undefined,
        category: category.trim() || undefined, value: secretData,
      }, { method: "POST", workspaceId: null });
      reset(); onCreated(); onClose();
    } catch (e) { console.error("Create secret failed", e); }
    finally { setWorking(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} size="md" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="text-sm font-semibold gap-2">
          <SecretIcon type={type} className="h-4 w-4" /> New {SECRET_TYPE_LABELS[type]}
        </ModalHeader>
        <ModalBody className="gap-3 pb-2">
          <Select label="Type" selectedKeys={[type]} onChange={(e) => { setType(e.target.value as SecretType); setFields({}); }} size="sm" variant="bordered">
            {SECRET_TYPES.map((t) => (
              <SelectItem key={t} startContent={<SecretIcon type={t} className="h-3.5 w-3.5" />}>{SECRET_TYPE_LABELS[t]}</SelectItem>
            ))}
          </Select>
          <Input label="Name" value={name} onValueChange={setName} size="sm" variant="bordered" placeholder={`e.g. My ${SECRET_TYPE_LABELS[type]}`} isRequired />
          {currentFields.map((rawKey) => {
            const key = cleanFieldKey(rawKey);
            const sensitive = isSensitiveField(rawKey);
            const label = SECRET_FIELD_LABELS[key] ?? key.replace(/_/g, " ");
            const isMultiline = ["notes", "content", "privateKey", "publicKey", "certificate", "chain"].includes(key);
            return isMultiline ? (
              <Textarea key={key} label={label} value={fields[key] ?? ""} onValueChange={(v) => setField(key, v)} size="sm" variant="bordered" minRows={3} />
            ) : (
              <SensitiveInput key={key} label={label} value={fields[key] ?? ""} onChange={(v) => setField(key, v)} sensitive={sensitive} />
            );
          })}
          <Input label="Category (optional)" value={category} onValueChange={setCategory} size="sm" variant="bordered" placeholder="e.g. Work, Personal" />
        </ModalBody>
        <ModalFooter>
          <p className="flex-1 text-[11px] text-foreground/40 flex items-center gap-1"><Lock className="h-3 w-3" /> Encrypted on your pod</p>
          <Button variant="light" onPress={() => { reset(); onClose(); }}>Cancel</Button>
          <Button color="primary" isLoading={working} isDisabled={!name.trim()} onPress={() => void create()}>Save secret</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─── SecretRow ────────────────────────────────────────────────────────────────

export interface SecretRowProps {
  secret: SecretListItem;
  onDeleted: () => void;
  /** When set, renders a "Share reference" CTA instead of delete. */
  onSelectRef?: (vaultRef: string) => void;
}

export function SecretRow({ secret, onDeleted, onSelectRef }: SecretRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [decrypted, setDecrypted] = useState<DecryptedSecret | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const vaultRef = makeVaultReference(secret.id);
  const typeFields = SECRET_TYPE_FIELDS[secret.type] ?? [];

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 1500);
  };

  const reveal = async () => {
    if (decrypted) { setDecrypted(null); return; }
    setRevealing(true);
    try {
      // Owner-only server-side reveal (the pod decrypts + audit-logs the read).
      const detail = await podTrpcFetch<{ value: unknown }>("secretsVault.reveal", { id: secret.id }, { method: "POST", workspaceId: null });
      const raw = detail?.value;
      let map: DecryptedSecret = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        map = raw as DecryptedSecret;
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw) as unknown;
          map = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as DecryptedSecret)
            : { content: raw };
        } catch { map = { content: raw }; }
      }
      setDecrypted(map);
    } catch { /* silent */ }
    finally { setRevealing(false); }
  };

  const del = async () => {
    setDeleting(true);
    try { await podTrpcFetch("secretsVault.delete", { id: secret.id }, { method: "POST", workspaceId: null }); onDeleted(); }
    catch (e) { console.error("Delete failed", e); setDeleting(false); }
  };

  return (
    <div className="rounded-xl border border-divider overflow-hidden">
      <button type="button" className="w-full flex items-center gap-3 px-4 py-3 bg-content2/40 hover:bg-content2/70 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}>
        <span className="text-foreground/40 shrink-0"><SecretIcon type={secret.type} /></span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground block truncate">{secret.name}</span>
          {secret.url && <span className="text-xs text-foreground/40 block truncate">{secret.url}</span>}
        </span>
        <Chip size="sm" variant="flat" className="shrink-0 text-[11px]">{SECRET_TYPE_LABELS[secret.type]}</Chip>
        {expanded ? <ChevronUp className="h-4 w-4 text-foreground/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-foreground/30 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 bg-content1/50 border-t border-divider">
          {secret.description && <p className="text-xs text-foreground/60">{secret.description}</p>}

          <div>
            <p className="text-[10px] text-foreground/40 mb-1.5 uppercase tracking-wide font-medium">Agent reference</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-foreground/55 bg-content2/60 rounded-lg px-3 py-1.5 truncate">{vaultRef}</code>
              <Button size="sm" variant="flat" isIconOnly radius="md" onPress={() => void copy(vaultRef, "ref")} aria-label="Copy vault reference">
                {copied === "ref" ? <Check className="h-3.5 w-3.5 text-success" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
              </Button>
              {onSelectRef && (
                <Button size="sm" color="primary" radius="md" onPress={() => onSelectRef(vaultRef)}>Share ref</Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="flat" radius="md" isLoading={revealing} onPress={() => void reveal()}
              startContent={!revealing ? (decrypted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />) : undefined}>
              {decrypted ? "Hide fields" : "Reveal fields"}
            </Button>
          </div>

          {decrypted && (
            <div className="space-y-2 rounded-xl border border-divider overflow-hidden">
              {typeFields.map((rawKey) => {
                const key = cleanFieldKey(rawKey);
                const sensitive = isSensitiveField(rawKey);
                const label = SECRET_FIELD_LABELS[key] ?? key.replace(/_/g, " ");
                const val = decrypted[key];
                if (!val) return null;
                const visible = fieldVisibility[key] ?? false;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 bg-content2/40 border-b border-divider last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-foreground/40 uppercase tracking-wide">{label}</p>
                      <p className="text-xs font-mono text-foreground/80 truncate">{sensitive && !visible ? "••••••••••••" : val}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {sensitive && (
                        <Button size="sm" variant="light" isIconOnly radius="md"
                          onPress={() => setFieldVisibility((p) => ({ ...p, [key]: !p[key] }))} aria-label={visible ? "Hide" : "Show"}>
                          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                      )}
                      <Button size="sm" variant="light" isIconOnly radius="md" onPress={() => void copy(val, key)} aria-label={`Copy ${label}`}>
                        {copied === key ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!onSelectRef && (
            <div className="flex justify-end pt-1 border-t border-divider">
              <Button size="sm" variant="light" color="danger" radius="md" isLoading={deleting}
                onPress={() => void del()} startContent={!deleting ? <Trash2 className="h-3.5 w-3.5" /> : undefined}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── VaultContent ─────────────────────────────────────────────────────────────

export interface VaultContentProps {
  /** When set, renders in "picker" mode — secrets show a "Share ref" CTA. */
  onSelectRef?: (vaultRef: string) => void;
}

export function VaultContent({ onSelectRef }: VaultContentProps) {
  const [secrets, setSecrets] = useState<SecretListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<SecretType | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await podTrpcFetch<SecretListItem[]>("secretsVault.list", typeFilter ? { type: typeFilter } : undefined, { workspaceId: null });
      setSecrets(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = search.trim()
    ? secrets.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.url?.toLowerCase().includes(search.toLowerCase()))
    : secrets;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input size="sm" variant="bordered" placeholder="Search secrets…" value={search} onValueChange={setSearch}
          startContent={<Search className="h-3.5 w-3.5 text-foreground/30" />} className="flex-1" isClearable onClear={() => setSearch("")} />
        {!onSelectRef && (
          <Button size="sm" color="primary" onPress={() => setShowCreate(true)} startContent={<Plus className="h-3.5 w-3.5" />}>Add</Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Chip size="sm" variant={typeFilter === null ? "solid" : "flat"} color={typeFilter === null ? "primary" : "default"}
          className="cursor-pointer" onClick={() => setTypeFilter(null)}>All</Chip>
        {SECRET_TYPES.map((t) => (
          <Chip key={t} size="sm" variant={typeFilter === t ? "solid" : "flat"} color={typeFilter === t ? "primary" : "default"}
            className="cursor-pointer" onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
            {SECRET_TYPE_LABELS[t]}
          </Chip>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner size="sm" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <Shield className="h-8 w-8 text-foreground/20" />
          <p className="text-sm text-foreground/40">{search.trim() ? "No secrets match your search" : "No secrets yet"}</p>
          {!search.trim() && <p className="text-xs text-foreground/30">Add your first secret to get started.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <SecretRow key={s.id} secret={s} onDeleted={() => void load()} onSelectRef={onSelectRef} />
          ))}
        </div>
      )}

      <CreateSecretModal isOpen={showCreate} onClose={() => setShowCreate(false)} onCreated={() => void load()} />
    </div>
  );
}

// ─── VaultApp ─────────────────────────────────────────────────────────────────

export interface VaultAppProps {
  onSelectRef?: (vaultRef: string) => void;
}

/**
 * The vault is server-side encrypted, so there is no setup/unlock/lock state
 * machine — it is available as soon as the pod is connected. This is now a thin
 * wrapper over `VaultContent`, preserved as the stable entry point for the
 * settings page and the permission overlay.
 */
export function VaultApp({ onSelectRef }: VaultAppProps = {}) {
  return <VaultContent onSelectRef={onSelectRef} />;
}
