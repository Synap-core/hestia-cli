/**
 * WhatsApp Baileys session manager (module-scoped singleton).
 *
 * Eve's "Connect WhatsApp" path uses Baileys (https://github.com/WhiskeySockets/Baileys)
 * to ride a multi-device-linked Web session — same as scanning a QR
 * code in WhatsApp Web. This is the unofficial path (Path C from the
 * 2026-05-05 research): zero approval, zero cost, mirrors the Telegram
 * 60-second setup. Trade-off: Meta ToS-grey, fine for solo personal
 * traffic, not for business automation.
 *
 * Session state persists at `~/.eve/whatsapp-session/` (the Baileys
 * `multiFileAuthState` format) so a restart doesn't force a re-scan
 * unless the user unlinks from their phone.
 *
 * Lifecycle:
 *   • init()      — start a fresh socket (or pick up a stored session)
 *   • status()    — read the current state without mutating
 *   • disconnect()— logout + delete persisted state
 *
 * Not-safe-for-multiple-Next-instances: dev mode HMR will reload this
 * module and lose the in-memory socket; the persisted auth state stays
 * on disk so re-init is fast. For production (`next start`) the module
 * is loaded once and the socket lives for the lifetime of the process.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import QRCode from "qrcode";

// Baileys imports are dynamic so the heavy ws + protobuf modules only
// initialize when the API route is actually hit (cold-start safety).
type BaileysModule = typeof import("baileys");
let baileysPromise: Promise<BaileysModule> | null = null;

function loadBaileys(): Promise<BaileysModule> {
  if (!baileysPromise) {
    baileysPromise = import("baileys").then(m => {
      // Baileys publishes both default + named exports — normalize.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = m;
      return (mod.default ?? mod) as BaileysModule;
    });
  }
  return baileysPromise;
}

export type WhatsAppStatus =
  | { kind: "disconnected" }
  | { kind: "awaiting_scan"; qrDataUrl: string; sessionId: string }
  | { kind: "connecting"; sessionId: string }
  | { kind: "connected"; phoneNumber: string; sessionId: string }
  | { kind: "error"; message: string };

interface InternalState {
  status: WhatsAppStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: any | null;
  sessionId: string | null;
  authPath: string;
  startedAt: number;
}

const state: InternalState = {
  status: { kind: "disconnected" },
  socket: null,
  sessionId: null,
  authPath: join(homedir(), ".eve", "whatsapp-session"),
  startedAt: 0,
};

/**
 * Boot a new Baileys socket. If one is already running we re-emit the
 * current status (so re-clicking "Generate QR" doesn't tear down a
 * working session).
 *
 * Returns the latest snapshot of `status` so the caller can immediately
 * surface QR / connected info.
 */
export async function initSession(): Promise<WhatsAppStatus> {
  if (state.status.kind === "connected" || state.status.kind === "awaiting_scan") {
    return state.status;
  }

  const sessionId = `wa-${Date.now().toString(36)}`;
  state.sessionId = sessionId;
  state.startedAt = Date.now();
  state.status = { kind: "connecting", sessionId };

  await mkdir(state.authPath, { recursive: true });

  const baileys = await loadBaileys();
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMultiFileAuthState: (path: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
    DisconnectReason: { loggedOut: number };
  };

  const { state: authState, saveCreds } = await useMultiFileAuthState(state.authPath);
  const sock = makeWASocket({
    auth: authState,
    printQRInTerminal: false,
    // Browser identity — appears in WhatsApp's "Linked Devices" UI.
    browser: ["Eve", "Synap", "1.0"],
  });

  state.socket = sock;
  sock.ev.on("creds.update", saveCreds);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock.ev.on("connection.update", async (update: any) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 280,
          color: { dark: "#0F0F18", light: "#FFFFFF" },
        });
        state.status = { kind: "awaiting_scan", qrDataUrl, sessionId };
      } catch (e) {
        state.status = {
          kind: "error",
          message: `QR encode failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    if (connection === "open") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const me = (sock as any).user as { id?: string } | undefined;
      const phoneNumber = parsePhoneFromJid(me?.id ?? "") ?? "linked";
      state.status = { kind: "connected", phoneNumber, sessionId };
    }
    if (connection === "close") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        // User unlinked from the phone — wipe state and reset.
        await wipeAuth();
        state.status = { kind: "disconnected" };
        state.socket = null;
        state.sessionId = null;
      } else {
        // Transient — Baileys will auto-reconnect on the next event,
        // but we surface the disconnected state for the UI.
        state.status = { kind: "connecting", sessionId };
      }
    }
  });

  return state.status;
}

export function getStatus(): WhatsAppStatus {
  return state.status;
}

/**
 * Disconnect + wipe persisted auth. The next init() call will issue
 * a fresh QR code.
 */
export async function disconnect(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (state.socket as any)?.logout?.();
  } catch {
    // ignore — the goal is to leave nothing usable on disk
  }
  state.socket = null;
  state.sessionId = null;
  state.status = { kind: "disconnected" };
  await wipeAuth();
}

async function wipeAuth(): Promise<void> {
  try {
    await rm(state.authPath, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function parsePhoneFromJid(jid: string): string | null {
  // WA JIDs look like "33612345678:42@s.whatsapp.net"
  const match = jid.match(/^(\d+)/);
  if (!match) return null;
  const digits = match[1];
  // Format as "+33 6 12 34 56 78" loosely — first 2 as country, rest grouped.
  if (digits.length < 4) return `+${digits}`;
  const country = digits.slice(0, 2);
  const rest = digits.slice(2).match(/.{1,2}/g)?.join(" ") ?? digits.slice(2);
  return `+${country} ${rest}`;
}
