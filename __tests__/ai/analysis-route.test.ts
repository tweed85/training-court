import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';

jest.mock('../../utils/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('../../utils/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('../../lib/server/ptcg-card-catalog', () => ({ getAllDeckbuilderCards: jest.fn() }));
jest.mock('../../lib/server/ai/battle-log-analysis/generate', () => ({
  generateAnalysis: jest.fn(),
}));

const { GET, POST } =
  require('../../app/api/battle-logs/[id]/analysis/route') as typeof import('../../app/api/battle-logs/[id]/analysis/route');
const { createClient } = require('../../utils/supabase/server');
const { createAdminClient } = require('../../utils/supabase/admin');
const { getAllDeckbuilderCards } = require('../../lib/server/ptcg-card-catalog');
const { generateAnalysis } = require('../../lib/server/ai/battle-log-analysis/generate');

// The one admin id the premium gate accepts (components/admin/admin.utils.ts).
const ADMIN_ID = '01a36333-aa26-47e1-bec6-bbdd596a7020';
const NON_ADMIN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const LOG_ID = 'log-1';

beforeAll(() => {
  Object.defineProperty(global, 'Response', {
    value: {
      json: (payload: unknown, init?: { status?: number }) => ({
        ok: (init?.status ?? 200) < 400,
        status: init?.status ?? 200,
        json: async () => payload,
      }),
    },
    configurable: true,
  });
});

/** The handlers never read the request; only params matter. */
const REQUEST = {} as Request;

const LOG_ROW = {
  id: LOG_ID,
  user: ADMIN_ID,
  log: battleLogNewStructure,
  created_at: '2026-01-01T00:00:00Z',
  archetype: 'gholdengo',
  opp_archetype: 'dragapult',
  decklist_id: null as string | null,
  notes: null,
  result: 'L',
  turn_order: '1',
  format: 'SVI-DRI',
};

const ANALYSIS = {
  matchSummary: {
    headline: 'Lost the prize race.',
    narrative: 'A narrative.',
    result: 'loss',
    turnOrder: 'first',
    decidingFactor: 'prize_race',
    confidence: 'medium',
  },
  turningPoints: [],
  tacticalSuggestions: [],
  deckSuggestions: [],
  notEnoughInformation: false,
};

/** Records every .eq() so tests can assert the ownership filter was applied. */
type EqCall = [string, unknown];

function makeUserClient(options: {
  userId?: string | null;
  logRow?: unknown;
  screenName?: string | null;
  eqCalls?: EqCall[];
}) {
  const eqCalls = options.eqCalls ?? [];

  const builder = (table: string) => {
    const chain: any = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      returns: () => chain,
      eq: (column: string, value: unknown) => {
        eqCalls.push([`${table}.${column}`, value]);
        return chain;
      },
      maybeSingle: async () => {
        if (table === 'logs') return { data: options.logRow ?? null };
        if (table === 'user data') {
          // `in` rather than `??` so an explicit null means "no screen name set".
          const live_screen_name = 'screenName' in options ? options.screenName : 'Bassoonboy135';
          return { data: { live_screen_name } };
        }
        return { data: null };
      },
    };
    return chain;
  };

  return {
    auth: {
      getUser: async () =>
        options.userId
          ? { data: { user: { id: options.userId } }, error: null }
          : { data: { user: null }, error: new Error('no session') },
    },
    from: (table: string) => builder(table),
  };
}

function makeAdminClient(options: { existing?: unknown; updated?: unknown } = {}) {
  const updates: unknown[] = [];
  const upserts: unknown[] = [];

  const chain = (): any => {
    const self: any = {
      select: () => self,
      eq: () => self,
      lt: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () => ({ data: options.existing ?? null }),
      update: (payload: unknown) => {
        updates.push(payload);
        const afterUpdate: any = {
          eq: () => afterUpdate,
          lt: () => afterUpdate,
          select: () => afterUpdate,
          maybeSingle: async () => ({ data: options.updated ?? null }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: null }),
        };
        return afterUpdate;
      },
      upsert: (payload: unknown) => {
        upserts.push(payload);
        const afterUpsert: any = {
          select: () => afterUpsert,
          maybeSingle: async () => ({ data: { id: 'row-1' } }),
        };
        return afterUpsert;
      },
    };
    return self;
  };

  return { client: { from: () => chain() }, updates, upserts };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  delete process.env.AI_ANALYSIS_ENABLED;

  getAllDeckbuilderCards.mockResolvedValue([]);
  generateAnalysis.mockResolvedValue({
    analysis: ANALYSIS,
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 1000,
  });
});

describe('POST /api/battle-logs/[id]/analysis — authorization', () => {
  it('401s with no session', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: null }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(401);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('403s for a signed-in non-premium user', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: NON_ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(403);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('404s when the log is not owned by the caller', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: null }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(404);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  // `logs` is publicly SELECT-able, so this filter is the actual authz check.
  it('scopes the log read by the owning user id', async () => {
    const eqCalls: EqCall[] = [];
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW, eqCalls }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    await POST(REQUEST, { params: { id: LOG_ID } });

    expect(eqCalls).toContainEqual(['logs.user', ADMIN_ID]);
    expect(eqCalls).toContainEqual(['logs.id', LOG_ID]);
  });

  it('scopes the decklist read by user_id so a foreign decklist cannot leak in', async () => {
    const eqCalls: EqCall[] = [];
    createClient.mockReturnValue(
      makeUserClient({
        userId: ADMIN_ID,
        logRow: { ...LOG_ROW, decklist_id: 'someone-elses-deck' },
        eqCalls,
      })
    );
    createAdminClient.mockReturnValue(makeAdminClient().client);

    await POST(REQUEST, { params: { id: LOG_ID } });

    expect(eqCalls).toContainEqual(['decklists.user_id', ADMIN_ID]);
  });
});

describe('POST /api/battle-logs/[id]/analysis — preconditions', () => {
  it('422s when the user has no live screen name', async () => {
    createClient.mockReturnValue(
      makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW, screenName: null })
    );
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(expect.objectContaining({ error: 'screen_name_missing' }));
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('422s when the screen name matches neither player', async () => {
    createClient.mockReturnValue(
      makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW, screenName: 'SomeoneElse' })
    );
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: 'screen_name_mismatch' })
    );
  });

  it('400s on an unparseable log without writing a row', async () => {
    createClient.mockReturnValue(
      makeUserClient({ userId: ADMIN_ID, logRow: { ...LOG_ROW, log: 'not a battle log at all' } })
    );
    const admin = makeAdminClient();
    createAdminClient.mockReturnValue(admin.client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(400);
    expect(admin.upserts).toHaveLength(0);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('503s and never calls the model when the kill switch is off', async () => {
    process.env.AI_ANALYSIS_ENABLED = 'false';
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(503);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('503s when the card catalog is unavailable', async () => {
    getAllDeckbuilderCards.mockRejectedValue(new Error('network down'));
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'catalog_unavailable' });
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('500s with a clear message when the service role key is absent', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockImplementation(() => {
      throw new Error('Missing Supabase admin environment variables.');
    });

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(500);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });
});

describe('POST /api/battle-logs/[id]/analysis — caching', () => {
  it('returns the cached row without calling the model', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));

    // The route computes the cache key itself; mirror it by reading the upsert
    // a first uncached run would make.
    const probe = makeAdminClient();
    createAdminClient.mockReturnValue(probe.client);
    await POST(REQUEST, { params: { id: LOG_ID } });
    const cacheKey = (probe.upserts[0] as { cache_key: string }).cache_key;

    jest.clearAllMocks();
    getAllDeckbuilderCards.mockResolvedValue([]);
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(
      makeAdminClient({
        existing: {
          id: 'row-1',
          status: 'succeeded',
          cache_key: cacheKey,
          result: ANALYSIS,
          warnings: [],
          grounding: {},
          error_code: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      }).client
    );

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(200);
    expect(generateAnalysis).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(expect.objectContaining({ status: 'succeeded' }));
  });

  it('202s on a concurrent in-flight request rather than generating twice', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));

    const probe = makeAdminClient();
    createAdminClient.mockReturnValue(probe.client);
    await POST(REQUEST, { params: { id: LOG_ID } });
    const cacheKey = (probe.upserts[0] as { cache_key: string }).cache_key;

    jest.clearAllMocks();
    getAllDeckbuilderCards.mockResolvedValue([]);
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(
      makeAdminClient({
        existing: {
          id: 'row-1',
          status: 'pending',
          cache_key: cacheKey,
          result: null,
          warnings: [],
          grounding: {},
          error_code: null,
          created_at: new Date().toISOString(),
        },
      }).client
    );

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(202);
    expect(generateAnalysis).not.toHaveBeenCalled();
  });

  it('writes a pending row before calling the model', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    const admin = makeAdminClient();
    createAdminClient.mockReturnValue(admin.client);

    await POST(REQUEST, { params: { id: LOG_ID } });

    expect(admin.upserts[0]).toEqual(expect.objectContaining({ status: 'pending', log_id: LOG_ID }));
    expect(generateAnalysis).toHaveBeenCalled();
  });
});

describe('POST /api/battle-logs/[id]/analysis — failures', () => {
  it('marks the row failed and 502s when the gateway errors', async () => {
    generateAnalysis.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    const admin = makeAdminClient();
    createAdminClient.mockReturnValue(admin.client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(502);
    expect(admin.updates).toContainEqual(
      expect.objectContaining({ status: 'failed', error_code: 'gateway_error' })
    );
  });

  it('503s when the gateway rate limits', async () => {
    generateAnalysis.mockRejectedValue(Object.assign(new Error('slow down'), { statusCode: 429 }));
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await POST(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'gateway_rate_limited' });
  });
});

describe('GET /api/battle-logs/[id]/analysis', () => {
  it('reports none when nothing has been generated', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await GET(REQUEST, { params: { id: LOG_ID } });

    expect(await response.json()).toEqual(
      expect.objectContaining({ status: 'none', analysis: null, stale: false })
    );
  });

  it('marks a row stale when its cache key no longer matches the inputs', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(
      makeAdminClient({
        existing: {
          id: 'row-1',
          status: 'succeeded',
          cache_key: 'a-key-from-an-older-decklist',
          result: ANALYSIS,
          warnings: [],
          grounding: {},
          error_code: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      }).client
    );

    const response = await GET(REQUEST, { params: { id: LOG_ID } });

    expect(await response.json()).toEqual(expect.objectContaining({ stale: true }));
  });

  it('403s for a non-premium user', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: NON_ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(makeAdminClient().client);

    const response = await GET(REQUEST, { params: { id: LOG_ID } });

    expect(response.status).toBe(403);
  });

  // A re-claimed row keeps its old `result` until the new generation lands, so
  // a failed retry must not hand the previous analysis back to the UI.
  it('never returns a body for a failed row', async () => {
    createClient.mockReturnValue(makeUserClient({ userId: ADMIN_ID, logRow: LOG_ROW }));
    createAdminClient.mockReturnValue(
      makeAdminClient({
        existing: {
          id: 'row-1',
          status: 'failed',
          cache_key: 'whatever',
          result: ANALYSIS,
          warnings: [{ code: 'low_grounding' }],
          grounding: {},
          error_code: 'gateway_error',
          created_at: '2026-01-01T00:00:00Z',
        },
      }).client
    );

    const body = await (await GET(REQUEST, { params: { id: LOG_ID } })).json();

    expect(body).toEqual(
      expect.objectContaining({
        status: 'failed',
        analysis: null,
        warnings: [],
        errorCode: 'gateway_error',
      })
    );
  });
});
