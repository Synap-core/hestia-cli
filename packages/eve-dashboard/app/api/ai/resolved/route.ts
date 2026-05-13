/**
 * GET /api/ai/resolved
 *
 * Returns the authoritative resolved (provider, model) for every AI consumer,
 * using the same pickPrimaryProvider() logic that materializeTargets("ai-wiring")
 * applies. Includes drift detection against the last recorded wiredModel.
 *
 * Response shape per consumer id:
 *   provider     — upstream provider id (IS-client components always report 'synap')
 *   model        — model string that will be / was sent as the preferred model
 *   isISClient   — true for non-IS components that route through Synap IS
 *   wiredModel   — model recorded at last successful apply (null if never applied)
 *   wiredProvider — provider recorded at last successful apply
 *   lastApplied  — ISO timestamp of last apply
 *   drift        — true when resolved model ≠ wiredModel (config changed since last apply)
 */

import { NextResponse } from "next/server";
import { readEveSecrets, AI_CONSUMERS, pickPrimaryProvider } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const wiringStatus = secrets?.ai?.wiringStatus ?? {};

  const resolved = Object.fromEntries(
    Array.from(AI_CONSUMERS).map(id => {
      const p = pickPrimaryProvider(secrets, id);
      const isISClient = id !== 'synap';
      const resolvedModel = p?.defaultModel ?? null;
      const resolvedProvider = isISClient ? 'synap' : (p?.id ?? null);

      const status = wiringStatus[id];
      const wiredModel = status?.wiredModel ?? null;
      const wiredProvider = status?.wiredProvider ?? null;
      const lastApplied = status?.lastApplied ?? null;
      const lastOutcome = status?.outcome ?? null;

      // Drift: config has changed since last successful apply.
      // Only meaningful when we have a recorded wiredModel to compare against.
      const drift = wiredModel !== null && resolvedModel !== wiredModel;

      return [id, {
        provider: resolvedProvider,
        model: resolvedModel,
        isISClient,
        wiredModel,
        wiredProvider,
        lastApplied,
        lastOutcome,
        drift,
      }];
    }),
  );

  return NextResponse.json({ resolved });
}
