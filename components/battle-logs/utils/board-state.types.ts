import type { Zone } from './zone';

/**
 * The observable board, reconstructed from a PTCG Live log.
 *
 * Shape adapted from the TCGVibes engine's `PokemonInPlay`/`PlayerState`
 * (tweed85/TCGVibes, src/engine/types/core.ts), trimmed to what a log reader
 * can actually know. Deck, hand, prize cards, and turn-scoped rule flags are
 * deliberately absent: the log never reveals them.
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

export interface PlayerBoard {
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  /** Cards held. Yours is largely known; the opponent's largely is not. */
  hand: Zone;
  /** Cards in the discard pile, oldest first. */
  discard: Zone;
}

/** Keyed by player name exactly as it appears in the log. */
export type BoardState = Record<string, PlayerBoard>;
