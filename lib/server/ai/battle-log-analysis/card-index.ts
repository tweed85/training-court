import type { DeckbuilderCatalogCard } from '@/lib/server/ptcg-card-catalog';
import { normalizeCardName } from '@/lib/server/ptcg-card-name';

export type CardIndex = Map<string, DeckbuilderCatalogCard>;

/** Longest card names ("Reshiram & Charizard-GX") run to about six tokens. */
const MAX_NAME_TOKENS = 6;

/**
 * Structural PTCGL lines whose words are capitalized for reasons other than
 * being card names. "Bassoonboy135's Turn" would otherwise offer up "Turn" as a
 * one-token candidate.
 *
 * Ordinary filler ("ended their turn", "to the bench") needs no special casing:
 * it is lowercase, and the capitalization guard below already rejects it. That
 * distinction is what lets a genuine `Switch` play still resolve.
 */
const STRUCTURAL_LINE = /^(setup|.+'s turn)$/i;

const releaseTime = (card: DeckbuilderCatalogCard): number => {
  const raw = card.metadata.setReleaseDate;
  if (!raw) return 0;
  const parsed = Date.parse(raw.replace(/\//g, '-'));
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Fold the catalog to one card per name, preferring the most recent printing so
 * we quote current rules text and current legality.
 */
export function buildCardIndex(cards: DeckbuilderCatalogCard[]): CardIndex {
  const byName: CardIndex = new Map();

  for (const card of cards) {
    const key = normalizeCardName(card.name);
    if (!key) continue;

    const existing = byName.get(key);
    if (!existing || releaseTime(card) > releaseTime(existing)) {
      byName.set(key, card);
    }
  }

  return byName;
}

export interface ExtractedCards {
  resolved: CardIndex;
  /** Capitalized fragments that looked like card names but matched nothing. */
  unresolvedCount: number;
}

/**
 * Find every catalog card named anywhere in a battle log.
 *
 * PTCGL emits card names capitalized mid-sentence ("Bassoonboy135 played
 * Fighting Gong.") and lists them comma-separated on detail lines
 * ("- Nest Ball, Air Balloon"). We scan each fragment with a greedy
 * longest-match over n-grams so "Reshiram & Charizard-GX" resolves as one card
 * rather than as "Reshiram" plus "Charizard".
 *
 * Two guards keep the false-positive rate down: the surface form must start with
 * a capital or digit (ordinary English filler in these positions is lowercase),
 * and single tokens on the ambiguous list are refused.
 */
export function extractCardNamesFromLog(logText: string, index: CardIndex): ExtractedCards {
  const resolved: CardIndex = new Map();
  let unresolvedCount = 0;

  for (const rawLine of logText.split('\n')) {
    const line = rawLine.replace(/^[\s\-•]+/, '').trim();
    if (!line || STRUCTURAL_LINE.test(line)) continue;

    for (const fragment of line.split(/,\s+/)) {
      const tokens = fragment.split(/\s+/).filter(Boolean);
      let i = 0;

      while (i < tokens.length) {
        let matched = false;

        for (let n = Math.min(MAX_NAME_TOKENS, tokens.length - i); n >= 1; n -= 1) {
          const surface = tokens.slice(i, i + n).join(' ').replace(/[.:;!?]+$/, '');
          if (!surface) continue;

          // Card names are proper nouns; PTCGL capitalizes them everywhere.
          if (!/^[A-Z0-9]/.test(surface)) continue;

          const key = normalizeCardName(surface);
          if (!key) continue;

          const card = index.get(key);
          if (card) {
            resolved.set(key, card);
            i += n;
            matched = true;
            break;
          }
        }

        if (!matched) {
          if (/^[A-Z]/.test(tokens[i])) unresolvedCount += 1;
          i += 1;
        }
      }
    }
  }

  return { resolved, unresolvedCount };
}

/**
 * Fuzzy fallback for model output that is a character or two off a real name.
 *
 * The bounds — six characters minimum, a length difference of at most two, an
 * edit distance of at most two — cut the false-positive rate but do NOT make a
 * correction safe. Real cards sit within distance 2 of each other: `pidgey` →
 * `pidgeot`, `basic fire energy` → `basic fairy energy`. A hallucinated name can
 * therefore be rewritten into a different, real, allowed card.
 *
 * Only call this where being wrong about a name is cosmetic. Prescriptive
 * output ("play X on turn 4") must resolve exactly or be dropped, because a
 * corrected name there is advice the player never had a reason to follow.
 */
export function findNearestCardName(key: string, index: CardIndex): DeckbuilderCatalogCard | null {
  if (key.length < 6) return null;

  let best: DeckbuilderCatalogCard | null = null;
  let bestDistance = Infinity;

  const entries = Array.from(index.entries());
  for (let i = 0; i < entries.length; i += 1) {
    const [candidate, card] = entries[i];
    if (Math.abs(candidate.length - key.length) > 2) continue;

    const distance = boundedLevenshtein(key, candidate, 2);
    if (distance !== null && distance < bestDistance) {
      bestDistance = distance;
      best = card;
      if (distance === 1) break;
    }
  }

  return bestDistance <= 2 ? best : null;
}

/** Levenshtein that bails out once every cell in a row exceeds `max`. */
function boundedLevenshtein(a: string, b: string, max: number): number | null {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > max) return null;
    previous = current;
  }

  const distance = previous[b.length];
  return distance <= max ? distance : null;
}
