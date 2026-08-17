import type { BattleLog } from './battle-log.types';
import type { BoardState, PlayerBoard, PokemonInPlay } from './board-state.types';
import {
  addKnown,
  addUnknown,
  clearZone,
  cloneZone,
  emptyZone,
  removeKnown,
  removeUnknown,
} from './zone';

const MAX_BENCH = 5;

/** PTCG Live mixes U+0027 and U+2019 within a single line. */
const APOS = "['’]";

/** "Player2 moved Player2's 9 cards to their deck." is bookkeeping, not a bounce. */
const CARD_COUNT_PHRASE = /^\d+\s+cards?$/i;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const newPokemon = (name: string, unknown = false): PokemonInPlay => ({
  name,
  evolvedFrom: [],
  damage: 0,
  attachments: [],
  ...(unknown ? { unknown: true } : {}),
});

const emptyBoard = (): PlayerBoard => ({
  active: null,
  bench: [],
  hand: emptyZone(),
  discard: emptyZone(),
});

const cloneBoard = (board: PlayerBoard): PlayerBoard => ({
  active: board.active ? { ...board.active, evolvedFrom: [...board.active.evolvedFrom], attachments: [...board.active.attachments] } : null,
  bench: board.bench.map((p) => ({ ...p, evolvedFrom: [...p.evolvedFrom], attachments: [...p.attachments] })),
  hand: cloneZone(board.hand),
  discard: cloneZone(board.discard),
});

const cloneState = (state: BoardState): BoardState => {
  const next: BoardState = {};
  for (const name of Object.keys(state)) next[name] = cloneBoard(state[name]);
  return next;
};

/**
 * Rebuild the board at the end of every turn.
 *
 * English only. The parser supports six languages but this grammar does not;
 * returning [] keeps a non-English log from rendering a confidently wrong board.
 *
 * Two rules keep the reconstruction honest when a line we do not model slips
 * past. First, the log is authoritative about the Active Spot: "X's Y is now in
 * the Active Spot" makes Y active even if we never saw Y placed, which resyncs
 * the board instead of letting one missed line poison every later turn. Second,
 * a named card always outranks an unnamed placeholder, so a "drew 2 cards and
 * played them to the Bench" we could not resolve never keeps a real Pokemon off
 * the board.
 */
export function deriveBoardStates(battleLog: BattleLog): BoardState[] {
  if (battleLog.language !== 'en') return [];

  const players = battleLog.players.map((p) => p.name).filter(Boolean);
  if (players.length !== 2) return [];

  const who = players.map(escapeRegex).join('|');

  // Every pattern is anchored on a known player name. A generic `(.+)'s (.+)`
  // would split "misty's Team Rocket's Tarountula" in the wrong place.
  const RE = {
    active: new RegExp(`^(${who}) played (.+) to the Active Spot\\.$`),
    bench: new RegExp(`^(${who}) played (.+) to the Bench\\.$`),
    /** Nest Ball / Buddy-Buddy Poffin naming the single card they found. */
    benchDrawn: new RegExp(`^(${who}) drew (.+) and played it to the Bench\\.$`),
    promote: new RegExp(`^(${who})${APOS}s (.+) is now in the Active Spot\\.$`),
    /** Boss's Orders, Switch, Prime Catcher: the first name becomes active. */
    switched: new RegExp(
      `^(${who})${APOS}s (.+) was switched with (${who})${APOS}s (.+) to become the Active Pokemon\\.$`
    ),
    /** Professor Turo's Scenario and friends pull a Pokemon out of play. */
    toHand: new RegExp(`^(${who}) moved (${who})${APOS}s (.+) to their hand\\.$`),
    retreat: new RegExp(`^(${who}) retreated (.+) to the Bench\\.$`),
    knockout: new RegExp(`^(${who})${APOS}s (.+) was Knocked Out!$`),
    benchUnknown: new RegExp(`^(${who}) drew (\\d+) cards? and played them to the Bench\\.$`),
    evolve: new RegExp(`^(${who}) evolved (.+) to (.+) (?:on the Bench|in the Active Spot)\\.$`),
    attach: new RegExp(`^(${who}) attached (.+) to (.+) (?:in the Active Spot|on the Bench)\\.$`),
    damage: new RegExp(`^(${who})${APOS}s (.+) used (.+) on (${who})${APOS}s (.+) for (\\d+) damage\\.$`),
    status: new RegExp(`^(${who})${APOS}s (.+) is now (Asleep|Paralyzed|Confused|Poisoned|Burned)\\.$`),
    drewNamed: new RegExp(`^(${who}) drew (?!a card\\b|\\d)(.+)\\.$`),
    drewOne: new RegExp(`^(${who}) drew a card\\.$`),
    drewCount: new RegExp(`^(${who}) drew (\\d+) cards?\\.$`),
    addedUnknown: new RegExp(`^A card was added to (${who})${APOS}s hand\\.$`),
    addedNamed: new RegExp(`^(.+) was added to (${who})${APOS}s hand\\.$`),
    movedToHand: new RegExp(`^(${who}) moved (?:${who})${APOS}s (.+) to their hand\\.$`),
    playedCard: new RegExp(`^(${who}) played (.+)\\.$`),
    discardedNamed: new RegExp(`^(${who}) discarded (?!\\d)(.+)\\.$`),
    discardedCount: new RegExp(`^(${who}) discarded (\\d+) cards?\\.$`),
    shuffledIntoDeck: new RegExp(`^(${who}) shuffled (\\d+) cards? into their deck\\.$`),
    bottomOfDeck: new RegExp(`^(${who}) put (\\d+) cards? on the bottom of their deck\\.$`),
    shuffledHand: new RegExp(`^(${who}) shuffled their hand\\.$`),
  };

  const state: BoardState = {};
  for (const name of players) state[name] = emptyBoard();

  const findOnBench = (board: PlayerBoard, name: string): number =>
    board.bench.findIndex((p) => p.name === name);

  /**
   * Bench a Pokemon that is already in play.
   *
   * Movement is never dropped. A retreat briefly makes six the bench size; the
   * promote PTCGL always emits immediately afterwards closes it again. Enforcing
   * the cap here instead would make the retreating Pokemon vanish.
   */
  const benchExisting = (board: PlayerBoard, pokemon: PokemonInPlay): void => {
    board.bench.push(pokemon);
  };

  /**
   * Bench a newly placed Pokemon, evicting a placeholder if that is what stands
   * in the way. A card we can name is real information; an unnamed slot is not.
   */
  const benchNew = (board: PlayerBoard, pokemon: PokemonInPlay): void => {
    if (board.bench.length >= MAX_BENCH) {
      const placeholder = board.bench.findIndex((p) => p.unknown);
      if (placeholder === -1) return;
      board.bench.splice(placeholder, 1);
    }
    board.bench.push(pokemon);
  };

  /**
   * Give the oldest placeholder a name. Placeholders carry no identity, so when
   * a later line says a Pokemon we are not tracking is in play, the placeholder
   * is almost certainly it — and adopting it beats inventing a duplicate.
   */
  const adoptPlaceholder = (board: PlayerBoard, name: string): PokemonInPlay | undefined => {
    const index = board.bench.findIndex((p) => p.unknown);
    if (index === -1) return undefined;

    const adopted = board.bench[index];
    adopted.name = name;
    delete adopted.unknown;
    return adopted;
  };

  /** Find a Pokemon by name in either slot. Active is checked first. */
  const findInPlay = (board: PlayerBoard, name: string): PokemonInPlay | undefined => {
    if (board.active?.name === name) return board.active;
    return board.bench.find((p) => p.name === name) ?? adoptPlaceholder(board, name);
  };

  /** Remove `name` from the bench and hand it back, adopting a placeholder if needed. */
  const takeFromBench = (board: PlayerBoard, name: string): PokemonInPlay | undefined => {
    let index = findOnBench(board, name);

    if (index === -1) {
      if (!adoptPlaceholder(board, name)) return undefined;
      index = findOnBench(board, name);
    }

    return board.bench.splice(index, 1)[0];
  };

  /**
   * Make `name` the Active Pokemon, whatever we currently believe is there.
   *
   * The log is authoritative about this, so an untracked name is created rather
   * than ignored. That is what lets the board resync after a line we do not
   * model; the old behavior (no-op unless the name was already benched) let a
   * single miss desync every remaining turn.
   */
  const makeActive = (board: PlayerBoard, name: string): void => {
    if (board.active?.name === name) return;

    const incoming = takeFromBench(board, name) ?? newPokemon(name);
    if (board.active) benchExisting(board, board.active);
    board.active = incoming;
  };

  /** Strict removal: bouncing a card must not invent board presence to delete. */
  const removeFromPlay = (board: PlayerBoard, name: string): void => {
    if (board.active?.name === name) {
      board.active = null;
      return;
    }

    const index = findOnBench(board, name);
    if (index !== -1) board.bench.splice(index, 1);
  };

  /**
   * "drew 2 cards and played them to the Bench" names nothing, but PTCGL prints
   * the cards on the very next line ("- Froakie, Froakie"). Hold the placement
   * for one line so we can use those names instead of blank slots.
   */
  let pendingBenchReveal: { player: string; count: number } | null = null;

  const flushPendingReveal = (): void => {
    if (!pendingBenchReveal) return;

    const { player, count } = pendingBenchReveal;
    pendingBenchReveal = null;

    for (let i = 0; i < count; i += 1) benchNew(state[player], newPokemon('', true));
  };

  /** Consume the reveal line if it is one: a bare, unpunctuated list of names. */
  const takeBenchReveal = (line: string): boolean => {
    if (!pendingBenchReveal) return false;
    if (/[.!?]$/.test(line)) return false;

    const names = line.split(/,\s*/).map((part) => part.trim());
    if (names.length !== pendingBenchReveal.count) return false;
    if (!names.every((name) => /^[A-Z0-9]/.test(name))) return false;

    const board = state[pendingBenchReveal.player];
    pendingBenchReveal = null;

    for (const name of names) benchNew(board, newPokemon(name));
    return true;
  };

  const applyLine = (raw: string): void => {
    const line = raw.replace(/^[\s\-•]+/, '').trim();
    if (!line) return;

    if (takeBenchReveal(line)) return;
    flushPendingReveal();

    let m = line.match(RE.active);
    if (m) {
      const board = state[m[1]];
      // A Pokemon already active is displaced only by an explicit retreat or KO.
      if (board.active === null) board.active = newPokemon(m[2]);
      else benchNew(board, newPokemon(m[2]));
      removeKnown(board.hand, m[2]);
      return;
    }

    m = line.match(RE.bench);
    if (m) {
      benchNew(state[m[1]], newPokemon(m[2]));
      removeKnown(state[m[1]].hand, m[2]);
      return;
    }

    m = line.match(RE.benchDrawn);
    if (m) {
      benchNew(state[m[1]], newPokemon(m[2]));
      return;
    }

    m = line.match(RE.benchUnknown);
    if (m) {
      pendingBenchReveal = { player: m[1], count: Number(m[2]) };
      return;
    }

    m = line.match(RE.switched);
    if (m) {
      // Both possessives name the same player; anything else is not a switch.
      if (m[1] === m[3]) makeActive(state[m[1]], m[2]);
      return;
    }

    m = line.match(RE.promote);
    if (m) {
      makeActive(state[m[1]], m[2]);
      return;
    }

    m = line.match(RE.toHand);
    if (m) {
      // This already-existing handler matches and returns before the new hand
      // block below is reached, so the addition to hand has to live here too:
      // a Pokemon bounced back by its own owner becomes a known card in hand.
      if (m[1] === m[2] && !CARD_COUNT_PHRASE.test(m[3])) {
        removeFromPlay(state[m[1]], m[3]);
        addKnown(state[m[1]].hand, m[3]);
      }
      return;
    }

    m = line.match(RE.retreat);
    if (m) {
      const board = state[m[1]];
      // A name mismatch means we already lost the thread; the promote that
      // follows a retreat is authoritative and will sort the active slot out.
      if (board.active && board.active.name === m[2]) {
        benchExisting(board, board.active);
        board.active = null;
      }
      return;
    }

    m = line.match(RE.evolve);
    if (m) {
      const target = findInPlay(state[m[1]], m[2]);
      if (target) {
        // Damage stays with the Pokemon through evolution, as in the real game.
        target.evolvedFrom.push(target.name);
        target.name = m[3];
      }
      return;
    }

    m = line.match(RE.attach);
    if (m) {
      const target = findInPlay(state[m[1]], m[3]);
      if (target) target.attachments.push(m[2]);
      removeKnown(state[m[1]].hand, m[2]);
      return;
    }

    m = line.match(RE.damage);
    if (m) {
      const target = findInPlay(state[m[4]], m[5]);
      if (target) target.damage += Number(m[6]);
      return;
    }

    m = line.match(RE.status);
    if (m) {
      const target = findInPlay(state[m[1]], m[2]);
      if (target) target.status = m[3];
      return;
    }

    m = line.match(RE.knockout);
    if (m) {
      const board = state[m[1]];
      if (board.active && board.active.name === m[2]) {
        board.active = null;
        return;
      }
      const index = findOnBench(board, m[2]);
      if (index !== -1) board.bench.splice(index, 1);
    }

    // --- hand ---------------------------------------------------------------
    // Order matters twice over: the unnamed forms are tested before the named
    // ones (`A card` is capitalised and would otherwise be recorded as a card
    // called "A card"), and the placement patterns above already consumed
    // "played X to the Bench", which would otherwise look like a plain play.

    m = line.match(RE.drewOne);
    if (m) { addUnknown(state[m[1]].hand, 1); return; }

    m = line.match(RE.drewCount);
    if (m) { addUnknown(state[m[1]].hand, Number(m[2])); return; }

    m = line.match(RE.drewNamed);
    if (m) { addKnown(state[m[1]].hand, m[2]); return; }

    m = line.match(RE.addedUnknown);
    if (m) { addUnknown(state[m[1]].hand, 1); return; }

    m = line.match(RE.addedNamed);
    if (m) { addKnown(state[m[2]].hand, m[1]); return; }

    m = line.match(RE.movedToHand);
    if (m) { addKnown(state[m[1]].hand, m[2]); return; }

    m = line.match(RE.shuffledHand);
    if (m) { clearZone(state[m[1]].hand); return; }

    m = line.match(RE.shuffledIntoDeck);
    if (m) { removeUnknown(state[m[1]].hand, Number(m[2])); return; }

    m = line.match(RE.bottomOfDeck);
    if (m) { removeUnknown(state[m[1]].hand, Number(m[2])); return; }

    m = line.match(RE.discardedCount);
    if (m) {
      const player = state[m[1]];
      removeUnknown(player.hand, Number(m[2]));
      addUnknown(player.discard, Number(m[2]));
      return;
    }

    m = line.match(RE.discardedNamed);
    if (m) {
      const player = state[m[1]];
      removeKnown(player.hand, m[2]);
      addKnown(player.discard, m[2]);
      return;
    }

    m = line.match(RE.playedCard);
    if (m) { removeKnown(state[m[1]].hand, m[2]); return; }
  };

  return battleLog.sections.map((section) => {
    for (const action of section.actions) {
      applyLine(action.title);
      for (const detail of action.details) applyLine(detail);
    }
    flushPendingReveal();
    return cloneState(state);
  });
}
