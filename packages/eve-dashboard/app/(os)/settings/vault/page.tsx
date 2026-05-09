"use client";

/**
 * Settings → Vault
 *
 * UI surface for the pod's zero-knowledge Secrets Vault.
 * All CRUD goes through the pod user channel (/api/pod/trpc/*).
 * Crypto is client-side AES-256-GCM — plaintext never leaves the browser.
 *
 * Types, field definitions, and vault-ref helpers are shared from
 * @synap-core/types (same package the browser app and backend use).
 *
 * State machine:
 *   checking → no-vault   (master password setup)
 *            → locked      (unlock form)
 *            → unlocked    (secret list + CRUD)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Textarea,
} from "@heroui/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Key,
  KeyRound,
  Lock,
  Plus,
  Search,
  Server,
  Shield,
  Terminal,
  Trash2,
  UserCircle,
} from "lucide-react";

import {
  SECRET_TYPES,
  SECRET_TYPE_LABELS,
  SECRET_TYPE_FIELDS,
  SECRET_FIELD_LABELS,
  makeVaultReference,
  isSensitiveField,
  cleanFieldKey,
  type SecretType,
} from "@synap-core/types";

import { PodConnectGate } from "../../components/auth/PodConnectGate";
import { podTrpcFetch, PodTrpcError } from "../../inbox/lib/pod-fetch";
import {
  generateSetupParams,
  tryUnlock,
  encryptWithKey,
  decryptWithKey,
} from "./vault-crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SecretListItem {
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

interface VaultMetadata {
  salt: string;
  verificationCipher: string;
  verificationIv: string;
  verificationTag: string;
}

interface SecretDetail {
  encryptedData: string;
  iv: string;
  authTag: string;
}

// DecryptedSecret: field keys match SECRET_TYPE_FIELDS (without the ! prefix)
type DecryptedSecret = Record<string, string>;

// ─── Icons ────────────────────────────────────────────────────────────────────

function SecretIcon({ type, className }: { type: SecretType; className?: string }) {
  const cls = className ?? "h-4 w-4";
  switch (type) {
    case "password":     return <Lock className={cls} />;
    case "api_key":      return <Key className={cls} />;
    case "credential":   return <KeyRound className={cls} />;
    case "note":         return <FileText className={cls} />;
    case "card":         return <CreditCard className={cls} />;
    case "identity":     return <UserCircle className={cls} />;
    case "ssh_key":      return <Terminal className={cls} />;
    case "certificate":  return <Server className={cls} />;
    case "env_variable": return <Terminal className={cls} />;
    case "database":     return <Database className={cls} />;
    case "oauth":        return <Globe className={cls} />;
    default:             return <Key className={cls} />;
  }
}

// ─── MasterPasswordSetup ──────────────────────────────────────────────────────

function MasterPasswordSetup({ onSetup }: { onSetup: (key: CryptoKey) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [working, setWorking] = useState(false);

  const valid = password.length >= 8 && password === confirm;

  const setup = async () => {
    if (!valid) return;
    setWorking(true);
    try {
      const params = await generateSetupParams(password);
      await podTrpcFetch(
        "secretsVault.setupVault",
        {
          salt: params.salt,
          keyDerivationAlgorithm: params.keyDerivationAlgorithm,
          keyDerivationParams: params.keyDerivationParams,
          verificationCipher: params.verificationCipher,
          verificationIv: params.verificationIv,
          verificationTag: params.verificationTag,
        },
        { method: "POST" },
      );
      onSetup(params.key);
    } catch (e) {
      console.error("Vault setup failed", e);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 max-w-sm mx-auto">
      <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10">
        <Shield className="h-8 w-8 text-primary" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-base font-semibold">Create your vault</h2>
        <p className="text-sm text-foreground/55">
          Your master password encrypts secrets locally. We never see it.
        </p>
      </div>
      <div className="w-full space-y-3">
        <Input
          label="Master password"
          type={showPw ? "text" : "password"}
          value={password}
          onValueChange={setPassword}
          description="At least 8 characters"
          size="sm"
          variant="bordered"
          endContent={
            <button type="button" onClick={() => setShowPw((v) => !v)} className="text-foreground/40 hover:text-foreground">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <Input
          label="Confirm password"
          type={showPw ? "text" : "password"}
          value={confirm}
          onValueChange={setConfirm}
          isInvalid={!!confirm && confirm !== password}
          errorMessage={confirm && confirm !== password ? "Passwords don't match" : undefined}
          size="sm"
          variant="bordered"
        />
        <Button color="primary" fullWidth isDisabled={!valid} isLoading={working} onPress={() => void setup()}>
          Create vault
        </Button>
      </div>
    </div>
  );
}

// ─── VaultUnlock ──────────────────────────────────────────────────────────────

function VaultUnlock({ metadata, onUnlock }: { metadata: VaultMetadata; onUnlock: (key: CryptoKey) => void }) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [working, setWorking] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const unlock = async () => {
    if (!password) return;
    setWorking(true);
    setInvalid(false);
    try {
      const key = await tryUnlock(password, metadata);
      if (!key) { setInvalid(true); return; }
      await podTrpcFetch("secretsVault.recordUnlock", undefined, { method: "POST" });
      onUnlock(key);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 max-w-sm mx-auto">
      <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-foreground/5">
        <Lock className="h-8 w-8 text-foreground/40" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-base font-semibold">Unlock vault</h2>
        <p className="text-sm text-foreground/55">Enter your master password to access secrets.</p>
      </div>
      <div className="w-full space-y-3">
        <Input
          label="Master password"
          type={showPw ? "text" : "password"}
          value={password}
          onValueChange={(v) => { setPassword(v); setInvalid(false); }}
          isInvalid={invalid}
          errorMessage={invalid ? "Incorrect password. Check and try again." : undefined}
          size="sm"
          variant="bordered"
          onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }}
          endContent={
            <button type="button" onClick={() => setShowPw((v) => !v)} className="text-foreground/40 hover:text-foreground">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <Button color="primary" fullWidth isLoading={working} onPress={() => void unlock()}>
          Unlock
        </Button>
      </div>
    </div>
  );
}

// ─── CreateSecretModal ────────────────────────────────────────────────────────

function CreateSecretModal({
  isOpen, onClose, vaultKey, onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  vaultKey: CryptoKey;
  onCreated: () => void;
}) {
  const [type, setType] = useState<SecretType>("password");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  const currentFields = SECRET_TYPE_FIELDS[type];

  const reset = () => {
    setType("password"); setName(""); setCategory(""); setFields({});
  };

  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const create = async () => {
    if (!name.trim()) return;
    setWorking(true);
    try {
      // Build structured secret data from per-type fields
      const secretData: DecryptedSecret = {};
      for (const rawKey of currentFields) {
        const key = cleanFieldKey(rawKey);
        if (fields[key]) secretData[key] = fields[key];
      }

      const { encryptedData, iv, authTag } = await encryptWithKey(
        JSON.stringify(secretData),
        vaultKey,
      );

      // Extract url from fields if present (password/credential types have it)
      const url = fields.url?.trim() || undefined;

      await podTrpcFetch(
        "secretsVault.create",
        {
          name: name.trim(),
          type,
          url,
          category: category.trim() || undefined,
          encryptedData,
          iv,
          authTag,
        },
        { method: "POST" },
      );

      reset();
      onCreated();
      onClose();
    } catch (e) {
      console.error("Create secret failed", e);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} size="md" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="text-sm font-semibold gap-2">
          <SecretIcon type={type} className="h-4 w-4" />
          New {SECRET_TYPE_LABELS[type]}
        </ModalHeader>
        <ModalBody className="gap-3 pb-2">
          {/* Type selector */}
          <Select
            label="Type"
            selectedKeys={[type]}
            onChange={(e) => { setType(e.target.value as SecretType); setFields({}); }}
            size="sm"
            variant="bordered"
          >
            {SECRET_TYPES.map((t) => (
              <SelectItem key={t} startContent={<SecretIcon type={t} className="h-3.5 w-3.5" />}>
                {SECRET_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </Select>

          {/* Name */}
          <Input
            label="Name"
            value={name}
            onValueChange={setName}
            size="sm"
            variant="bordered"
            placeholder={`e.g. My ${SECRET_TYPE_LABELS[type]}`}
            isRequired
          />

          {/* Type-specific fields from @synap-core/types */}
          {currentFields.map((rawKey) => {
            const key = cleanFieldKey(rawKey);
            const sensitive = isSensitiveField(rawKey);
            const label = SECRET_FIELD_LABELS[key] ?? key.replace(/_/g, " ");
            const isMultiline = ["notes", "content", "privateKey", "publicKey", "certificate", "chain"].includes(key);

            if (isMultiline) {
              return (
                <Textarea
                  key={key}
                  label={label}
                  value={fields[key] ?? ""}
                  onValueChange={(v) => setField(key, v)}
                  size="sm"
                  variant="bordered"
                  minRows={3}
                />
              );
            }

            return (
              <SensitiveInput
                key={key}
                label={label}
                value={fields[key] ?? ""}
                onChange={(v) => setField(key, v)}
                sensitive={sensitive}
              />
            );
          })}

          {/* Category */}
          <Input
            label="Category (optional)"
            value={category}
            onValueChange={setCategory}
            size="sm"
            variant="bordered"
            placeholder="e.g. Work, Personal, Infrastructure"
          />
        </ModalBody>
        <ModalFooter>
          <p className="flex-1 text-[11px] text-foreground/40 flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Encrypted locally before saving
          </p>
          <Button variant="light" onPress={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            color="primary"
            isLoading={working}
            isDisabled={!name.trim()}
            onPress={() => void create()}
          >
            Save secret
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─── SensitiveInput ───────────────────────────────────────────────────────────

function SensitiveInput({
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

// ─── SecretRow ────────────────────────────────────────────────────────────────

function SecretRow({
  secret, vaultKey, onDeleted,
}: {
  secret: SecretListItem;
  vaultKey: CryptoKey;
  onDeleted: () => void;
}) {
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
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const reveal = async () => {
    if (decrypted) { setDecrypted(null); return; }
    setRevealing(true);
    try {
      const detail = await podTrpcFetch<SecretDetail>("secretsVault.get", { id: secret.id });
      const pt = await decryptWithKey(detail.encryptedData, detail.iv, detail.authTag, vaultKey);
      setDecrypted(JSON.parse(pt) as DecryptedSecret);
    } catch {
      // Silently fail — secret may have been created outside this client
    } finally {
      setRevealing(false);
    }
  };

  const del = async () => {
    setDeleting(true);
    try {
      await podTrpcFetch("secretsVault.delete", { id: secret.id }, { method: "POST" });
      onDeleted();
    } catch (e) {
      console.error("Delete failed", e);
      setDeleting(false);
    }
  };

  const toggleField = (key: string) =>
    setFieldVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="rounded-xl border border-divider overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 bg-content2/40 hover:bg-content2/70 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-foreground/40 shrink-0">
          <SecretIcon type={secret.type} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground block truncate">{secret.name}</span>
          {secret.url && (
            <span className="text-xs text-foreground/40 block truncate">{secret.url}</span>
          )}
        </span>
        <Chip size="sm" variant="flat" className="shrink-0 text-[11px]">
          {SECRET_TYPE_LABELS[secret.type]}
        </Chip>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-foreground/30 shrink-0" />
          : <ChevronDown className="h-4 w-4 text-foreground/30 shrink-0" />
        }
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 bg-content1/50 border-t border-divider">
          {secret.description && (
            <p className="text-xs text-foreground/60">{secret.description}</p>
          )}

          {/* vault:// agent reference */}
          <div>
            <p className="text-[10px] text-foreground/40 mb-1.5 uppercase tracking-wide font-medium">
              Agent reference
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-foreground/55 bg-content2/60 rounded-lg px-3 py-1.5 truncate">
                {vaultRef}
              </code>
              <Button size="sm" variant="flat" isIconOnly radius="md" onPress={() => void copy(vaultRef, "ref")} aria-label="Copy vault reference">
                {copied === "ref" ? <Check className="h-3.5 w-3.5 text-success" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Reveal / structured fields */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="flat" radius="md" isLoading={revealing} onPress={() => void reveal()}
              startContent={!revealing ? (decrypted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />) : undefined}
            >
              {decrypted ? "Hide fields" : "Reveal fields"}
            </Button>
          </div>

          {/* Structured field display using SECRET_TYPE_FIELDS */}
          {decrypted && (
            <div className="space-y-2 rounded-xl border border-divider overflow-hidden">
              {typeFields.map((rawKey) => {
                const key = cleanFieldKey(rawKey);
                const sensitive = isSensitiveField(rawKey);
                const label = SECRET_FIELD_LABELS[key] ?? key.replace(/_/g, " ");
                const val = decrypted[key];
                if (!val) return null;
                const visible = fieldVisibility[key] ?? false;
                const display = sensitive && !visible ? "••••••••••••" : val;

                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 bg-content2/40 border-b border-divider last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-foreground/40 uppercase tracking-wide">{label}</p>
                      <p className="text-xs font-mono text-foreground/80 truncate">{display}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {sensitive && (
                        <Button size="sm" variant="light" isIconOnly radius="md" onPress={() => toggleField(key)} aria-label={visible ? "Hide" : "Show"}>
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

          {/* Delete */}
          <div className="flex justify-end pt-1 border-t border-divider">
            <Button size="sm" variant="light" color="danger" radius="md" isLoading={deleting}
              onPress={() => void del()}
              startContent={!deleting ? <Trash2 className="h-3.5 w-3.5" /> : undefined}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VaultContent ─────────────────────────────────────────────────────────────

function VaultContent({ vaultKey, onLock }: { vaultKey: CryptoKey; onLock: () => void }) {
  const [secrets, setSecrets] = useState<SecretListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<SecretType | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await podTrpcFetch<SecretListItem[]>(
        "secretsVault.list",
        typeFilter ? { type: typeFilter } : undefined,
      );
      setSecrets(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = search.trim()
    ? secrets.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.url?.toLowerCase().includes(search.toLowerCase()),
      )
    : secrets;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          variant="bordered"
          placeholder="Search secrets…"
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="h-3.5 w-3.5 text-foreground/30" />}
          className="flex-1"
          isClearable
          onClear={() => setSearch("")}
        />
        <Button size="sm" variant="flat" onPress={onLock} startContent={<Lock className="h-3.5 w-3.5" />}>
          Lock
        </Button>
        <Button size="sm" color="primary" onPress={() => setShowCreate(true)} startContent={<Plus className="h-3.5 w-3.5" />}>
          Add secret
        </Button>
      </div>

      {/* Type filter — uses SECRET_TYPES from @synap-core/types */}
      <div className="flex flex-wrap gap-1.5">
        <Chip
          size="sm"
          variant={typeFilter === null ? "solid" : "flat"}
          color={typeFilter === null ? "primary" : "default"}
          className="cursor-pointer"
          onClick={() => setTypeFilter(null)}
        >
          All
        </Chip>
        {SECRET_TYPES.map((t) => (
          <Chip
            key={t}
            size="sm"
            variant={typeFilter === t ? "solid" : "flat"}
            color={typeFilter === t ? "primary" : "default"}
            className="cursor-pointer"
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          >
            {SECRET_TYPE_LABELS[t]}
          </Chip>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner size="sm" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <Shield className="h-8 w-8 text-foreground/20" />
          <p className="text-sm text-foreground/40">
            {search.trim() ? "No secrets match your search" : "No secrets yet"}
          </p>
          {!search.trim() && (
            <p className="text-xs text-foreground/30">Add your first secret to get started.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <SecretRow key={s.id} secret={s} vaultKey={vaultKey} onDeleted={() => void load()} />
          ))}
        </div>
      )}

      <CreateSecretModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        vaultKey={vaultKey}
        onCreated={() => void load()}
      />
    </div>
  );
}

// ─── VaultApp (state machine) ─────────────────────────────────────────────────

type VaultState = "checking" | "no-vault" | "locked" | "unlocked";

function VaultApp() {
  const [state, setState] = useState<VaultState>("checking");
  const [metadata, setMetadata] = useState<VaultMetadata | null>(null);
  const vaultKeyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const hasVault = await podTrpcFetch<boolean>("secretsVault.hasVault");
        if (!hasVault) { setState("no-vault"); return; }
        const meta = await podTrpcFetch<VaultMetadata>("secretsVault.getVaultMetadata");
        setMetadata(meta);
        setState("locked");
      } catch {
        setState("no-vault");
      }
    })();
  }, []);

  const handleSetup = (key: CryptoKey) => {
    vaultKeyRef.current = key;
    void podTrpcFetch<VaultMetadata>("secretsVault.getVaultMetadata").then(setMetadata).catch(() => null);
    setState("unlocked");
  };

  const handleUnlock = (key: CryptoKey) => {
    vaultKeyRef.current = key;
    setState("unlocked");
  };

  const handleLock = () => {
    vaultKeyRef.current = null;
    setState(metadata ? "locked" : "no-vault");
  };

  if (state === "checking") {
    return <div className="flex justify-center py-16"><Spinner size="sm" /></div>;
  }
  if (state === "no-vault") {
    return <MasterPasswordSetup onSetup={handleSetup} />;
  }
  if (state === "locked" && metadata) {
    return <VaultUnlock metadata={metadata} onUnlock={handleUnlock} />;
  }
  if (state === "unlocked" && vaultKeyRef.current) {
    return <VaultContent vaultKey={vaultKeyRef.current} onLock={handleLock} />;
  }
  return <div className="flex justify-center py-16"><Spinner size="sm" /></div>;
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function VaultPage() {
  return (
    <PodConnectGate>
      <VaultApp />
    </PodConnectGate>
  );
}
