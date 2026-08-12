import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { isPremiumUser } from '@/components/premium/premium.utils';
import { getAllDeckbuilderCards } from '@/lib/server/ptcg-card-catalog';
import {
  ANALYSIS_MODEL,
  ANALYSIS_PIPELINE_VERSION,
} from '@/lib/server/ai/battle-log-analysis/cache-key';
import { buildAnalysisContext } from '@/lib/server/ai/battle-log-analysis/build-context';
import { generateAnalysis } from '@/lib/server/ai/battle-log-analysis/generate';
import { isLoadFailure, loadAnalysisContext } from '@/lib/server/ai/battle-log-analysis/load';
import { validateAnalysis } from '@/lib/server/ai/battle-log-analysis/validate';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = Number(process.env.AI_ANALYSIS_TIMEOUT_MS ?? 90_000);

/** Rows left `pending` past this are assumed killed by a function timeout. */
const STALE_PENDING_MS = 10 * 60 * 1000;

const isEnabled = () => process.env.AI_ANALYSIS_ENABLED !== 'false';

type AnalysisRow = {
  id: string;
  status: string;
  cache_key: string;
  result: unknown;
  warnings: unknown;
  grounding: unknown;
  error_code: string | null;
  created_at: string;
};

const analysisPayload = (row: AnalysisRow | null, stale: boolean) => ({
  status: row?.status ?? 'none',
  // Only a succeeded row has a body worth showing. A re-claimed row keeps its
  // previous `result` column until the new generation overwrites it, so gating
  // on status here stops a failed retry from rendering the old analysis.
  analysis: row?.status === 'succeeded' ? (row.result ?? null) : null,
  warnings: row?.status === 'succeeded' ? (row.warnings ?? []) : [],
  grounding: row?.grounding ?? null,
  errorCode: row?.error_code ?? null,
  stale,
});

/** Shared preamble: auth, premium gate, ownership, parse, cache key. */
async function authorize(logId: string) {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, response: Response.json({ error: 'Unauthorized.' }, { status: 401 }) } as const;
  }

  if (!isPremiumUser(user.id)) {
    return { ok: false, response: Response.json({ error: 'forbidden' }, { status: 403 }) } as const;
  }

  const loaded = await loadAnalysisContext(supabase as any, logId, user.id);
  if (isLoadFailure(loaded)) {
    return {
      ok: false,
      response: Response.json(
        { error: loaded.error, detail: loaded.detail },
        { status: loaded.status }
      ),
    } as const;
  }

  return { ok: true, user, loaded } as const;
}

function adminClientOr500() {
  try {
    return { ok: true, admin: createAdminClient() } as const;
  } catch {
    return {
      ok: false,
      response: Response.json(
        { error: 'Missing SUPABASE_SERVICE_ROLE_KEY on the server.' },
        { status: 500 }
      ),
    } as const;
  }
}

/**
 * Flip rows abandoned by a killed function so the client sees a retryable
 * failure instead of an analysis that never arrives.
 */
async function reapStalePending(admin: ReturnType<typeof createAdminClient>, logId: string) {
  await admin
    .from('battle_log_analyses')
    .update({ status: 'failed', error_code: 'timeout' })
    .eq('log_id', logId)
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - STALE_PENDING_MS).toISOString());
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const gate = await authorize(params.id);
  if (!gate.ok) return gate.response;

  const clients = adminClientOr500();
  if (!clients.ok) return clients.response;
  const { admin } = clients;

  await reapStalePending(admin, params.id);

  const { data } = await admin
    .from('battle_log_analyses')
    .select('id, status, cache_key, result, warnings, grounding, error_code, created_at')
    .eq('log_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as AnalysisRow | null;

  // The browser cannot compute this: it needs the decklist fingerprint and the
  // pipeline version, both server-side only.
  const stale = Boolean(row && row.cache_key !== gate.loaded.cacheKey);

  return Response.json(analysisPayload(row, stale));
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  if (!isEnabled()) {
    return Response.json({ error: 'ai_disabled' }, { status: 503 });
  }

  const gate = await authorize(params.id);
  if (!gate.ok) return gate.response;

  const clients = adminClientOr500();
  if (!clients.ok) return clients.response;

  const { admin } = clients;
  const { user, loaded } = gate;
  const { cacheKey } = loaded;

  // Cheapest path first: an identical analysis already exists.
  const { data: cachedData } = await admin
    .from('battle_log_analyses')
    .select('id, status, cache_key, result, warnings, grounding, error_code, created_at')
    .eq('log_id', params.id)
    .eq('cache_key', cacheKey)
    .maybeSingle();

  const cached = cachedData as AnalysisRow | null;

  if (cached?.status === 'succeeded') {
    return Response.json(analysisPayload(cached, false));
  }

  if (
    cached?.status === 'pending' &&
    Date.now() - new Date(cached.created_at).getTime() < TIMEOUT_MS
  ) {
    // A concurrent request is already generating this exact analysis.
    return Response.json(analysisPayload(cached, false), { status: 202 });
  }

  let catalog;
  try {
    catalog = await getAllDeckbuilderCards();
  } catch {
    // Proceeding without the catalog would make the validator pass everything.
    return Response.json({ error: 'catalog_unavailable' }, { status: 503 });
  }

  const context = buildAnalysisContext({
    battleLog: loaded.battleLog,
    logRow: loaded.log,
    decklist: loaded.decklist,
    catalog,
  });

  if (context.grounding.level === 'none') {
    return Response.json({ error: 'insufficient_grounding' }, { status: 422 });
  }

  // Claim the work before spending anything. The unique index on
  // (log_id, cache_key) makes this the lock against double-clicks.
  const { data: claimed } = await admin
    .from('battle_log_analyses')
    .upsert(
      {
        log_id: params.id,
        user_id: user.id,
        cache_key: cacheKey,
        pipeline_version: ANALYSIS_PIPELINE_VERSION,
        model: ANALYSIS_MODEL,
        status: 'pending',
        error_code: null,
        grounding: context.grounding as any,
      },
      { onConflict: 'log_id,cache_key' }
    )
    .select('id')
    .maybeSingle();

  const rowId = (claimed as { id: string } | null)?.id ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const generated = await generateAnalysis(context.userPrompt, controller.signal);

    const { analysis, warnings } = validateAnalysis(
      generated.analysis,
      context,
      loaded.battleLog.sections.length
    );

    const { data: saved } = await admin
      .from('battle_log_analyses')
      .update({
        status: 'succeeded',
        error_code: null,
        result: analysis as any,
        warnings: warnings as any,
        grounding: context.grounding as any,
        input_tokens: generated.inputTokens,
        output_tokens: generated.outputTokens,
        latency_ms: generated.latencyMs,
      })
      .eq('log_id', params.id)
      .eq('cache_key', cacheKey)
      .select('id, status, cache_key, result, warnings, grounding, error_code, created_at')
      .maybeSingle();

    // `saved` is null when the log was deleted mid-generation and the row
    // cascaded away. Nothing to do; return what we produced.
    return Response.json(
      saved
        ? analysisPayload(saved as AnalysisRow, false)
        : {
            status: 'succeeded',
            analysis,
            warnings,
            grounding: context.grounding,
            errorCode: null,
            stale: false,
          }
    );
  } catch (error) {
    const errorCode = classifyError(error, controller.signal.aborted);

    if (rowId) {
      await admin
        .from('battle_log_analyses')
        .update({ status: 'failed', error_code: errorCode })
        .eq('id', rowId);
    }

    const status = errorCode === 'gateway_rate_limited' ? 503 : 502;
    return Response.json({ error: errorCode }, { status });
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(error: unknown, aborted: boolean): string {
  if (aborted) return 'timeout';

  const name = (error as { name?: string })?.name ?? '';
  if (name === 'AbortError') return 'timeout';
  if (name.includes('NoObjectGenerated') || name.includes('NoOutputGenerated')) {
    return 'schema_violation';
  }
  if (name === 'TypeValidationError') return 'schema_violation';

  const statusCode = (error as { statusCode?: number })?.statusCode;
  if (statusCode === 429 || statusCode === 402) return 'gateway_rate_limited';

  return 'gateway_error';
}
