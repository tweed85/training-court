# Hands and Discard Piles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each player's hand and discard pile on every turn of the battle log, with unknown cards rendered as labelled placeholders.

**Architecture:** A `Zone` holds an authoritative `size` and a best-effort `known` list; unknown cards are the difference. The existing replayer gains hand and discard grammar plus one action-level hook for the opening hand. Two presentational components render a zone, mounted under the existing board.

**Tech Stack:** Next.js 14 App Router, TypeScript, Jest + Testing Library, Tailwind, `gt-react` for i18n.

**Spec:** `docs/superpowers/specs/2026-08-17-hand-and-discard-zones-design.md`

## Global Constraints

- Every pattern anchors on the two known player names from `battleLog.players`. Card names contain apostrophes (`Team Rocket's Tarountula`), so a generic `(.+)'s (.+)` regex mis-splits.
- Possessives must match both `'` (U+0027) and `’` (U+2019) via the existing `APOS` constant.
- English only. `deriveBoardStates` already returns `[]` when `battleLog.language !== 'en'`; hands and discards inherit that.
- **`A card was added to P's hand.` must not become a card named "A card."** Test the unnamed form before any named form.
- `size` is authoritative and never negative. `known.length` is always clamped to `size`.
- New user-facing copy uses `useGT` from `gt-react` with `battleLogs.board.*` ids, added to all four of `public/_gt/{de,es,fr,ja}.json`. `npm run translations:check` is CI-enforced.
- Baseline `npx tsc --noEmit` is exactly 7 pre-existing errors, all in `__tests__/recoil/selectors/battle-logs.test.ts`. Do not add more.
- Run the suite with `npx jest --runInBand`. Current total is 262 passing.

## File Structure

| File | Responsibility |
|---|---|
| `components/battle-logs/utils/zone.ts` (create) | `Zone` type and its pure arithmetic; no log or regex knowledge |
| `components/battle-logs/utils/board-state.types.ts` (modify) | `PlayerBoard` gains `hand` and `discard` |
| `components/battle-logs/utils/board-state.ts` (modify) | Hand and discard grammar; action-level opening-hand hook |
| `components/battle-logs/Board/ZoneCards.tsx` (create) | Renders a `Zone` as known art plus Unknown placeholders |
| `components/battle-logs/Board/DiscardPile.tsx` (create) | Collapsible wrapper around `ZoneCards` |
| `components/battle-logs/Board/BoardStateView.tsx` (modify) | Mount hand row and discard pile per player |
| `public/_gt/{de,es,fr,ja}.json` (modify) | `battleLogs.board.hand`, `.discard`, `.unknown` |

---

### Task 1: The Zone type and its arithmetic

**Files:**
- Create: `components/battle-logs/utils/zone.ts`
- Test: `__tests__/battle-logs/zone.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Zone`, `emptyZone()`, `cloneZone(z)`, `addKnown(z, name)`, `addUnknown(z, n)`, `removeKnown(z, name)`, `removeUnknown(z, n)`, `clearZone(z)`, `unknownCount(z)` — all mutate in place except `emptyZone`, `cloneZone` and `unknownCount`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/zone.test.ts`:

```ts
import {
  addKnown,
  addUnknown,
  clearZone,
  cloneZone,
  emptyZone,
  removeKnown,
  removeUnknown,
  unknownCount,
} from '../../components/battle-logs/utils/zone';

describe('zone arithmetic', () => {
  it('starts empty', () => {
    expect(emptyZone()).toEqual({ known: [], size: 0 });
  });

  it('adding a known card grows both known and size', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    expect(z).toEqual({ known: ['Iono'], size: 1 });
    expect(unknownCount(z)).toBe(0);
  });

  it('adding unknown cards grows only size', () => {
    const z = emptyZone();
    addUnknown(z, 3);
    expect(z.known).toEqual([]);
    expect(z.size).toBe(3);
    expect(unknownCount(z)).toBe(3);
  });

  it('mixes known and unknown', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addUnknown(z, 2);
    expect(unknownCount(z)).toBe(2);
    expect(z.size).toBe(3);
  });

  it('removing a known card removes one copy and shrinks size', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Iono');
    removeKnown(z, 'Iono');
    expect(z).toEqual({ known: ['Iono'], size: 1 });
  });

  it('removing a card that was never known still shrinks size', () => {
    const z = emptyZone();
    addUnknown(z, 2);
    removeKnown(z, "Boss's Orders");
    expect(z).toEqual({ known: [], size: 1 });
  });

  it('never lets size go negative', () => {
    const z = emptyZone();
    removeUnknown(z, 5);
    expect(z.size).toBe(0);
    removeKnown(z, 'Iono');
    expect(z.size).toBe(0);
  });

  // Prefer turning a known card into an unknown over deleting a wrong identity.
  it('clamps known down to size when unknown cards are removed', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addKnown(z, 'Arven');
    addKnown(z, 'Penny');
    removeUnknown(z, 2);
    expect(z.size).toBe(1);
    expect(z.known).toEqual(['Penny']);
  });

  it('clearing empties the zone entirely', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    addUnknown(z, 4);
    clearZone(z);
    expect(z).toEqual({ known: [], size: 0 });
  });

  it('cloning is deep, so later mutation cannot leak backwards', () => {
    const z = emptyZone();
    addKnown(z, 'Iono');
    const snapshot = cloneZone(z);
    addKnown(z, 'Arven');
    expect(snapshot).toEqual({ known: ['Iono'], size: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/zone.test.ts`
Expected: FAIL — `Cannot find module '../../components/battle-logs/utils/zone'`

- [ ] **Step 3: Write the implementation**

Create `components/battle-logs/utils/zone.ts`:

```ts
/**
 * A hidden-information card zone: a hand or a discard pile.
 *
 * `size` is authoritative and comes from the log's explicit counts. `known` is
 * best-effort and comes from lines that name a card. The difference is how many
 * cards we know are there but cannot name.
 *
 * Splitting the two is the safety mechanism for the whole feature. Unlike the
 * board, the log never asserts "the hand is now these cards", so identity
 * tracking cannot resync once it drifts. Keeping the count separate means drift
 * shows up as an extra face-down card rather than a confidently wrong one.
 */
export interface Zone {
  known: string[];
  size: number;
}

export const emptyZone = (): Zone => ({ known: [], size: 0 });

export const cloneZone = (zone: Zone): Zone => ({
  known: [...zone.known],
  size: zone.size,
});

export const unknownCount = (zone: Zone): number => Math.max(0, zone.size - zone.known.length);

/** `known` may never claim more cards than the zone actually holds. */
const clamp = (zone: Zone): void => {
  if (zone.size < 0) zone.size = 0;
  while (zone.known.length > zone.size) zone.known.shift();
};

export function addKnown(zone: Zone, name: string): void {
  zone.known.push(name);
  zone.size += 1;
}

export function addUnknown(zone: Zone, count: number): void {
  zone.size += count;
}

/**
 * Remove a specific card. If it was never known — the log named a card we had
 * not seen enter the zone — the count still drops, because the count is the
 * part we trust.
 */
export function removeKnown(zone: Zone, name: string): void {
  const index = zone.known.indexOf(name);
  if (index !== -1) zone.known.splice(index, 1);
  zone.size -= 1;
  clamp(zone);
}

export function removeUnknown(zone: Zone, count: number): void {
  zone.size -= count;
  clamp(zone);
}

export function clearZone(zone: Zone): void {
  zone.known = [];
  zone.size = 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/zone.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add components/battle-logs/utils/zone.ts __tests__/battle-logs/zone.test.ts
git commit -m "Add Zone: authoritative count with best-effort identities"
```

---

### Task 2: Hand grammar

**Files:**
- Modify: `components/battle-logs/utils/board-state.types.ts`
- Modify: `components/battle-logs/utils/board-state.ts`
- Test: `__tests__/battle-logs/board-state-hand.test.ts`

**Interfaces:**
- Consumes: `Zone` and its operations from Task 1
- Produces: `PlayerBoard.hand: Zone`, populated by `deriveBoardStates`

- [ ] **Step 1: Extend the types**

In `components/battle-logs/utils/board-state.types.ts`, add the import at the top:

```ts
import type { Zone } from './zone';
```

and extend `PlayerBoard`:

```ts
export interface PlayerBoard {
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  /** Cards held. Yours is largely known; the opponent's largely is not. */
  hand: Zone;
  /** Cards in the discard pile, oldest first. */
  discard: Zone;
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/battle-logs/board-state-hand.test.ts`:

```ts
import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';
import { unknownCount } from '../../components/battle-logs/utils/zone';

const turn = (lines: string[]): BattleLogTurn => ({
  turnTitle: 'A Turn',
  body: '',
  player: 'ash',
  prizesAfterTurn: { ash: 6, misty: 6 },
  actions: lines.map((title) => ({ title, details: [] })),
});

const log = (turns: BattleLogTurn[], language = 'en'): BattleLog =>
  ({
    language,
    id: 'l1',
    players: [
      { name: 'ash', deck: 'a', oppDeck: 'b', result: 'W' },
      { name: 'misty', deck: 'b', oppDeck: 'a', result: 'L' },
    ],
    date: '2026-01-01',
    winner: 'ash',
    sections: turns,
  }) as BattleLog;

const hand = (lines: string[]) => deriveBoardStates(log([turn(lines)]))[0].ash.hand;

describe('hand grammar — additions', () => {
  it('a named draw is a known card', () => {
    expect(hand(['ash drew Iono.'])).toEqual({ known: ['Iono'], size: 1 });
  });

  it('an unnamed draw grows the count only', () => {
    const h = hand(['ash drew a card.']);
    expect(h.size).toBe(1);
    expect(unknownCount(h)).toBe(1);
  });

  it('a bulk draw grows the count only', () => {
    expect(hand(['ash drew 3 cards.']).size).toBe(3);
  });

  it('a named card added to hand is known', () => {
    expect(hand(["Boss's Orders was added to ash's hand."]).known).toEqual(["Boss's Orders"]);
  });

  // "A card" is capitalised, so a naive named-card pattern records a card
  // literally called "A card". The unnamed form must be tested first.
  it('does not invent a card named "A card"', () => {
    const h = hand(["A card was added to ash's hand."]);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(1);
  });

  it('accepts a curly apostrophe in the possessive', () => {
    expect(hand(['Iono was added to ash’s hand.']).known).toEqual(['Iono']);
  });

  it('a Pokemon bounced to hand is known', () => {
    expect(hand(["ash moved ash's Froakie to their hand."]).known).toEqual(['Froakie']);
  });
});

describe('hand grammar — removals', () => {
  it('playing a card removes it', () => {
    expect(hand(['ash drew Iono.', 'ash played Iono.'])).toEqual({ known: [], size: 0 });
  });

  it('attaching a card removes it', () => {
    expect(
      hand(['ash drew Basic Fire Energy.', 'ash attached Basic Fire Energy to Pikipek in the Active Spot.'])
    ).toEqual({ known: [], size: 0 });
  });

  it('discarding a named card removes it', () => {
    expect(hand(['ash drew Iono.', 'ash discarded Iono.']).size).toBe(0);
  });

  it('discarding N cards shrinks the count', () => {
    expect(hand(['ash drew 4 cards.', 'ash discarded 2 cards.']).size).toBe(2);
  });

  it('shuffling cards into the deck shrinks the count', () => {
    expect(hand(['ash drew 6 cards.', 'ash shuffled 3 cards into their deck.']).size).toBe(3);
  });

  it('putting cards on the bottom shrinks the count', () => {
    expect(hand(['ash drew 8 cards.', 'ash put 3 cards on the bottom of their deck.']).size).toBe(5);
  });

  // Iono and Judge. Absent from the production log, present 8x across the corpus.
  it('shuffling the hand empties it', () => {
    expect(hand(['ash drew Iono.', 'ash drew 4 cards.', 'ash shuffled their hand.'])).toEqual({
      known: [],
      size: 0,
    });
  });

  it('refills after a hand shuffle', () => {
    const h = hand(['ash drew 5 cards.', 'ash shuffled their hand.', 'ash drew Arven.']);
    expect(h).toEqual({ known: ['Arven'], size: 1 });
  });

  it('playing a Pokemon to the bench also leaves the hand', () => {
    expect(hand(['ash drew 3 cards.', 'ash played Hoothoot to the Bench.']).size).toBe(2);
  });

  it('never goes negative', () => {
    expect(hand(['ash played Iono.', 'ash discarded 3 cards.']).size).toBe(0);
  });

  it('tracks each player separately', () => {
    const boards = deriveBoardStates(log([turn(['ash drew Iono.', 'misty drew a card.'])]));
    expect(boards[0].ash.hand.known).toEqual(['Iono']);
    expect(boards[0].misty.hand).toEqual({ known: [], size: 1 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/board-state-hand.test.ts`
Expected: FAIL — `hand` is undefined on the player board

- [ ] **Step 4: Seed the zones**

In `components/battle-logs/utils/board-state.ts`, add to the imports:

```ts
import {
  addKnown,
  addUnknown,
  clearZone,
  cloneZone,
  emptyZone,
  removeKnown,
  removeUnknown,
} from './zone';
```

Find `emptyBoard` and give it the two zones:

```ts
const emptyBoard = (): PlayerBoard => ({
  active: null,
  bench: [],
  hand: emptyZone(),
  discard: emptyZone(),
});
```

Find `cloneBoard` and add the zones to the returned object, so each turn stays an
independent snapshot:

```ts
  hand: cloneZone(board.hand),
  discard: cloneZone(board.discard),
```

- [ ] **Step 5: Add the hand patterns**

In `deriveBoardStates`, add to the `RE` object:

```ts
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
```

- [ ] **Step 6: Handle the hand events**

In `applyLine`, insert this block at the very end, after the existing knockout
block. Placement matters: the existing placement patterns (`RE.active`,
`RE.bench`) must be tried first, because `ash played Hoothoot to the Bench.`
also matches `RE.playedCard`.

```ts
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
```

Three existing handlers already `return` before the hand block is reached, so
their hand decrement must go inside them rather than in a new pattern.

In the `RE.active` handler and the `RE.bench` handler, immediately before each
`return` — a Pokémon played to the board came out of the hand:

```ts
      removeKnown(board.hand, m[2]);
```

In the existing `RE.attach` handler, immediately before its `return` — the
attached card also came from the hand. Note `m[2]` is the attached card and
`m[3]` is the Pokémon receiving it:

```ts
      removeKnown(state[m[1]].hand, m[2]);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/board-state-hand.test.ts`
Expected: PASS, 17 tests

- [ ] **Step 8: Confirm nothing regressed**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: PASS — the existing placement tests are unaffected.

- [ ] **Step 9: Commit**

```bash
git add components/battle-logs/utils/board-state.ts components/battle-logs/utils/board-state.types.ts __tests__/battle-logs/board-state-hand.test.ts
git commit -m "Track each player's hand through the log"
```

---

### Task 3: Discard grammar and the opening hand

**Files:**
- Modify: `components/battle-logs/utils/board-state.ts`
- Test: `__tests__/battle-logs/board-state-discard.test.ts`

**Interfaces:**
- Consumes: `PlayerBoard.hand` and `.discard` from Task 2
- Produces: `PlayerBoard.discard` populated; opening hand populates `hand.known`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/board-state-discard.test.ts`:

```ts
import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';
import { parseBattleLog } from '../../components/battle-logs/utils/battle-log.utils';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';

const turn = (lines: string[], details: Record<number, string[]> = {}): BattleLogTurn => ({
  turnTitle: 'A Turn',
  body: '',
  player: 'ash',
  prizesAfterTurn: { ash: 6, misty: 6 },
  actions: lines.map((title, i) => ({ title, details: details[i] ?? [] })),
});

const log = (turns: BattleLogTurn[]): BattleLog =>
  ({
    language: 'en',
    id: 'l1',
    players: [
      { name: 'ash', deck: 'a', oppDeck: 'b', result: 'W' },
      { name: 'misty', deck: 'b', oppDeck: 'a', result: 'L' },
    ],
    date: '2026-01-01',
    winner: 'ash',
    sections: turns,
  }) as BattleLog;

describe('discard grammar', () => {
  it('a card discarded from a Pokemon is a known discard', () => {
    const boards = deriveBoardStates(
      log([turn(["Basic Fire Energy was discarded from ash's Pikipek."])])
    );
    expect(boards[0].ash.discard).toEqual({ known: ['Basic Fire Energy'], size: 1 });
  });

  it('a bulk discard from a Pokemon grows the count only', () => {
    const boards = deriveBoardStates(
      log([turn(["3 cards were discarded from misty's Team Rocket's Spidops."])])
    );
    expect(boards[0].misty.discard.size).toBe(3);
    expect(boards[0].misty.discard.known).toEqual([]);
  });

  it('discarding from hand moves the card to the discard pile', () => {
    const boards = deriveBoardStates(log([turn(['ash drew Iono.', 'ash discarded Iono.'])]));
    expect(boards[0].ash.hand.size).toBe(0);
    expect(boards[0].ash.discard.known).toEqual(['Iono']);
  });

  it('accumulates across turns and never shrinks', () => {
    const boards = deriveBoardStates(
      log([
        turn(["Basic Fire Energy was discarded from ash's Pikipek."]),
        turn(["Basic Grass Energy was discarded from ash's Solrock."]),
      ])
    );
    expect(boards[0].ash.discard.size).toBe(1);
    expect(boards[1].ash.discard.size).toBe(2);
  });
});

describe('opening hand', () => {
  it('reads the card list from the action details', () => {
    const boards = deriveBoardStates(
      log([
        turn(['ash drew 7 cards for the opening hand.'], {
          0: ['- 7 drawn cards.', "Boss's Orders, Drakloak, Iono, Arven, Penny, Rare Candy, Nest Ball"],
        }),
      ])
    );
    expect(boards[0].ash.hand.size).toBe(7);
    expect(boards[0].ash.hand.known).toHaveLength(7);
    expect(boards[0].ash.hand.known).toContain("Boss's Orders");
  });

  it('leaves the hand unknown when no list is given', () => {
    const boards = deriveBoardStates(
      log([turn(['misty drew 7 cards for the opening hand.'], { 0: ['- 7 drawn cards.'] })])
    );
    expect(boards[0].misty.hand.size).toBe(7);
    expect(boards[0].misty.hand.known).toEqual([]);
  });
});

describe('real fixture invariants', () => {
  it('holds every zone invariant across the whole match', () => {
    const parsed = parseBattleLog(
      battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI'
    );
    const boards = deriveBoardStates(parsed);
    let previousDiscard = 0;

    for (const board of boards) {
      for (const player of Object.keys(board)) {
        const { hand, discard } = board[player];
        expect(hand.size).toBeGreaterThanOrEqual(0);
        expect(discard.size).toBeGreaterThanOrEqual(0);
        expect(hand.known.length).toBeLessThanOrEqual(hand.size);
        expect(discard.known.length).toBeLessThanOrEqual(discard.size);
      }
      const total = Object.values(board).reduce((sum, b) => sum + b.discard.size, 0);
      expect(total).toBeGreaterThanOrEqual(previousDiscard);
      previousDiscard = total;
    }
  });

  it('knows the analysed player opening hand from the fixture', () => {
    const parsed = parseBattleLog(
      battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI'
    );
    const boards = deriveBoardStates(parsed);
    expect(boards[0].Bassoonboy135.hand.known.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/board-state-discard.test.ts`
Expected: FAIL — the discard zone stays empty

- [ ] **Step 3: Add the discard patterns**

In `deriveBoardStates`, add to the `RE` object:

```ts
    discardedFromPokemonCount: new RegExp(`^(\\d+) cards? were discarded from (${who})${APOS}s (.+)\\.$`),
    discardedFromPokemonNamed: new RegExp(`^(.+) was discarded from (${who})${APOS}s (.+)\\.$`),
    openingHand: new RegExp(`^(${who}) drew (\\d+) cards for the opening hand\\.`),
```

Note `openingHand` has no `$`: one log writes the whole thing on a single line as
`… for the opening hand. - 7 drawn cards.`

- [ ] **Step 4: Handle the discard events**

In `applyLine`, insert immediately before the `// --- hand ---` block, so a
discard from a Pokémon is matched before the plainer hand patterns:

```ts
    // --- discard ------------------------------------------------------------
    // Count form before named form: "3 cards were discarded from …" would
    // otherwise be recorded as a card named "3 cards".

    m = line.match(RE.discardedFromPokemonCount);
    if (m) { addUnknown(state[m[2]].discard, Number(m[1])); return; }

    m = line.match(RE.discardedFromPokemonNamed);
    if (m) { addKnown(state[m[2]].discard, m[1]); return; }
```

- [ ] **Step 5: Add the action-level opening-hand hook**

Every other event is decidable from a single line. The opening hand is not — the
card list lives in the action's `details`, and the two logs format it
differently. Add this helper inside `deriveBoardStates`, directly above the
existing `return battleLog.sections.map(...)`:

```ts
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
    const names = details
      .map((d) => d.replace(/^[\s\-•]+/, '').trim())
      .filter((d) => d.includes(','))
      .map((d) => d.split(',').map((n) => n.trim()).filter(Boolean))
      .find((list) => list.length === count);

    if (names) {
      for (const name of names) addKnown(player.hand, name);
    } else {
      addUnknown(player.hand, count);
    }
    return true;
  };
```

- [ ] **Step 6: Route actions through the hook**

Replace the existing per-section loop:

```ts
  return battleLog.sections.map((section) => {
    for (const action of section.actions) {
      // The opening hand consumes its own details, so skip the flat pass for it.
      if (applyOpeningHand(action.title, action.details)) continue;
      applyLine(action.title);
      for (const detail of action.details) applyLine(detail);
    }
    return cloneState(state);
  });
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/board-state-discard.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 8: Confirm nothing regressed**

Run: `npx jest __tests__/battle-logs/`
Expected: PASS — placement, hand, and discard suites all green.

- [ ] **Step 9: Commit**

```bash
git add components/battle-logs/utils/board-state.ts __tests__/battle-logs/board-state-discard.test.ts
git commit -m "Track discard piles and the opening hand"
```

---

### Task 4: Zone rendering

**Files:**
- Create: `components/battle-logs/Board/ZoneCards.tsx`
- Create: `components/battle-logs/Board/DiscardPile.tsx`
- Modify: `public/_gt/de.json`, `public/_gt/es.json`, `public/_gt/fr.json`, `public/_gt/ja.json`
- Test: `__tests__/battle-logs/ZoneCards.test.tsx`

**Interfaces:**
- Consumes: `Zone` from Task 1; `LookupCard` from `app/api/ptcg/cards/lookup/route`
- Produces: `<ZoneCards zone cards limit? />`, `<DiscardPile zone cards />`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/ZoneCards.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (source: string) => source,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const { ZoneCards } =
  require('../../components/battle-logs/Board/ZoneCards') as typeof import('../../components/battle-logs/Board/ZoneCards');
const { DiscardPile } =
  require('../../components/battle-logs/Board/DiscardPile') as typeof import('../../components/battle-logs/Board/DiscardPile');

const cards = { Iono: { name: 'Iono', imageUrl: 'https://cdn.example/iono.png', hp: undefined } };

describe('ZoneCards', () => {
  it('renders known cards as art', () => {
    render(<ZoneCards zone={{ known: ['Iono'], size: 1 }} cards={cards} />);
    expect(screen.getByAltText('Iono').getAttribute('src')).toBe('https://cdn.example/iono.png');
  });

  it('renders one labelled placeholder per unknown card', () => {
    render(<ZoneCards zone={{ known: [], size: 3 }} cards={cards} />);
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(3);
    expect(screen.getAllByText('Unknown')).toHaveLength(3);
  });

  it('mixes known art with placeholders', () => {
    render(<ZoneCards zone={{ known: ['Iono'], size: 3 }} cards={cards} />);
    expect(screen.getByAltText('Iono')).toBeTruthy();
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(2);
  });

  it('falls back to the card name when the lookup has no image', () => {
    render(<ZoneCards zone={{ known: ['Mystery Card'], size: 1 }} cards={{}} />);
    expect(screen.getByText('Mystery Card')).toBeTruthy();
  });

  it('renders nothing for an empty zone', () => {
    const { container } = render(<ZoneCards zone={{ known: [], size: 0 }} cards={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('honours a display limit', () => {
    render(<ZoneCards zone={{ known: [], size: 10 }} cards={{}} limit={4} />);
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(4);
  });
});

describe('DiscardPile', () => {
  it('shows the count collapsed', () => {
    render(<DiscardPile zone={{ known: ['Iono'], size: 14 }} cards={cards} />);
    expect(screen.getByText(/14/)).toBeTruthy();
  });

  it('expands to the full pile on click', () => {
    render(<DiscardPile zone={{ known: [], size: 8 }} cards={cards} />);
    expect(screen.getAllByTestId('zone-unknown-card').length).toBeLessThan(8);
    fireEvent.click(screen.getByTestId('discard-toggle'));
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(8);
  });

  it('renders nothing when the pile is empty', () => {
    const { container } = render(<DiscardPile zone={{ known: [], size: 0 }} cards={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/ZoneCards.test.tsx`
Expected: FAIL — `Cannot find module '../../components/battle-logs/Board/ZoneCards'`

- [ ] **Step 3: Write ZoneCards**

Create `components/battle-logs/Board/ZoneCards.tsx`:

```tsx
'use client';

import Image from 'next/image';
import { useGT } from 'gt-react';
import type { Zone } from '../utils/zone';
import { unknownCount } from '../utils/zone';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

const INTRINSIC_WIDTH = 292;
const INTRINSIC_HEIGHT = 408;
const CARD_SHAPE = 'aspect-[63/88] rounded-md';
const SLOT = 'w-12 lg:w-14 xl:w-16';

interface ZoneCardsProps {
  zone: Zone;
  cards: Record<string, LookupCard>;
  /** Render at most this many cards. Unset renders the whole zone. */
  limit?: number;
}

/**
 * A hand or discard pile: named cards as art, the rest as labelled placeholders.
 *
 * The placeholder count is the zone's own arithmetic — `size` minus the cards we
 * could name — so an identity we failed to track shows up as one more face-down
 * card rather than a wrong one.
 */
export function ZoneCards({ zone, cards, limit }: ZoneCardsProps) {
  const gt = useGT();
  if (zone.size === 0) return null;

  const cap = limit ?? zone.size;
  const known = zone.known.slice(0, cap);
  const unknown = Math.max(0, Math.min(unknownCount(zone), cap - known.length));

  return (
    <div className="flex flex-wrap items-end gap-1 lg:gap-1.5">
      {known.map((name, index) => {
        const card = cards[name];
        return (
          <div key={`${name}-${index}`} className={SLOT} title={name}>
            {card?.imageUrl ? (
              <Image
                src={card.imageUrl}
                alt={name}
                width={INTRINSIC_WIDTH}
                height={INTRINSIC_HEIGHT}
                sizes="64px"
                className={`h-auto w-full ${CARD_SHAPE} object-cover`}
              />
            ) : (
              <div
                className={`w-full ${CARD_SHAPE} flex items-center justify-center border bg-muted p-0.5 text-center text-[8px] leading-tight`}
              >
                {name}
              </div>
            )}
          </div>
        );
      })}

      {Array.from({ length: unknown }, (_, index) => (
        <div
          key={`unknown-${index}`}
          data-testid="zone-unknown-card"
          className={`${SLOT} ${CARD_SHAPE} flex items-center justify-center border border-dashed border-muted-foreground/40 bg-muted/40 text-[7px] font-medium uppercase tracking-wide text-muted-foreground lg:text-[8px]`}
        >
          {gt('Unknown', { $id: 'battleLogs.board.unknown' })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write DiscardPile**

Create `components/battle-logs/Board/DiscardPile.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useGT } from 'gt-react';
import type { Zone } from '../utils/zone';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';
import { ZoneCards } from './ZoneCards';

/** Enough to see what just went to the pile without dwarfing the board above. */
const COLLAPSED_LIMIT = 5;

export function DiscardPile({ zone, cards }: { zone: Zone; cards: Record<string, LookupCard> }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);

  if (zone.size === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        data-testid="discard-toggle"
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {gt('Discard', { $id: 'battleLogs.board.discard' })} ({zone.size})
      </button>
      <ZoneCards zone={zone} cards={cards} limit={expanded ? undefined : COLLAPSED_LIMIT} />
    </div>
  );
}
```

- [ ] **Step 5: Add the translation keys**

Add these three keys to **each** of `public/_gt/de.json`, `es.json`, `fr.json`,
`ja.json`, in sorted position among the existing `battleLogs.board.*` keys. The
diff for each locale file must be additions only.

de.json:
```json
  "battleLogs.board.discard": "Ablagestapel",
  "battleLogs.board.hand": "Hand",
  "battleLogs.board.unknown": "Unbekannt",
```

es.json:
```json
  "battleLogs.board.discard": "Descarte",
  "battleLogs.board.hand": "Mano",
  "battleLogs.board.unknown": "Desconocida",
```

fr.json:
```json
  "battleLogs.board.discard": "Defausse",
  "battleLogs.board.hand": "Main",
  "battleLogs.board.unknown": "Inconnue",
```

ja.json:
```json
  "battleLogs.board.discard": "トラッシュ",
  "battleLogs.board.hand": "手札",
  "battleLogs.board.unknown": "不明",
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/ZoneCards.test.tsx`
Expected: PASS, 9 tests

- [ ] **Step 7: Verify translations align**

Run: `npm run translations:check`
Expected: `Translation files are present and aligned for 4 locales.`

- [ ] **Step 8: Commit**

```bash
git add components/battle-logs/Board/ZoneCards.tsx components/battle-logs/Board/DiscardPile.tsx public/_gt __tests__/battle-logs/ZoneCards.test.tsx
git commit -m "Render a card zone as known art plus Unknown placeholders"
```

---

### Task 5: Mount the zones in the board

**Files:**
- Modify: `components/battle-logs/Board/BoardStateView.tsx`
- Modify: `components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx`
- Test: `__tests__/battle-logs/BoardStateView.test.tsx`

**Interfaces:**
- Consumes: `ZoneCards` and `DiscardPile` from Task 4; `PlayerBoard.hand`/`.discard` from Tasks 2–3
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Append to `__tests__/battle-logs/BoardStateView.test.tsx`:

```tsx
describe('BoardStateView zones', () => {
  const board = {
    ash: {
      active: { name: 'Drakloak', evolvedFrom: [], damage: 0, attachments: [] },
      bench: [],
      hand: { known: ['Iono'], size: 3 },
      discard: { known: [], size: 6 },
    },
  };
  const zoneCards = { Iono: { name: 'Iono', imageUrl: 'https://cdn.example/iono.png' } };

  it('renders the hand with placeholders for the unknown cards', () => {
    render(<BoardStateView board={board as any} cards={zoneCards as any} />);
    expect(screen.getByAltText('Iono')).toBeTruthy();
    expect(screen.getAllByTestId('zone-unknown-card').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the discard pile collapsed with its count', () => {
    render(<BoardStateView board={board as any} cards={zoneCards as any} />);
    expect(screen.getByTestId('discard-toggle').textContent).toContain('6');
  });

  it('omits both zones when they are empty', () => {
    const bare = {
      ash: { active: null, bench: [], hand: { known: [], size: 0 }, discard: { known: [], size: 0 } },
    };
    render(<BoardStateView board={bare as any} cards={{}} />);
    expect(screen.queryByTestId('discard-toggle')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/BoardStateView.test.tsx`
Expected: FAIL — no `zone-unknown-card` or `discard-toggle` in the output

- [ ] **Step 3: Mount the zones**

In `components/battle-logs/Board/BoardStateView.tsx`, add the imports:

```tsx
import { ZoneCards } from './ZoneCards';
import { DiscardPile } from './DiscardPile';
```

Extend `PlayerRow`'s props to accept the two zones:

```tsx
function PlayerRow({
  name,
  active,
  bench,
  hand,
  discard,
  cards,
}: {
  name: string;
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  hand: Zone;
  discard: Zone;
  cards: Record<string, LookupCard>;
}) {
```

adding the type import at the top:

```tsx
import type { Zone } from '../utils/zone';
```

Then, inside `PlayerRow`, immediately after the closing `</div>` of the existing
active-and-bench row and before the component's closing `</div>`:

```tsx
      {hand.size > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {gt('Hand', { $id: 'battleLogs.board.hand' })} ({hand.size})
          </span>
          <ZoneCards zone={hand} cards={cards} />
        </div>
      )}
      <DiscardPile zone={discard} cards={cards} />
```

Finally pass the zones down where `PlayerRow` is rendered:

```tsx
        <PlayerRow
          key={playerName}
          name={playerName}
          active={playerBoard.active}
          bench={playerBoard.bench}
          hand={playerBoard.hand}
          discard={playerBoard.discard}
          cards={cards}
        />
```

- [ ] **Step 4: Include zone cards in the lookup**

In `components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx`, the
`cardNames` memo currently collects only active and bench names. Card art for the
hand and discard needs the same lookup, so extend the loop body inside
`for (const player of Object.values(board))`:

```tsx
          for (const name of player.hand.known) names.add(name);
          for (const name of player.discard.known) names.add(name);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/BoardStateView.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run: `npx jest --runInBand`
Expected: PASS. Report the actual total; the plan adds 47 tests to the current 262.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `7` — the pre-existing baseline.

- [ ] **Step 8: Production build**

Run: `NEXT_PUBLIC_SUPABASE_URL="https://pvjgmtrlmtnzmhqtifwa.supabase.co" NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder" npm run build`
Expected: `✓ Compiled successfully`

- [ ] **Step 9: Commit**

```bash
git add components/battle-logs/Board/BoardStateView.tsx components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx __tests__/battle-logs/BoardStateView.test.tsx
git commit -m "Show hands and discard piles on every turn"
```

---

## Manual verification

Deploy a preview and open the captured log at
`/ptcg/logs/919737c6-46e1-42a0-aa70-5f4516ce76cf` signed in as `dev@local`.

1. **Setup turn:** `pandapanada`'s hand shows seven named cards — the log lists
   them — while `lcdeno`'s shows seven Unknown placeholders.
2. Find a turn containing `- lcdeno drew Team Rocket's Tarountula.` and confirm
   that card appears face up in their hand.
3. Confirm each discard count only ever increases as you scroll later.
4. Click a `Discard (N)` toggle and confirm it expands to the full pile.
5. Confirm a non-English log still renders no zones and does not error.

## Known limitations, restated from the spec

Intended behaviour, not bugs to fix here:

- Non-English logs render no zones.
- The opponent's hand is mostly unknown by design.
- Deck and prize cards are out of scope; prize counts already show on the header.
- Drift shows as extra Unknown placeholders, never as a wrong card.
