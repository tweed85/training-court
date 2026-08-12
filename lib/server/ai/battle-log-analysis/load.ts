import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/database.types';
import { parseBattleLog } from '@/components/battle-logs/utils/battle-log.utils';
import type { BattleLog } from '@/components/battle-logs/utils/battle-log.types';
import { buildAnalysisCacheKey, decklistFingerprint } from './cache-key';
import type { DeckEntry } from './build-context';

type LogRow = Database['public']['Tables']['logs']['Row'];

export interface LoadedContext {
  log: LogRow;
  battleLog: BattleLog;
  decklist: { id: string; name: string; archetype: string | null; cards: DeckEntry[] } | null;
  screenName: string | null;
  cacheKey: string;
}

export type LoadFailure = {
  error: string;
  status: number;
  detail?: string;
};

const failure = (error: string, status: number, detail?: string): LoadFailure => ({
  error,
  status,
  detail,
});

const isFailure = (value: unknown): value is LoadFailure =>
  typeof value === 'object' && value !== null && 'error' in value && 'status' in value;

export const isLoadFailure = isFailure;

/**
 * Everything both GET and POST need, resolved once so the two handlers cannot
 * drift on authorization or on how the cache key is computed.
 *
 * Ownership is checked explicitly with `.eq('user', userId)` rather than
 * inferred from "the select returned a row": `logs` is publicly SELECT-able so
 * link previews work for logged-out visitors, which means a successful read
 * proves nothing about who owns the row.
 */
export async function loadAnalysisContext(
  supabase: SupabaseClient<Database>,
  logId: string,
  userId: string
): Promise<LoadedContext | LoadFailure> {
  const { data: log } = await supabase
    .from('logs')
    .select('*')
    .eq('id', logId)
    .eq('user', userId)
    .returns<LogRow[]>()
    .maybeSingle();

  if (!log) {
    // 404 rather than 403: do not confirm that someone else's log exists.
    return failure('not_found', 404);
  }

  const { data: userData } = await supabase
    .from('user data')
    .select('live_screen_name')
    .eq('id', userId)
    .maybeSingle();

  const screenName = (userData as { live_screen_name: string | null } | null)?.live_screen_name ?? null;

  if (!screenName) {
    // Without it, parseBattleLog cannot tell which player is the user, and we
    // would confidently coach the opponent.
    return failure('screen_name_missing', 422);
  }

  let battleLog: BattleLog;
  try {
    battleLog = parseBattleLog(
      log.log,
      log.id,
      log.created_at,
      log.archetype,
      log.opp_archetype,
      screenName,
      log.format,
      log.decklist_id
    );
  } catch (error) {
    // parseBattleLog throws a bare string for an unsupported language and an
    // Error for a malformed log; both are user-data problems, not bugs.
    const detail = typeof error === 'string' ? error : (error as Error)?.message;
    return failure('unparseable_log', 400, detail);
  }

  const isParticipant = battleLog.players.some(
    (player) => player.name?.toLowerCase() === screenName.toLowerCase()
  );

  if (!isParticipant) {
    return failure('screen_name_mismatch', 422);
  }

  // `log.decklist_id` is attacker-influenced: users PATCH their own log rows
  // from the browser and could point it at someone else's decklist. Scoping by
  // user_id makes that a non-issue regardless of dashboard RLS.
  let decklist: LoadedContext['decklist'] = null;
  let fingerprint: string | null = null;

  if (log.decklist_id) {
    const { data } = await supabase
      .from('decklists')
      .select('id, name, archetype, cards, content_hash, updated_at')
      .eq('id', log.decklist_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (data) {
      const row = data as {
        id: string;
        name: string;
        archetype: string | null;
        cards: unknown;
        content_hash: string | null;
        updated_at: string;
      };

      const cards = Array.isArray(row.cards) ? (row.cards as DeckEntry[]) : [];
      if (cards.length) {
        decklist = { id: row.id, name: row.name, archetype: row.archetype, cards };
      }
      fingerprint = decklistFingerprint(row);
    }
  }

  const cacheKey = buildAnalysisCacheKey({
    log: log.log,
    archetype: log.archetype,
    oppArchetype: log.opp_archetype,
    format: log.format,
    turnOrder: log.turn_order,
    result: log.result,
    decklistId: log.decklist_id,
    decklistFingerprint: fingerprint,
    screenName,
    notes: log.notes,
  });

  return { log, battleLog, decklist, screenName, cacheKey };
}
