/**
 * In-memory sample entities for the Data app demo.
 *
 * Each entity is a generic property bag — the point of the demo is that
 * `<HeroField>` renders the right input regardless of which entity type
 * we hand it. State lives in localStorage so edits persist across
 * navigation (list ↔ detail) without dragging in a state library.
 */

"use client";

import type { EntityRef } from "@eve/fields";

export type EntityType = "contact" | "company" | "deal" | "project";

export interface SampleEntity {
  id: string;
  type: EntityType;
  name: string;
  status: string;
  email?: string;
  phone?: string;
  website?: string;
  description?: string;
  value?: number;
  progress?: number;
  startDate?: string;
  dueDate?: string;
  industry?: string;
  source?: string;
  tags?: string[];
  isPriority?: boolean;
  isArchived?: boolean;
  owner?: EntityRef;
  collaborators?: EntityRef[];
  notes?: string;
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const SEED: SampleEntity[] = [
  {
    id: "c_alice",
    type: "contact",
    name: "Alice Nakamura",
    status: "active",
    email: "alice.nakamura@meridian-labs.com",
    phone: "+1 415 555 0142",
    website: "https://linkedin.com/in/alicenakamura",
    industry: "ai_research",
    source: "referral",
    tags: ["founder", "ai"],
    isPriority: true,
    isArchived: false,
    description: "VP Research at Meridian Labs. Met at the Sundance AI workshop in March.",
    notes:
      "Currently scoping a Q3 collaboration around RAG eval. Prefers async over standups. Coffee, no meetings before 10am PT.",
    owner: { id: "u_self", name: "You", subtitle: "Operator" },
    collaborators: [
      { id: "c_marcus", name: "Marcus Cole", subtitle: "Founder" },
    ],
  },
  {
    id: "c_marcus",
    type: "contact",
    name: "Marcus Cole",
    status: "lead",
    email: "marcus@northcurrent.studio",
    phone: "+44 20 7946 0921",
    website: "https://northcurrent.studio",
    industry: "design",
    source: "linkedin",
    tags: ["designer", "agency"],
    isPriority: false,
    isArchived: false,
    description: "Founder of North Current — boutique brand studio. Strong typography taste.",
    notes:
      "Interested in our brand-system primitives. Wants a 20-min demo next week. London-based; happy with evening calls.",
    owner: { id: "u_self", name: "You", subtitle: "Operator" },
    collaborators: [],
  },
  {
    id: "co_meridian",
    type: "company",
    name: "Meridian Labs",
    status: "client",
    website: "https://meridian-labs.com",
    industry: "ai_research",
    description:
      "Applied AI research lab spun out of Stanford in 2024. 30 people, Series A.",
    value: 480000,
    startDate: "2026-02-14",
    tags: ["ai", "research", "enterprise"],
    isPriority: true,
    isArchived: false,
    owner: { id: "u_self", name: "You", subtitle: "Operator" },
    collaborators: [
      { id: "c_alice", name: "Alice Nakamura", subtitle: "VP Research" },
    ],
    notes:
      "Strategic account. Renewal in Q4. Champion is Alice; economic buyer is the COO (Dale).",
  },
  {
    id: "d_meridian_q3",
    type: "deal",
    name: "Meridian Q3 expansion",
    status: "negotiation",
    value: 120000,
    progress: 65,
    startDate: "2026-04-12",
    dueDate: "2026-06-30",
    source: "inbound",
    tags: ["expansion", "high-value"],
    isPriority: true,
    isArchived: false,
    description:
      "Adding 12 seats + advanced eval workspace. Pricing landed; legal review in flight.",
    owner: { id: "u_self", name: "You", subtitle: "Operator" },
    collaborators: [
      { id: "c_alice", name: "Alice Nakamura", subtitle: "Champion" },
    ],
    notes:
      "Blocker: SSO requirement. Procurement wants SCIM provisioning too — confirmed possible on Enterprise.",
  },
  {
    id: "p_realtime_eval",
    type: "project",
    name: "Realtime eval pipeline",
    status: "active",
    progress: 40,
    startDate: "2026-04-01",
    dueDate: "2026-07-15",
    tags: ["infra", "ml"],
    isPriority: false,
    isArchived: false,
    description:
      "Streaming eval over production prompts. Roll-up dashboards for trust & safety.",
    owner: { id: "u_self", name: "You", subtitle: "Operator" },
    collaborators: [
      { id: "c_alice", name: "Alice Nakamura" },
      { id: "c_marcus", name: "Marcus Cole" },
    ],
    notes:
      "Phase 1 (ingestion) shipped. Phase 2 (heuristic eval) in dev. Phase 3 (LLM-as-judge) next sprint.",
  },
];

// ─── localStorage-backed store ────────────────────────────────────────────────

const STORAGE_KEY = "eve.data-app.entities.v1";

function loadFromStorage(): SampleEntity[] {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw) as SampleEntity[];
    if (!Array.isArray(parsed)) return SEED;
    return parsed;
  } catch {
    return SEED;
  }
}

function saveToStorage(entities: SampleEntity[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entities));
  } catch {
    /* quota / privacy mode */
  }
}

let entities: SampleEntity[] = SEED;
let hydrated = false;
const subscribers = new Set<() => void>();

function ensureHydrated() {
  if (hydrated) return;
  entities = loadFromStorage();
  hydrated = true;
}

function notify() {
  subscribers.forEach((fn) => fn());
}

export function listEntities(): SampleEntity[] {
  ensureHydrated();
  return entities;
}

export function getEntity(id: string): SampleEntity | undefined {
  ensureHydrated();
  return entities.find((e) => e.id === id);
}

export function updateEntity(id: string, patch: Partial<SampleEntity>) {
  ensureHydrated();
  entities = entities.map((e) => (e.id === id ? { ...e, ...patch } : e));
  saveToStorage(entities);
  notify();
}

export function resetEntities() {
  entities = SEED;
  saveToStorage(entities);
  notify();
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// ─── Search helper (for entity-picker fields) ─────────────────────────────────

export function searchContacts(query: string): EntityRef[] {
  ensureHydrated();
  const q = query.trim().toLowerCase();
  return entities
    .filter((e) => e.type === "contact")
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .map((e) => ({
      id: e.id,
      name: e.name,
      subtitle: e.description?.split(".")[0] ?? e.email,
    }))
    .slice(0, 8);
}

export function searchPeople(query: string): EntityRef[] {
  ensureHydrated();
  const q = query.trim().toLowerCase();
  const everyone = entities
    .filter((e) => e.type === "contact")
    .map((e) => ({
      id: e.id,
      name: e.name,
      subtitle: e.description?.split(".")[0] ?? e.email,
    }));
  const self: EntityRef = { id: "u_self", name: "You", subtitle: "Operator" };
  const pool = [self, ...everyone];
  return pool.filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 8);
}
