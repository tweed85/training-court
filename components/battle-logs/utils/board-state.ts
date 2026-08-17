import type { BattleLog } from './battle-log.types';
import type { BoardState, PlayerBoard, PokemonInPlay } from './board-state.types';
import {
  addKnown,
  addUnknown,
  clearZone,
  cloneZone,
  emptyZone,
  forgetKnown,
  removeKnown,
  removeUnknown,
} from './zone';

const MAX_BENCH = 5;

/** PTCG Live mixes U+0027 and U+2019 within a single line. */
const APOS = "['’]";

/** "Player2 moved Player2's 9 cards to their deck." is bookkeeping, not a bounce. */
const CARD_COUNT_PHRASE = /^\d+\s+cards?$/i;

/**
 * A count wearing a card name's clothes: "1 card", "3 cards", "a card".
 *
 * The count and named patterns disagree about `was` vs `were`, so shapes like
 * "1 card was discarded from ash's Pikipek." and "ash discarded a card." reach
 * the named handlers, which would record a card literally called "1 card".
 */
const CARD_PLACEHOLDER_PHRASE = /^(?:(\d+)\s+cards?|a\s+card)$/i;

/** How many cards a count-word capture stands for; 0 when it is a real name. */
const placeholderCount = (name: string): number => {
  const m = name.match(CARD_PLACEHOLDER_PHRASE);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
};

/**
 * PTCGL puts two sentences on one physical line ("X took a Prize card. A card
 * was added to X's hand."), and the greedy `(.+)` of a named pattern swallows
 * the first one. No real card name spans a sentence break, so a capture holding
 * one is a parse artifact and must degrade to a face-down card.
 *
 * Period-space rather than any period: a name that merely contains one, such as
 * "Mime Jr.", must still resolve as named. Only a following space makes the
 * period a sentence boundary.
 */
const SENTENCE_BREAK = /\. /;

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
    /**
     * A stadium placement. Must be tested before `playedCard`, which would
     * otherwise capture "Artazon to the Stadium spot" as the card name.
     */
    stadium: new RegExp(`^(${who}) played (.+) to the Stadium spot\\.$`),
    playedCard: new RegExp(`^(${who}) played (.+)\\.$`),
    discardedNamed: new RegExp(`^(${who}) discarded (?!\\d)(.+)\\.$`),
    discardedCount: new RegExp(`^(${who}) discarded (\\d+) cards?\\.$`),
    shuffledIntoDeck: new RegExp(`^(${who}) shuffled (\\d+) cards? into their deck\\.$`),
    bottomOfDeck: new RegExp(`^(${who}) put (\\d+) cards? on the bottom of their deck\\.$`),
    shuffledHand: new RegExp(`^(${who}) shuffled their hand\\.$`),
    discardedFromPokemonCount: new RegExp(`^(\\d+) cards? were discarded from (${who})${APOS}s (.+)\\.$`),
    discardedFromPokemonNamed: new RegExp(`^(.+) was discarded from (${who})${APOS}s (.+)\\.$`),
    openingHand: new RegExp(`^(${who}) drew (\\d+) cards for the opening hand\\.`),
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

  const isBullet = (raw: string | undefined): boolean => !!raw && /^[•▪]/.test(raw.trim());

  /** The itemised list belonging to `line`, if `next` is one of matching length. */
  const listFor = (line: string, next: string | undefined): string[] | null => {
    const count = line.match(/\b(\d+) cards?\b/);
    return count ? itemised(next, Number(count[1])) : null;
  };

  /**
   * Parse a "• A, B, C" detail into card names, but only trust it when it
   * holds exactly as many names as the line claimed. A mismatch means the
   * bullet belongs to something else, and guessing would name the wrong card.
   */
  const itemised = (detail: string | undefined, count: number): string[] | null => {
    if (!detail) return null;
    const trimmed = detail.trim();
    if (!/^[•▪]/.test(trimmed)) return null;
    const names = trimmed.replace(/^[•▪\s]+/, '').split(',').map((n) => n.trim()).filter(Boolean);
    if (names.length !== count) return null;
    // "• (Pokemon Tool) Brave Bangle: 30 damage" and "• 5 Pokemon: 150 damage"
    // are damage breakdowns wearing the same bullet. They close with the damage
    // they dealt, which no card name does. A colon is NOT the tell: "Type: Null"
    // is a real card, and one rejected name would discard the whole list.
    if (!names.every((n) => /^[A-Z0-9]/.test(n) && !/\bdamage$/i.test(n))) return null;
    return names;
  };

  /**
   * The counted hand events that a both-player effect emits twice. The verb
   * identifies the shape so that a draw is never paired with a shuffle.
   */
  const COUNTED: { key: string; re: RegExp }[] = [
    { key: 'drew', re: RE.drewOne },
    { key: 'drew', re: RE.drewCount },
    { key: 'discarded', re: RE.discardedCount },
    { key: 'shuffled', re: RE.shuffledIntoDeck },
    { key: 'bottom', re: RE.bottomOfDeck },
  ];

  const countedEvent = (raw: string | undefined): { key: string; actor: string } | null => {
    if (!raw) return null;
    const line = raw.replace(/^[\s\-•]+/, '').trim();
    for (const { key, re } of COUNTED) {
      const m = line.match(re);
      if (m) return { key, actor: m[1] };
    }
    return null;
  };

  const opponentOf = (name: string): string =>
    Object.keys(state).find((other) => other !== name) ?? name;

  /**
   * `named` carries the itemised list that followed this line, when the log
   * provided one. Every counted event prefers those identities and falls back
   * to an anonymous count only when the list is absent or disagrees.
   *
   * `asPlayer` redirects a counted event away from the player the line names.
   * A both-player effect prints both halves under the actor's name, so the
   * second half has to be booked against their opponent.
   */
  const applyLine = (raw: string, named?: string[] | null, asPlayer?: string): void => {
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
      if (named) {
        for (const name of named) benchNew(state[m[1]], newPokemon(name));
      } else {
        // No list on this line; a bare reveal line may still follow.
        pendingBenchReveal = { player: m[1], count: Number(m[2]) };
      }
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
      return;
    }

    // --- discard ------------------------------------------------------------
    // Count form before named form: "3 cards were discarded from …" would
    // otherwise be recorded as a card named "3 cards".

    m = line.match(RE.discardedFromPokemonCount);
    if (m) {
      const discard = state[m[2]].discard;
      if (named) for (const name of named) addKnown(discard, name);
      else addUnknown(discard, Number(m[1]));
      return;
    }

    m = line.match(RE.discardedFromPokemonNamed);
    if (m) {
      // The count pattern above insists on "were", so the singular
      // "1 card was discarded from ash's Pikipek." lands here instead.
      const placeholder = placeholderCount(m[1]);
      if (placeholder) addUnknown(state[m[2]].discard, placeholder);
      else addKnown(state[m[2]].discard, m[1]);
      return;
    }

    // --- hand ---------------------------------------------------------------
    // Order matters twice over: the unnamed forms are tested before the named
    // ones (`A card` is capitalised and would otherwise be recorded as a card
    // called "A card"), and the placement patterns above already consumed
    // "played X to the Bench", which would otherwise look like a plain play.
    // The bounce-to-hand case ("X moved X's Y to their hand") is not handled
    // here: RE.toHand above already matches and returns on that line shape,
    // so its hand bookkeeping lives inside that earlier handler instead.

    m = line.match(RE.drewOne);
    if (m) { addUnknown(state[asPlayer ?? m[1]].hand, 1); return; }

    m = line.match(RE.drewCount);
    if (m) {
      const hand = state[asPlayer ?? m[1]].hand;
      if (named) for (const name of named) addKnown(hand, name);
      else addUnknown(hand, Number(m[2]));
      return;
    }

    m = line.match(RE.drewNamed);
    if (m) { addKnown(state[m[1]].hand, m[2]); return; }

    m = line.match(RE.addedUnknown);
    if (m) { addUnknown(state[m[1]].hand, 1); return; }

    m = line.match(RE.addedNamed);
    if (m) {
      // RE.addedUnknown is ^-anchored, so it cannot fire when PTCGL shares the
      // physical line with another sentence ("X took a Prize card. A card was
      // added to X's hand."). The greedy capture here then swallows the prefix.
      if (SENTENCE_BREAK.test(m[1])) addUnknown(state[m[2]].hand, 1);
      else addKnown(state[m[2]].hand, m[1]);
      return;
    }

    m = line.match(RE.shuffledHand);
    if (m) { clearZone(state[m[1]].hand); return; }

    m = line.match(RE.shuffledIntoDeck);
    if (m) {
      const hand = state[asPlayer ?? m[1]].hand;
      // Naming them matters: removeUnknown would clamp out the OLDEST known
      // cards, which is how identities we still hold went missing.
      if (named) for (const name of named) removeKnown(hand, name);
      else removeUnknown(hand, Number(m[2]));
      return;
    }

    m = line.match(RE.bottomOfDeck);
    if (m) {
      const hand = state[asPlayer ?? m[1]].hand;
      if (named) for (const name of named) removeKnown(hand, name);
      else removeUnknown(hand, Number(m[2]));
      return;
    }

    m = line.match(RE.discardedCount);
    if (m) {
      const player = state[asPlayer ?? m[1]];
      if (named) {
        for (const name of named) {
          removeKnown(player.hand, name);
          addKnown(player.discard, name);
        }
      } else {
        removeUnknown(player.hand, Number(m[2]));
        addUnknown(player.discard, Number(m[2]));
      }
      return;
    }

    m = line.match(RE.discardedNamed);
    if (m) {
      const player = state[m[1]];
      // The (?!\d) guard on this pattern only blocks digits, so the written-out
      // "ash discarded a card." still reaches here without naming anything.
      const placeholder = placeholderCount(m[2]);
      if (placeholder) {
        removeUnknown(player.hand, placeholder);
        addUnknown(player.discard, placeholder);
      } else {
        removeKnown(player.hand, m[2]);
        addKnown(player.discard, m[2]);
      }
      return;
    }

    m = line.match(RE.stadium);
    if (m) {
      // PTCGL usually prints the placement and a plain "played X." for the same
      // card, so the arithmetic belongs to that follow-up line — doing it here
      // too would drop the hand by two for one card. Forget the identity only.
      // When the follow-up is absent we over-count by one, which surfaces as an
      // extra face-down card: the safe direction. Falling through to playedCard
      // instead decrements for "X to the Stadium spot", a name removeKnown can
      // never find, leaving the real card face-up in a hand it already left.
      forgetKnown(state[m[1]].hand, m[2]);
      return;
    }

    m = line.match(RE.playedCard);
    if (m) { removeKnown(state[m[1]].hand, m[2]); return; }
  };

  /**
   * The opening hand is the one event that needs the action rather than the
   * line: the card list arrives as a detail, and only the analysed player's is
   * ever listed. A detail line that is a comma-separated run of card names, and
   * holds as many names as were drawn, is that list.
   */
  const applyOpeningHand = (title: string, details: string[]): boolean => {
    const m = title.trim().match(RE.openingHand);
    if (!m) return false;

    const player = state[m[1]];
    const count = Number(m[2]);

    // Stop at the next opening-hand line. Both players' draws can land in one
    // action's details, and an unbounded scan would hand this player the other
    // player's seven named cards whenever their list came first.
    const cleaned = details.map((d) => d.replace(/^[\s\-•]+/, '').trim());
    const boundary = cleaned.findIndex((d) => RE.openingHand.test(d));
    const candidates = boundary === -1 ? cleaned : cleaned.slice(0, boundary);

    const names = candidates
      .filter((d) => d.includes(','))
      .map((d) => d.split(',').map((n) => n.trim()).filter(Boolean))
      .find((list) => list.length === count);

    // The opening hand is the entire hand by definition, so replace rather than
    // append: a line seen twice for one player cannot double the count.
    clearZone(player.hand);

    if (names) {
      for (const name of names) addKnown(player.hand, name);
    } else {
      addUnknown(player.hand, count);
    }
    return true;
  };

  return battleLog.sections.map((section) => {
    for (const action of section.actions) {
      // The opening hand consumes its own details, so skip the flat pass for it.
      if (applyOpeningHand(action.title, action.details)) continue;
      // No list is offered to the title: every counted line in the corpus
      // opens with "-", so getTurnActions files it as a detail, and a title
      // claiming details[0] could only mis-consume some other action's bullet.
      applyLine(action.title);

      // getTurnActions treats "drew 7 cards for the opening hand" as a
      // subaction indicator, so in the real corpus that line — and both
      // players' worth of it — ends up folded into an unrelated action's
      // details rather than becoming its own title. Check every detail line
      // for the pattern too, offering it the remainder of the details as its
      // candidate card list.
      for (let i = 0; i < action.details.length; i += 1) {
        if (applyOpeningHand(action.details[i], action.details.slice(i + 1))) continue;

        const line = action.details[i];
        const names = listFor(line, action.details[i + 1]);
        applyLine(line, names);
        // Step over the bullet on its structure, not on whether its names were
        // trusted: a refused list still occupies a line, and mistaking it for
        // "no list" hides the second half of a paired event behind it.
        let next = i + (isBullet(action.details[i + 1]) ? 2 : 1);

        // Judge, Iono and Unfair Stamp resolve for both players, and PTCG Live
        // prints both halves under the acting player's name — the actor's
        // first. The halves are required to be adjacent: battleLogNewStructure
        // has one Iono whose halves are separated by the opponent's own
        // "shuffled their hand" line, and that pair is missed. Reaching across
        // an intervening line would pair events that merely look alike, and
        // missing it only over-counts the actor — the safe direction. Only the log owner's cards are ever itemised, so each half
        // carries its own list or none, and the counts routinely differ.
        // Reading the second half as a repeat of the first credits one player
        // twice and leaves their opponent's hand untouched.
        const event = countedEvent(line);
        const second = event && countedEvent(action.details[next]);
        if (event && second && second.key === event.key && second.actor === event.actor) {
          const secondLine = action.details[next];
          const secondNames = listFor(secondLine, action.details[next + 1]);
          applyLine(secondLine, secondNames, opponentOf(event.actor));
          next += isBullet(action.details[next + 1]) ? 2 : 1;
        }

        i = next - 1;
      }
    }
    flushPendingReveal();
    return cloneState(state);
  });
}
