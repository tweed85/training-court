import { normalizeCardName } from '@/lib/server/ptcg-card-name';
import type { AnalysisContext } from './build-context';
import { findNearestCardName } from './card-index';
import type { BattleLogAnalysis } from './schema';

export type AnalysisWarning =
  | { code: 'card_corrected'; from: string; to: string; where: string }
  | { code: 'card_not_in_catalog'; name: string; where: string }
  | { code: 'card_not_available_to_player'; name: string; where: string }
  | { code: 'card_not_in_decklist'; name: string; where: string }
  | { code: 'suggestion_dropped'; reason: string; where: string }
  | { code: 'turn_out_of_range'; turnNumber: number; where: string }
  | { code: 'deck_suggestions_suppressed'; reason: string }
  | { code: 'low_grounding' };

export interface ValidationResult {
  analysis: BattleLogAnalysis;
  warnings: AnalysisWarning[];
}

/**
 * Filter the model's output down to claims we can substantiate.
 *
 * The asymmetry here is deliberate. Descriptive prose keeps its turning point
 * even if a card name is unresolvable, because being wrong about a name in a
 * recap is cosmetic. Prescriptive advice ("you should have played X") is dropped
 * whole when X is not demonstrably available, because a suggestion the player
 * could not have made is worse than no suggestion at all.
 */
export function validateAnalysis(
  analysis: BattleLogAnalysis,
  context: AnalysisContext,
  turnCount: number
): ValidationResult {
  const warnings: AnalysisWarning[] = [];
  let attempts = 0;
  let failures = 0;

  /** exact → normalized → conservative fuzzy. Returns the canonical name or null. */
  const resolve = (raw: string, where: string): string | null => {
    attempts += 1;
    const key = normalizeCardName(raw);

    const hit = context.allowedCards.get(key);
    if (hit) {
      if (hit.name !== raw) warnings.push({ code: 'card_corrected', from: raw, to: hit.name, where });
      return hit.name;
    }

    const near = findNearestCardName(key, context.allowedCards);
    if (near) {
      warnings.push({ code: 'card_corrected', from: raw, to: near.name, where });
      return near.name;
    }

    failures += 1;
    warnings.push({ code: 'card_not_in_catalog', name: raw, where });
    return null;
  };

  const inRange = (turnNumber: number, where: string): boolean => {
    if (turnNumber >= 0 && turnNumber < turnCount) return true;
    warnings.push({ code: 'turn_out_of_range', turnNumber, where });
    return false;
  };

  // Turning points: descriptive. Drop unresolvable names, keep the point.
  const turningPoints = analysis.turningPoints
    .filter((point) => inRange(point.turnNumber, 'turningPoints'))
    .map((point) => ({
      ...point,
      cardsInvolved: point.cardsInvolved
        .map((name) => resolve(name, 'turningPoints'))
        .filter((name): name is string => name !== null),
    }));

  // Tactical suggestions: prescriptive. Every named card must be one the player
  // demonstrably had, or the whole suggestion goes.
  const tacticalSuggestions = analysis.tacticalSuggestions
    .filter((suggestion) => inRange(suggestion.turnNumber, 'tacticalSuggestions'))
    .flatMap((suggestion) => {
      const resolvedNames: string[] = [];

      for (const raw of suggestion.cardsInvolved) {
        const canonical = resolve(raw, 'tacticalSuggestions');
        if (!canonical) {
          warnings.push({
            code: 'suggestion_dropped',
            reason: `unknown card "${raw}"`,
            where: 'tacticalSuggestions',
          });
          return [];
        }

        if (!context.userAccessibleCards.has(normalizeCardName(canonical))) {
          warnings.push({ code: 'card_not_available_to_player', name: canonical, where: 'tacticalSuggestions' });
          warnings.push({
            code: 'suggestion_dropped',
            reason: `"${canonical}" was not in the decklist and never appeared in the player's hand`,
            where: 'tacticalSuggestions',
          });
          return [];
        }

        resolvedNames.push(canonical);
      }

      return [{ ...suggestion, cardsInvolved: resolvedNames }];
    });

  // Deck suggestions require a decklist to be falsifiable at all.
  let deckSuggestions: BattleLogAnalysis['deckSuggestions'] = [];

  if (!context.decklistCards.size) {
    if (analysis.deckSuggestions.length) {
      warnings.push({
        code: 'deck_suggestions_suppressed',
        reason: 'no decklist is linked to this battle log',
      });
    }
  } else {
    deckSuggestions = analysis.deckSuggestions.flatMap((suggestion) => {
      const cardsOut = suggestion.cardsOut.flatMap((entry) => {
        const canonical = resolve(entry.name, 'deckSuggestions.cardsOut');
        if (!canonical) return [];
        if (!context.decklistCards.has(normalizeCardName(canonical))) {
          warnings.push({ code: 'card_not_in_decklist', name: canonical, where: 'deckSuggestions.cardsOut' });
          return [];
        }
        return [{ ...entry, name: canonical }];
      });

      const cardsIn = suggestion.cardsIn.flatMap((entry) => {
        const canonical = resolve(entry.name, 'deckSuggestions.cardsIn');
        return canonical ? [{ ...entry, name: canonical }] : [];
      });

      // A cut or swap that lost its cut target no longer describes a legal change.
      if ((suggestion.kind === 'cut' || suggestion.kind === 'swap') && !cardsOut.length) {
        warnings.push({
          code: 'suggestion_dropped',
          reason: `${suggestion.kind} suggestion had no valid card to remove`,
          where: 'deckSuggestions',
        });
        return [];
      }

      if (!cardsIn.length && !cardsOut.length) {
        warnings.push({
          code: 'suggestion_dropped',
          reason: 'no valid cards remained after validation',
          where: 'deckSuggestions',
        });
        return [];
      }

      return [{ ...suggestion, cardsIn, cardsOut }];
    });
  }

  // If most of what it named could not be resolved, the whole response is suspect.
  if (attempts > 0 && failures / attempts > 0.5) {
    warnings.push({ code: 'low_grounding' });
  }

  return {
    analysis: { ...analysis, turningPoints, tacticalSuggestions, deckSuggestions },
    warnings,
  };
}
