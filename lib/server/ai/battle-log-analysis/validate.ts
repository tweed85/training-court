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
 * The asymmetry here is deliberate, and it runs through both the fuzzy matcher
 * and the availability check. Descriptive prose keeps its turning point even if
 * a card name is unresolvable, and may have a near-miss name repaired, because
 * being wrong about a name in a recap is cosmetic. Prescriptive advice ("you
 * should have played X") gets neither concession: X must resolve exactly and be
 * demonstrably available, or the whole suggestion goes. Fuzzy matching is the
 * dangerous half — its bounds admit `pidgey` → `pidgeot`, so it can turn a
 * hallucination into a real card and hand it back as substantiated advice.
 */
export function validateAnalysis(
  analysis: BattleLogAnalysis,
  context: AnalysisContext,
  turnCount: number
): ValidationResult {
  const warnings: AnalysisWarning[] = [];
  let attempts = 0;
  let failures = 0;

  /**
   * exact → normalized, then optionally a bounded fuzzy match. Returns the
   * canonical name or null.
   *
   * `fuzzy` is opt-in per call site rather than a default, because the fuzzy
   * path can rewrite one real card into another and callers differ on whether
   * that is acceptable.
   */
  const resolve = (raw: string, where: string, fuzzy: boolean): string | null => {
    attempts += 1;
    const key = normalizeCardName(raw);

    const hit = context.allowedCards.get(key);
    if (hit) {
      if (hit.name !== raw) warnings.push({ code: 'card_corrected', from: raw, to: hit.name, where });
      return hit.name;
    }

    if (fuzzy) {
      const near = findNearestCardName(key, context.allowedCards);
      if (near) {
        warnings.push({ code: 'card_corrected', from: raw, to: near.name, where });
        return near.name;
      }
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

  // Turning points: descriptive. Drop unresolvable names, keep the point, and
  // allow a near miss to be repaired — the worst case is a cosmetically wrong
  // name in a recap the reader can check against the log below it.
  const turningPoints = analysis.turningPoints
    .filter((point) => inRange(point.turnNumber, 'turningPoints'))
    .map((point) => ({
      ...point,
      cardsInvolved: point.cardsInvolved
        .map((name) => resolve(name, 'turningPoints', true))
        .filter((name): name is string => name !== null),
    }));

  // Tactical suggestions: prescriptive. Every named card must resolve exactly —
  // no fuzzy repair — and be one the player demonstrably had, or the whole
  // suggestion goes.
  const tacticalSuggestions = analysis.tacticalSuggestions
    .filter((suggestion) => inRange(suggestion.turnNumber, 'tacticalSuggestions'))
    .flatMap((suggestion) => {
      const resolvedNames: string[] = [];

      for (const raw of suggestion.cardsInvolved) {
        const canonical = resolve(raw, 'tacticalSuggestions', false);
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

  // Deck suggestions require a decklist to be falsifiable at all, and are
  // prescriptive, so they resolve exactly for the same reason.
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
        const canonical = resolve(entry.name, 'deckSuggestions.cardsOut', false);
        if (!canonical) return [];
        if (!context.decklistCards.has(normalizeCardName(canonical))) {
          warnings.push({ code: 'card_not_in_decklist', name: canonical, where: 'deckSuggestions.cardsOut' });
          return [];
        }
        return [{ ...entry, name: canonical }];
      });

      const cardsIn = suggestion.cardsIn.flatMap((entry) => {
        const canonical = resolve(entry.name, 'deckSuggestions.cardsIn', false);
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
