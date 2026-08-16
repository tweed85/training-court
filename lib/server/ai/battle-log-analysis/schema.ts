import { z } from 'zod';

/** Bumped alongside ANALYSIS_PIPELINE_VERSION when the output shape changes. */
export const ANALYSIS_SCHEMA_VERSION = 1;

const confidence = z.enum(['low', 'medium', 'high']);

const cardName = z
  .string()
  .min(1)
  .max(80)
  .describe('Exact English card name as printed, e.g. "Boss\'s Orders", "Fezandipiti ex".');

const cardCount = z.object({
  name: cardName,
  count: z.number().int().min(1).max(4),
});

export const matchSummarySchema = z.object({
  headline: z.string().max(240).describe('One sentence: why this match was won or lost.'),
  narrative: z
    .string()
    .max(2500)
    .describe('Three to five sentences on how the game actually went.'),
  result: z.enum(['win', 'loss', 'tie', 'unknown']),
  turnOrder: z.enum(['first', 'second', 'unknown']),
  decidingFactor: z.enum([
    'prize_race',
    'setup_failure',
    'opponent_setup_failure',
    'resource_management',
    'tech_card',
    'matchup_spread',
    'misplay',
    'variance',
    'unknown',
  ]),
  confidence,
});

export const turningPointSchema = z.object({
  turnNumber: z
    .number()
    .int()
    .min(0)
    .max(200)
    .describe('The n from the "T<n>" header in the match log.'),
  turnLabel: z.string().max(140).describe('Verbatim turn title from the log.'),
  whatHappened: z.string().max(700),
  whyItMattered: z.string().max(700),
  swing: z.enum(['favor_player', 'favor_opponent', 'neutral']),
  cardsInvolved: z.array(cardName).max(6),
});

export const tacticalSuggestionSchema = z.object({
  turnNumber: z.number().int().min(0).max(200),
  actualPlay: z.string().max(500).describe('What the player actually did on that turn.'),
  suggestedPlay: z.string().max(600).describe('The concrete alternative line, naming cards.'),
  cardsInvolved: z
    .array(cardName)
    .max(6)
    .describe('Every card the suggested line requires. Must be in the decklist or shown in hand.'),
  requiresSearchOrDraw: z
    .boolean()
    .describe('True if the suggested card was not already visible in the player\'s hand.'),
  rationale: z.string().max(900),
  expectedImpact: z.enum(['minor', 'moderate', 'major']),
  confidence,
});

export const deckSuggestionSchema = z.object({
  kind: z.enum(['add', 'cut', 'swap', 'count_change']),
  cardsIn: z.array(cardCount).max(3),
  cardsOut: z.array(cardCount).max(3),
  rationale: z.string().max(900).describe('Must cite evidence from THIS match.'),
  confidence,
});

/**
 * The `.max()` lengths are runaway guards, not style limits. They are set well
 * above what the model actually produces: an over-tight cap rejects the ENTIRE
 * response, so a 130-character headline would throw away a complete, correct
 * analysis. Cost is bounded by `maxOutputTokens` instead.
 *
 * No `.min(1)` on the arrays: a genuinely uneventful log should be allowed to
 * return nothing rather than pad with invented advice. Every string is `.max()`
 * bounded so a runaway generation fails validation instead of billing for 8k
 * output tokens.
 */
export const battleLogAnalysisSchema = z.object({
  matchSummary: matchSummarySchema,
  turningPoints: z.array(turningPointSchema).max(5),
  tacticalSuggestions: z.array(tacticalSuggestionSchema).max(5),
  deckSuggestions: z.array(deckSuggestionSchema).max(4),
  notEnoughInformation: z.boolean(),
});

export type BattleLogAnalysis = z.infer<typeof battleLogAnalysisSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type TurningPoint = z.infer<typeof turningPointSchema>;
export type TacticalSuggestion = z.infer<typeof tacticalSuggestionSchema>;
export type DeckSuggestion = z.infer<typeof deckSuggestionSchema>;
