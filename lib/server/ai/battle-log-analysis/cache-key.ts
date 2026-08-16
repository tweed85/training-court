import { createHash } from 'node:crypto';

/**
 * Bump when the prompt, the output schema, or the log compaction changes.
 * Every existing cached analysis becomes a miss and regenerates on next request.
 * Old rows are kept for comparison rather than deleted.
 */
// 2: disabled Anthropic extended thinking and raised the output cap to 8k.
// 3: added the log's notes, which build-context injects as <player_notes>.
export const ANALYSIS_PIPELINE_VERSION = 3;

/**
 * Direct Anthropic model id, not the `anthropic/claude-sonnet-5` form the Vercel
 * AI Gateway uses. This instance authenticates straight to Anthropic with
 * ANTHROPIC_API_KEY; there is no gateway in front of it.
 */
export const ANALYSIS_MODEL = 'claude-sonnet-5';

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export interface CacheKeyInput {
  /** Raw PTCGL text. `logs` has no updated_at, so we hash the content itself. */
  log: string;
  archetype: string | null;
  oppArchetype: string | null;
  format: string | null;
  turnOrder: string | null;
  result: string | null;
  decklistId: string | null;
  /**
   * `decklists.content_hash` when present. It is nullable for rows saved before
   * that column existed, so callers fall back to `decklists.updated_at`.
   */
  decklistFingerprint: string | null;
  /**
   * parseBattleLog reorders players against this, so changing it changes who
   * gets coached — and therefore the entire analysis.
   */
  screenName: string | null;
  /**
   * `logs.notes`. build-context feeds it to the model as <player_notes>, and it
   * is freely editable, so leaving it out let an edited note return the previous
   * analysis from cache without ever calling the model.
   */
  notes: string | null;
}

/**
 * Fingerprint every input that can change the model's output.
 *
 * Deliberately excluded: the card catalog. It refetches from a remote JSON every
 * 30 minutes, so keying on it would invalidate every cached analysis several
 * times a day for no user-visible benefit.
 */
export function buildAnalysisCacheKey(input: CacheKeyInput): string {
  const canonical = [
    `pipeline:${ANALYSIS_PIPELINE_VERSION}`,
    `model:${ANALYSIS_MODEL}`,
    `log:${sha256(input.log)}`,
    // All user-editable via the battle log edit button, and all fed to parseBattleLog.
    `meta:${input.archetype ?? ''}|${input.oppArchetype ?? ''}|${input.format ?? ''}|${input.turnOrder ?? ''}|${input.result ?? ''}`,
    `deck:${input.decklistId ?? 'none'}:${input.decklistFingerprint ?? 'none'}`,
    `me:${(input.screenName ?? '').toLowerCase()}`,
    // Hashed rather than inlined: notes are unbounded free text.
    `notes:${sha256(input.notes ?? '')}`,
  ].join('\n');

  return sha256(canonical);
}

/**
 * `content_hash` is printing-agnostic (it hashes qty + normalized name + card
 * text), which is exactly the semantics we want: "the 60 cards changed".
 * Legacy rows predate it, so fall back to the row's mtime.
 */
export function decklistFingerprint(
  decklist: { content_hash: string | null; updated_at: string } | null
): string | null {
  if (!decklist) return null;
  return decklist.content_hash ?? decklist.updated_at;
}
