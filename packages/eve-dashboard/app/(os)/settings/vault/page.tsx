"use client";

/**
 * Settings → Vault
 *
 * Zero-knowledge secret manager surfaced inside Eve OS.
 * All CRUD calls go through the pod user channel (/api/pod/trpc/*).
 * Client-side AES-256-GCM encryption: plaintext never leaves the browser.
 *
 * State machine:
 *   checking → no-vault   (setup form)
 *            → locked      (unlock form)
 *            → unlocked    (secret list + CRUD)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
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
  Chip,
  addToast,
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
} from "lucide-react";

import { PodConnectGate } from "../../components/auth/PodConnectGate";
import {
  podTrpcFetch,
  PodTrpcError,
} from "../../inbox/lib/pod-fetch";
import {
  generateSetupParams,
  tryUnlock,
  encryptWithKey,
  decryptWithKey,
} from "./vault-crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

type SecretType =
  | "password"
  | "api_key"
  | "credential"
  | "note"
  | "card"
  | "identity"
  | "ssh_key"
  | "certificate"
  | "env_variable"
  | "database"
  | "oauth";

interface SecretListItem {
  id: string;
  name: string;
  type: SecretType;
  url?: string | null;
  category?: string | null;
  description?: string | null;
  isFavorite?: boolean;
  passwordStrength?: number | null;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_SECRET_TYPES: SecretType[] = [
  "password", "api_key", "credential", "note", "card",
  "identity", "ssh_key", "certificate", "env_variable", "database", "oauth",
];

const SECRET_LABELS: Record<SecretType, string> = {
  password: "Password",
  api_key: "API Key",
  credential: "Credential",
  note: "Note",
  card: "Card",
  identity: "Identity",
  ssh_key: "SSH Key",
  certificate: "Certificate",
  env_variable: "Env Var",
  database: "Database",
  oauth: "OAuth",
};

type ChipColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";

const SECRET_COLORS: Record<SecretType, ChipColor> = {
  password: "primary",
  api_key: "success",
  credential: "warning",
  note: "default",
  card: "danger",
  identity: "secondary",
  ssh_key: "primary",
  certificate: "success",
  env_variable: "warning",
  database: "danger",
  oauth: "secondary",
};

function SecretIcon({ type, className }: { type: SecretType; className?: string }) {
  const cls = className ?? "h-4 w-4";
  switch (type) {
    case "password":     return <Lock className={cls} />;
    case "api_key":      return <Key className={cls} />;
    case "credential":   return <KeyRound className={cls} />;
    case "note":         return <FileText className={cls} />;
    case "card":         return <CreditCard className={cls} />;
    case "identity":     return <Shield className={cls} />;
    case "ssh_key":      return <Terminal className={cls} />;
    case "certificate":  return <Server className={cls} />;
    case "env_variable": return <Terminal className={cls} />;
    case "database":     return <Database className={cls} />;
    case "oauth":        return <Globe className={cls} />;
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
      addToast({ title: "Vault created", color: "success" });
      onSetup(params.key);
    } catch (e) {
      addToast({
        title: e instanceof PodTrpcError ? e.message : "Failed to create vault",
        color: "danger",
      });
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
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="text-foreground/40 hover:text-foreground"
            >
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
        <Button
          color="primary"
          fullWidth
          isDisabled={!valid}
          isLoading={working}
          onPress={() => void setup()}
        >
          Create vault
        </Button>
      </div>
    </div>
  );
}

// ─── VaultUnlock ──────────────────────────────────────────────────────────────

function VaultUnlock({
  metadata,
  onUnlock,
}: {
  metadata: VaultMetadata;
  onUnlock: (key: CryptoKey) => void;
}) {
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
      if (!key) {
        setInvalid(true);
        return;
      }
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
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="text-foreground/40 hover:text-foreground"
            >
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
  isOpen,
  onClose,
  vaultKey,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  vaultKey: CryptoKey;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<SecretType>("password");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setName(""); setType("password"); setUrl(""); setDescription(""); setSecretValue("");
  };

  const create = async () => {
    if (!name.trim() || !secretValue) return;
    setWorking(true);
    try {
      const { encryptedData, iv, authTag } = await encryptWithKey(
        JSON.stringify({ value: secretValue }),
        vaultKey,
      );
      await podTrpcFetch(
        "secretsVault.create",
        {
          name: name.trim(),
          type,
          url: url.trim() || undefined,
          description: description.trim() || undefined,
          encryptedData,
          iv,
          authTag,
        },
        { method: "POST" },
      );
      addToast({ title: "Secret saved", color: "success" });
      reset();
      onCreated();
      onClose();
    } catch (e) {
      addToast({
        title: e instanceof PodTrpcError ? e.message : "Failed to save secret",
        color: "danger",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { reset(); onClose(); }}
      size="md"
    >
      <ModalContent>
        <ModalHeader className="text-sm font-semibold">Add secret</ModalHeader>
        <ModalBody className="gap-3 pb-2">
          <Input
            label="Name"
            value={name}
            onValueChange={setName}
            size="sm"
            variant="bordered"
            placeholder="e.g. GitHub Personal Access Token"
          />
          <Select
            label="Type"
            selectedKeys={[type]}
            onChange={(e) => setType(e.target.value as SecretType)}
            size="sm"
            variant="bordered"
          >
            {ALL_SECRET_TYPES.map((t) => (
              <SelectItem key={t}>{SECRET_LABELS[t]}</SelectItem>
            ))}
          </Select>
          <Input
            label="Secret value"
            type={showValue ? "text" : "password"}
            value={secretValue}
            onValueChange={setSecretValue}
            size="sm"
            variant="bordered"
            placeholder="Encrypted locally before sending"
            endContent={
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="text-foreground/40 hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          <Input
            label="URL (optional)"
            value={url}
            onValueChange={setUrl}
            size="sm"
            variant="bordered"
            placeholder="https://…"
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onValueChange={setDescription}
            size="sm"
            variant="bordered"
            minRows={2}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            color="primary"
            isLoading={working}
            isDisabled={!name.trim() || !secretValue}
            onPress={() => void create()}
          >
            Save secret
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─── SecretRow ────────────────────────────────────────────────────────────────

function SecretRow({
  secret,
  vaultKey,
  onDeleted,
}: {
  secret: SecretListItem;
  vaultKey: CryptoKey;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState<"ref" | "value" | null>(null);

  const vaultRef = `vault://${secret.id}`;

  const copy = async (text: string, kind: "ref" | "value") => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const reveal = async () => {
    if (decrypted !== null) { setDecrypted(null); return; }
    setRevealing(true);
    try {
      const detail = await podTrpcFetch<SecretDetail>(
        "secretsVault.get",
        { id: secret.id },
      );
      const pt = await decryptWithKey(
        detail.encryptedData,
        detail.iv,
        detail.authTag,
        vaultKey,
      );
      const parsed = JSON.parse(pt) as { value?: string };
      setDecrypted(parsed.value ?? pt);
    } catch {
      addToast({
        title: "Could not decrypt. Confirm this secret was created with your current master password.",
        color: "danger",
      });
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
      addToast({
        title: e instanceof PodTrpcError ? e.message : "Delete failed",
        color: "danger",
      });
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-divider overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 bg-content2/40 hover:bg-content2/70 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-foreground/40 shrink-0">
          <SecretIcon type={secret.type} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground block truncate">
            {secret.name}
          </span>
          {secret.url && (
            <span className="text-xs text-foreground/40 block truncate">{secret.url}</span>
          )}
        </span>
        <Chip size="sm" color={SECRET_COLORS[secret.type]} variant="flat" className="shrink-0">
          {SECRET_LABELS[secret.type]}
        </Chip>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-foreground/30 shrink-0" />
          : <ChevronDown className="h-4 w-4 text-foreground/30 shrink-0" />
        }
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 bg-content1/50 border-t border-divider">
          {secret.description && (
            <p className="text-xs text-foreground/60">{secret.description}</p>
          )}

          {/* vault:// reference */}
          <div>
            <p className="text-[11px] text-foreground/40 mb-1.5 uppercase tracking-wide font-medium">
              Agent reference
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-foreground/60 bg-content2/60 rounded-lg px-3 py-2 truncate">
                {vaultRef}
              </code>
              <Button
                size="sm"
                variant="flat"
                isIconOnly
                radius="md"
                onPress={() => void copy(vaultRef, "ref")}
                aria-label="Copy vault reference"
              >
                {copied === "ref"
                  ? <Check className="h-3.5 w-3.5 text-success" />
                  : <ClipboardCopy className="h-3.5 w-3.5" />
                }
              </Button>
            </div>
          </div>

          {/* Reveal / copy value */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="flat"
              radius="md"
              isLoading={revealing}
              onPress={() => void reveal()}
              startContent={
                !revealing
                  ? decrypted !== null
                    ? <EyeOff className="h-3.5 w-3.5" />
                    : <Eye className="h-3.5 w-3.5" />
                  : undefined
              }
            >
              {decrypted !== null ? "Hide" : "Reveal secret"}
            </Button>
            {decrypted !== null && (
              <Button
                size="sm"
                variant="flat"
                isIconOnly
                radius="md"
                onPress={() => void copy(decrypted, "value")}
                aria-label="Copy secret value"
              >
                {copied === "value"
                  ? <Check className="h-3.5 w-3.5 text-success" />
                  : <Copy className="h-3.5 w-3.5" />
                }
              </Button>
            )}
          </div>

          {decrypted !== null && (
            <div className="rounded-lg bg-content2/60 border border-divider px-3 py-2">
              <p className="text-xs font-mono text-foreground/80 break-all select-all">
                {decrypted}
              </p>
            </div>
          )}

          <div className="flex justify-end pt-1 border-t border-divider">
            <Button
              size="sm"
              variant="light"
              color="danger"
              radius="md"
              isLoading={deleting}
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

function VaultContent({
  vaultKey,
  onLock,
}: {
  vaultKey: CryptoKey;
  onLock: () => void;
}) {
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
        <Button
          size="sm"
          variant="flat"
          onPress={onLock}
          startContent={<Lock className="h-3.5 w-3.5" />}
        >
          Lock
        </Button>
        <Button
          size="sm"
          color="primary"
          onPress={() => setShowCreate(true)}
          startContent={<Plus className="h-3.5 w-3.5" />}
        >
          Add secret
        </Button>
      </div>

      {/* Type filter */}
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
        {ALL_SECRET_TYPES.map((t) => (
          <Chip
            key={t}
            size="sm"
            variant={typeFilter === t ? "solid" : "flat"}
            color={typeFilter === t ? SECRET_COLORS[t] : "default"}
            className="cursor-pointer"
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          >
            {SECRET_LABELS[t]}
          </Chip>
        ))}
      </div>

      {/* Secret list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="sm" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <Shield className="h-8 w-8 text-foreground/20" />
          <p className="text-sm text-foreground/40">
            {search.trim() ? "No secrets match your search" : "No secrets yet"}
          </p>
          {!search.trim() && (
            <p className="text-xs text-foreground/30">
              Add your first secret to get started.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <SecretRow
              key={s.id}
              secret={s}
              vaultKey={vaultKey}
              onDeleted={() => void load()}
            />
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
    setState("unlocked");
    void podTrpcFetch<VaultMetadata>("secretsVault.getVaultMetadata")
      .then((m) => setMetadata(m))
      .catch(() => null);
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
