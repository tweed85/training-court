import { EVOLVES_INTO, META_DECKS, TECH_POKEMON } from './meta-decks';
import { POKEMON_NAMES } from './pokemon-vocabulary';

/** How many words the longest vocabulary name spans. */
const MAX_SPAN = 3;

/**
 * Card text names a form differently from its sprite id, and sometimes in the
 * opposite order: the card is "Bloodmoon Ursaluna", the sprite is
 * `ursaluna-bloodmoon`. Window matching cannot recover that, so state it.
 */
const FORM_ALIASES: Record<string, string> = {
  'bloodmoon ursaluna': 'ursaluna-bloodmoon',
  'alolan exeggutor': 'exeggutor-alola',
  'hisuian zoroark': 'zoroark-hisui',
  'paldean tauros': 'tauros-paldea-blaze',
  'cornerstone mask ogerpon': 'ogerpon-cornerstone',
  'origin forme dialga': 'dialga-origin',
  'origin forme palkia': 'palkia-origin',
};

/** Vocabulary keyed on the spacing card text uses, mapped to the sprite id. */
const BY_WORDS: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  for (const name of POKEMON_NAMES) index[name.replace(/-/g, ' ')] = name;
  for (const [words, sprite] of Object.entries(FORM_ALIASES)) index[words] = sprite;
  return index;
})();

/** The Pokemon a deck would be named for, given one that was played. */
const identityOf = (sprite: string): string => EVOLVES_INTO[sprite] ?? sprite;

/**
 * Count the Pokemon a player is shown using, resolved to the Pokemon their
 * deck would be named for.
 *
 * Matching against a closed vocabulary is what keeps trainer and energy cards
 * out: "Buddy-Buddy Poffin" and "Team Rocket's Factory" are not Pokemon, so
 * they never appear here. An owner's prefix falls away for free, because
 * "Team Rocket's Spidops" still contains the word `spidops`.
 */
export const countPokemonPlayed = (lines: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const line of lines) {
    const words = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    const seenOnLine = new Set<string>();

    for (let i = 0; i < words.length; i += 1) {
      // Longest first: "raging bolt" must win over a bare "bolt".
      for (let span = MAX_SPAN; span >= 1; span -= 1) {
        if (i + span > words.length) continue;
        const sprite = BY_WORDS[words.slice(i, i + span).join(' ')];
        if (!sprite) continue;
        seenOnLine.add(identityOf(sprite));
        i += span - 1;
        break;
      }
    }

    // Once per line, not once per mention: "X's Dreepy used ... on Dreepy"
    // says one thing about the deck, not two.
    for (const mon of Array.from(seenOnLine)) counts[mon] = (counts[mon] ?? 0) + 1;
  }

  return counts;
};

/** Most played first, so a deck reads the way a player would say it. */
const byProminence = (mons: string[], counts: Record<string, number>): string[] =>
  [...mons].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));

/**
 * Name the deck behind a set of played Pokemon.
 *
 * The meta table is the authority on what counts as a deck, and how much a
 * Pokemon is played only breaks ties. That order matters: Dudunsparce is played
 * more than Beedrill in a Beedrill list, so ranking on play count alone names
 * the wrong deck.
 */
export const matchArchetype = (counts: Record<string, number>): string | undefined => {
  const present = new Set(Object.keys(counts));
  if (present.size === 0) return undefined;

  // A listed pairing, most specific first. Only this step may name a staple,
  // because here the meta itself says the pairing is the deck.
  const listed = META_DECKS.filter(
    (deck) => deck.pokemon.length > 1 && deck.pokemon.every((mon) => present.has(mon))
  );
  if (listed.length) {
    const best = listed.reduce((a, b) =>
      b.pokemon.length > a.pokemon.length || (b.pokemon.length === a.pokemon.length && b.share > a.share)
        ? b
        : a
    );
    return byProminence(best.pokemon, counts).join(',');
  }

  // Listed decks that stand on a single Pokemon. Two of them together is how a
  // real pairing the meta has not listed still gets both names.
  const singles = META_DECKS.filter(
    (deck) =>
      deck.pokemon.length === 1 &&
      present.has(deck.pokemon[0]) &&
      !TECH_POKEMON.has(deck.pokemon[0])
  ).sort((a, b) => b.share - a.share);

  if (singles.length) {
    const mons = Array.from(new Set(singles.slice(0, 2).map((deck) => deck.pokemon[0])));
    return byProminence(mons, counts).join(',');
  }

  // Nothing listed: name the two most played Pokemon that could carry a deck.
  const rogue = byProminence(Array.from(present), counts)
    .filter((mon) => !TECH_POKEMON.has(mon))
    .slice(0, 2);

  return rogue.length ? rogue.join(',') : undefined;
};
