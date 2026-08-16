/**
 * The observable board, reconstructed from a PTCG Live log.
 *
 * Shape adapted from the TCGVibes engine's `PokemonInPlay`/`PlayerState`
 * (tweed85/TCGVibes, src/engine/types/core.ts), trimmed to what a log reader
 * can actually know. Deck, prize cards, and turn-scoped rule flags are
 * deliberately absent: the log never reveals them. The hand is only partially
 * knowable — the log owner's draws are named, the opponent's are only counted —
 * so it mixes named cards with unknown placeholders. The discard pile is
 * public, so it holds named cards only.
 */
export interface PokemonInPlay {
  name: string;
  /** Pre-evolution stack, oldest first: ['Dreepy', 'Drakloak']. */
  evolvedFrom: string[];
  damage: number;
  /** Energy and tools, by card name, in attach order. */
  attachments: string[];
  status?: string;
  /** Placed by a line that named no card, e.g. "drew 2 cards and played them to the Bench". */
  unknown?: boolean;
}

/** A card in the hand or discard pile: named when the log named it. */
export interface ZoneCard {
  name: string;
  /** Entered the zone through a line that named no card, e.g. "drew 3 cards". */
  unknown?: boolean;
}

export interface PlayerBoard {
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  /** Cards known or inferred to be in hand, in the order they arrived. */
  hand: ZoneCard[];
  /** The discard pile, in the order cards arrived. */
  discardPile: ZoneCard[];
}

/** Keyed by player name exactly as it appears in the log. */
export type BoardState = Record<string, PlayerBoard>;
