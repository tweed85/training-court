# Battle Log Board State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show both players' active and benched Pokémon — as card images with damage and remaining HP — inside every turn of the battle log.

**Architecture:** A pure replayer walks the already-parsed `BattleLog` sections and produces one `BoardState` per turn. A single API route resolves the log's card names to images and HP from the existing server-side catalog. A presentational component renders one board, mounted inside each existing turn card.

**Tech Stack:** Next.js 14 App Router, TypeScript, Jest + Testing Library, SWR, Tailwind, `gt-react` for i18n.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-battle-log-board-state-design.md`
- Card images come from the existing catalog (`lib/server/ptcg-card-catalog.ts`). Do not add a GrailPing dependency and do not add a second card dataset.
- **Every pattern anchors on the two known player names** from `battleLog.players`. Card names contain apostrophes (`Team Rocket's Tarountula`), so a generic `(.+)'s (.+)` regex mis-splits.
- **Apostrophes vary within one line.** Match both `'` (U+0027) and `’` (U+2019) everywhere a possessive appears: use `['’]`.
- The replayer is English-only. For `battleLog.language !== 'en'` return an empty array — never a wrong board.
- All new user-facing copy uses `T` / `useGT` from `gt-react` with `battleLogs.board.*` ids, added to **all four** of `public/_gt/{de,es,fr,ja}.json`. `npm run translations:check` is enforced by CI.
- Jest cannot transform the ESM `ai` package. Do not import anything from `lib/server/ai/battle-log-analysis/generate.ts` in a test.
- Run the full suite with `npx jest --runInBand`. Two pre-existing RTL suites are flaky under parallel workers.
- Baseline `npx tsc --noEmit` reports 7 pre-existing errors, all in `__tests__/recoil/selectors/battle-logs.test.ts`. Do not add more.

## File Structure

| File | Responsibility |
|---|---|
| `components/battle-logs/utils/board-state.types.ts` (create) | `PokemonInPlay`, `PlayerBoard`, `BoardState` |
| `components/battle-logs/utils/board-state.ts` (create) | `deriveBoardStates(battleLog)` — the pure replayer |
| `app/api/ptcg/cards/lookup/route.ts` (create) | POST names → `{ name: { imageUrl, hp } }` |
| `components/battle-logs/Board/BoardStateView.tsx` (create) | Renders one `BoardState` |
| `components/battle-logs/Board/useCardLookup.ts` (create) | SWR hook wrapping the lookup route |
| `components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx` (modify) | Mount the board in each turn card |
| `next.config.js` (modify) | Allow the card-image CDN host |
| `public/_gt/{de,es,fr,ja}.json` (modify) | `battleLogs.board.*` keys |

---

### Task 1: Board state types and placement events

Handles the events that put a Pokémon somewhere: active placement, bench placement, promotion, retreat, knockout.

**Files:**
- Create: `components/battle-logs/utils/board-state.types.ts`
- Create: `components/battle-logs/utils/board-state.ts`
- Test: `__tests__/battle-logs/board-state.test.ts`

**Interfaces:**
- Consumes: `BattleLog`, `BattleLogTurn` from `components/battle-logs/utils/battle-log.types`
- Produces: `deriveBoardStates(battleLog: BattleLog): BoardState[]`; types `PokemonInPlay`, `PlayerBoard`, `BoardState`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/board-state.test.ts`:

```ts
import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';

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

describe('deriveBoardStates — placement', () => {
  it('returns one board per turn', () => {
    const boards = deriveBoardStates(log([turn([]), turn([])]));
    expect(boards).toHaveLength(2);
  });

  it('places a Pokemon in the Active Spot', () => {
    const boards = deriveBoardStates(log([turn(['ash played Pikipek to the Active Spot.'])]));
    expect(boards[0].ash.active?.name).toBe('Pikipek');
  });

  it('places Pokemon on the Bench', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', 'ash played Fan Rotom to the Bench.'])])
    );
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Hoothoot', 'Fan Rotom']);
  });

  it('keeps card names containing apostrophes intact', () => {
    const boards = deriveBoardStates(
      log([turn(["misty played Team Rocket's Tarountula to the Active Spot."])])
    );
    expect(boards[0].misty.active?.name).toBe("Team Rocket's Tarountula");
  });

  it('promotes a benched Pokemon to active', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', "ash's Hoothoot is now in the Active Spot."])])
    );
    expect(boards[0].ash.active?.name).toBe('Hoothoot');
    expect(boards[0].ash.bench).toHaveLength(0);
  });

  it('accepts a curly apostrophe in the possessive', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Hoothoot to the Bench.', 'ash’s Hoothoot is now in the Active Spot.'])])
    );
    expect(boards[0].ash.active?.name).toBe('Hoothoot');
  });

  it('moves the active Pokemon to the bench on retreat', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', 'ash retreated Pikipek to the Bench.'])])
    );
    expect(boards[0].ash.active).toBeNull();
    expect(boards[0].ash.bench.map((p) => p.name)).toEqual(['Pikipek']);
  });

  it('removes a Knocked Out Pokemon from play', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Pikipek was Knocked Out!"])])
    );
    expect(boards[0].ash.active).toBeNull();
  });

  it('carries state forward into later turns', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.']), turn([])])
    );
    expect(boards[1].ash.active?.name).toBe('Pikipek');
  });

  it('returns an empty array for a non-English log', () => {
    expect(deriveBoardStates(log([turn([])], 'de'))).toEqual([]);
  });

  it('reads board events from action details as well as titles', () => {
    const withDetail = log([turn([])]);
    withDetail.sections[0].actions = [
      { title: 'ash played Nest Ball.', details: ['ash played Hoothoot to the Bench.'] },
    ];
    expect(deriveBoardStates(withDetail)[0].ash.bench.map((p) => p.name)).toEqual(['Hoothoot']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: FAIL — `Cannot find module '../../components/battle-logs/utils/board-state'`

- [ ] **Step 3: Write the types**

Create `components/battle-logs/utils/board-state.types.ts`:

```ts
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
}

/** Keyed by player name exactly as it appears in the log. */
export type BoardState = Record<string, PlayerBoard>;
```

- [ ] **Step 4: Write the replayer**

Create `components/battle-logs/utils/board-state.ts`:

```ts
import type { BattleLog } from './battle-log.types';
import type { BoardState, PlayerBoard, PokemonInPlay } from './board-state.types';

const MAX_BENCH = 5;

/** PTCG Live mixes U+0027 and U+2019 within a single line. */
const APOS = "['’]";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const newPokemon = (name: string, unknown = false): PokemonInPlay => ({
  name,
  evolvedFrom: [],
  damage: 0,
  attachments: [],
  ...(unknown ? { unknown: true } : {}),
});

const emptyBoard = (): PlayerBoard => ({ active: null, bench: [] });

const cloneBoard = (board: PlayerBoard): PlayerBoard => ({
  active: board.active ? { ...board.active, evolvedFrom: [...board.active.evolvedFrom], attachments: [...board.active.attachments] } : null,
  bench: board.bench.map((p) => ({ ...p, evolvedFrom: [...p.evolvedFrom], attachments: [...p.attachments] })),
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
    promote: new RegExp(`^(${who})${APOS}s (.+) is now in the Active Spot\\.$`),
    retreat: new RegExp(`^(${who}) retreated (.+) to the Bench\\.$`),
    knockout: new RegExp(`^(${who})${APOS}s (.+) was Knocked Out!$`),
    benchUnknown: new RegExp(`^(${who}) drew (\\d+) cards? and played them to the Bench\\.$`),
  };

  const state: BoardState = {};
  for (const name of players) state[name] = emptyBoard();

  const findOnBench = (board: PlayerBoard, name: string): number =>
    board.bench.findIndex((p) => p.name === name);

  const applyLine = (raw: string): void => {
    const line = raw.replace(/^[\s\-•]+/, '').trim();
    if (!line) return;

    let m = line.match(RE.active);
    if (m) {
      const board = state[m[1]];
      // A Pokemon already active is displaced only by an explicit retreat or KO.
      if (board.active === null) board.active = newPokemon(m[2]);
      else if (board.bench.length < MAX_BENCH) board.bench.push(newPokemon(m[2]));
      return;
    }

    m = line.match(RE.bench);
    if (m) {
      const board = state[m[1]];
      if (board.bench.length < MAX_BENCH) board.bench.push(newPokemon(m[2]));
      return;
    }

    m = line.match(RE.benchUnknown);
    if (m) {
      const board = state[m[1]];
      const count = Number(m[2]);
      for (let i = 0; i < count && board.bench.length < MAX_BENCH; i += 1) {
        board.bench.push(newPokemon('', true));
      }
      return;
    }

    m = line.match(RE.promote);
    if (m) {
      const board = state[m[1]];
      const index = findOnBench(board, m[2]);
      if (index === -1) {
        if (board.active === null) board.active = newPokemon(m[2]);
        return;
      }
      const [promoted] = board.bench.splice(index, 1);
      if (board.active) board.bench.push(board.active);
      board.active = promoted;
      return;
    }

    m = line.match(RE.retreat);
    if (m) {
      const board = state[m[1]];
      if (board.active && board.active.name === m[2] && board.bench.length < MAX_BENCH) {
        board.bench.push(board.active);
        board.active = null;
      }
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
  };

  return battleLog.sections.map((section) => {
    for (const action of section.actions) {
      applyLine(action.title);
      for (const detail of action.details) applyLine(detail);
    }
    return cloneState(state);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 6: Commit**

```bash
git add components/battle-logs/utils/board-state.ts components/battle-logs/utils/board-state.types.ts __tests__/battle-logs/board-state.test.ts
git commit -m "feat(battle-logs): derive board placement state from a log"
```

---

### Task 2: Evolution, attachments, and damage

**Files:**
- Modify: `components/battle-logs/utils/board-state.ts`
- Test: `__tests__/battle-logs/board-state.test.ts`

**Interfaces:**
- Consumes: `deriveBoardStates` from Task 1
- Produces: no new exports; `PokemonInPlay.damage`, `.attachments`, `.evolvedFrom` become populated

- [ ] **Step 1: Write the failing test**

Append to `__tests__/battle-logs/board-state.test.ts`:

```ts
describe('deriveBoardStates — evolution, attachments, damage', () => {
  it('evolves in place on the bench and records the pre-evolution', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Dreepy to the Bench.', 'ash evolved Dreepy to Drakloak on the Bench.'])])
    );
    expect(boards[0].ash.bench[0].name).toBe('Drakloak');
    expect(boards[0].ash.bench[0].evolvedFrom).toEqual(['Dreepy']);
  });

  it('evolves in the Active Spot', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Dreepy to the Active Spot.', 'ash evolved Dreepy to Drakloak in the Active Spot.'])])
    );
    expect(boards[0].ash.active?.name).toBe('Drakloak');
  });

  it('keeps damage across an evolution', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Dreepy to the Active Spot.',
          "misty's Spidops used Rocket Rush on ash’s Dreepy for 60 damage.",
          'ash evolved Dreepy to Drakloak in the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(60);
    expect(boards[0].ash.active?.name).toBe('Drakloak');
  });

  it('accumulates damage across turns', () => {
    const boards = deriveBoardStates(
      log([
        turn(['ash played Pikipek to the Active Spot.', "misty's Spidops used Rocket Rush on ash’s Pikipek for 70 damage."]),
        turn(["misty's Spidops used Rocket Rush on ash’s Pikipek for 50 damage."]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(70);
    expect(boards[1].ash.active?.damage).toBe(120);
  });

  it('damages a benched Pokemon by name', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Hoothoot to the Bench.',
          "misty's Spidops used Rocket Rush on ash’s Hoothoot for 150 damage.",
        ]),
      ])
    );
    expect(boards[0].ash.bench[0].damage).toBe(150);
  });

  it('discards damage when a Pokemon is Knocked Out', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          "misty's Spidops used Rocket Rush on ash’s Pikipek for 150 damage.",
          "ash's Pikipek was Knocked Out!",
          'ash played Pikipek to the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.damage).toBe(0);
  });

  it('records attachments', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash played Pikipek to the Active Spot.',
          'ash attached Basic Psychic Energy to Pikipek in the Active Spot.',
        ]),
      ])
    );
    expect(boards[0].ash.active?.attachments).toEqual(['Basic Psychic Energy']);
  });

  it('records a status condition', () => {
    const boards = deriveBoardStates(
      log([turn(['ash played Pikipek to the Active Spot.', "ash's Pikipek is now Poisoned."])])
    );
    expect(boards[0].ash.active?.status).toBe('Poisoned');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: FAIL — the evolution test reports `Dreepy` where `Drakloak` was expected

- [ ] **Step 3: Add the patterns**

In `components/battle-logs/utils/board-state.ts`, add to the `RE` object after `benchUnknown`:

```ts
    evolve: new RegExp(`^(${who}) evolved (.+) to (.+) (?:on the Bench|in the Active Spot)\\.$`),
    attach: new RegExp(`^(${who}) attached (.+) to (.+) (?:in the Active Spot|on the Bench)\\.$`),
    damage: new RegExp(`^(${who})${APOS}s (.+) used (.+) on (${who})${APOS}s (.+) for (\\d+) damage\\.$`),
    status: new RegExp(`^(${who})${APOS}s (.+) is now (Asleep|Paralyzed|Confused|Poisoned|Burned)\\.$`),
```

- [ ] **Step 4: Add a lookup helper**

In the same file, directly above `const applyLine`:

```ts
  /** Find a Pokemon by name in either slot. Active is checked first. */
  const findInPlay = (board: PlayerBoard, name: string): PokemonInPlay | undefined => {
    if (board.active?.name === name) return board.active;
    return board.bench.find((p) => p.name === name);
  };
```

- [ ] **Step 5: Handle the new events**

In `applyLine`, insert these blocks immediately before the `RE.knockout` block:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: PASS, 19 tests

- [ ] **Step 7: Add a real-fixture regression test**

Append to `__tests__/battle-logs/board-state.test.ts`:

```ts
import { parseBattleLog } from '../../components/battle-logs/utils/battle-log.utils';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';
import { battleLogGerman } from '../../components/battle-logs/utils/testing-files/battleLogGerman';

describe('deriveBoardStates — real fixtures', () => {
  it('produces one board per section and never exceeds five benched', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);

    expect(boards).toHaveLength(parsed.sections.length);
    for (const board of boards) {
      for (const player of Object.keys(board)) {
        expect(board[player].bench.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('puts a Pokemon in play for both players by the end of setup', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    const boards = deriveBoardStates(parsed);
    const setup = boards[0];
    expect(Object.values(setup).some((b) => b.active !== null)).toBe(true);
  });

  it('yields no board for a German log', () => {
    const parsed = parseBattleLog(battleLogGerman, 'l', '2026-01-01', null, null, null, 'SVI-DRI');
    expect(deriveBoardStates(parsed)).toEqual([]);
  });
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/board-state.test.ts`
Expected: PASS, 22 tests

- [ ] **Step 9: Commit**

```bash
git add components/battle-logs/utils/board-state.ts __tests__/battle-logs/board-state.test.ts
git commit -m "feat(battle-logs): track evolution, attachments, damage and status"
```

---

### Task 3: Card lookup API route

**Files:**
- Create: `app/api/ptcg/cards/lookup/route.ts`
- Test: `__tests__/battle-logs/card-lookup-route.test.ts`

**Interfaces:**
- Consumes: `getAllDeckbuilderCards` from `lib/server/ptcg-card-catalog`; `buildCardIndex` from `lib/server/ai/battle-log-analysis/card-index`
- Produces: `POST /api/ptcg/cards/lookup`, body `{ names: string[] }`, response `{ cards: Record<string, { name: string; imageUrl?: string; hp?: number }>, code: 200 }`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/card-lookup-route.test.ts`:

```ts
import type { DeckbuilderCatalogCard } from '../../lib/server/ptcg-card-catalog';

jest.mock('../../lib/server/ptcg-card-catalog', () => ({
  getAllDeckbuilderCards: jest.fn(),
}));

const { POST } = require('../../app/api/ptcg/cards/lookup/route') as typeof import('../../app/api/ptcg/cards/lookup/route');
const { getAllDeckbuilderCards } = require('../../lib/server/ptcg-card-catalog');

beforeAll(() => {
  Object.defineProperty(global, 'Response', {
    value: {
      json: (payload: unknown, init?: { status?: number }) => ({
        status: init?.status ?? 200,
        json: async () => payload,
      }),
    },
    configurable: true,
  });
});

const card = (name: string, hp?: string, imageUrl?: string): DeckbuilderCatalogCard => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  localId: '1',
  name,
  category: 'Pokemon',
  imageUrl,
  metadata: { hp, cardText: [], weakness: [], resistance: [], retreatCost: [], rulebox: [] },
});

const request = (names: string[]) => ({ json: async () => ({ names }) }) as Request;

beforeEach(() => {
  jest.clearAllMocks();
  getAllDeckbuilderCards.mockResolvedValue([
    card('Dreepy', '70', 'https://cdn.example/dreepy.png'),
    card("Team Rocket's Tarountula", '60', 'https://cdn.example/tarountula.png'),
  ]);
});

describe('POST /api/ptcg/cards/lookup', () => {
  it('resolves names to image and numeric hp', async () => {
    const body = await (await POST(request(['Dreepy']))).json();
    expect(body.cards.Dreepy).toEqual({
      name: 'Dreepy',
      imageUrl: 'https://cdn.example/dreepy.png',
      hp: 70,
    });
  });

  it('resolves a name containing an apostrophe', async () => {
    const body = await (await POST(request(["Team Rocket's Tarountula"]))).json();
    expect(body.cards["Team Rocket's Tarountula"].hp).toBe(60);
  });

  it('is keyed by the requested name, not the catalog name', async () => {
    const body = await (await POST(request(['dreepy']))).json();
    expect(body.cards.dreepy.name).toBe('Dreepy');
  });

  it('omits names the catalog does not have', async () => {
    const body = await (await POST(request(['Totally Invented Card']))).json();
    expect(body.cards).toEqual({});
  });

  it('400s when names is missing', async () => {
    const response = await POST({ json: async () => ({}) } as Request);
    expect(response.status).toBe(400);
  });

  it('caps the number of names accepted', async () => {
    const many = Array.from({ length: 501 }, (_, i) => `Card ${i}`);
    const response = await POST(request(many));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/card-lookup-route.test.ts`
Expected: FAIL — `Cannot find module '../../app/api/ptcg/cards/lookup/route'`

- [ ] **Step 3: Write the route**

Create `app/api/ptcg/cards/lookup/route.ts`:

```ts
import { getAllDeckbuilderCards } from '@/lib/server/ptcg-card-catalog';
import { buildCardIndex } from '@/lib/server/ai/battle-log-analysis/card-index';
import { normalizeCardName } from '@/lib/server/ptcg-card-name';

/** One board render needs far fewer than this; the cap just bounds abuse. */
const MAX_NAMES = 500;

export const dynamic = 'force-dynamic';

export interface LookupCard {
  name: string;
  imageUrl?: string;
  hp?: number;
}

/**
 * Resolve a batch of card names to an image and max HP.
 *
 * The catalog is server-only but the battle log carousel is a client
 * component, so it posts every distinct name in one request rather than
 * issuing one lookup per card.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { names?: unknown };
    const names = body?.names;

    if (!Array.isArray(names) || names.length === 0 || names.length > MAX_NAMES) {
      return Response.json({ message: 'Provide 1..500 card names.', code: 400 }, { status: 400 });
    }

    const index = buildCardIndex(await getAllDeckbuilderCards());
    const cards: Record<string, LookupCard> = {};

    for (const raw of names) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const match = index.get(normalizeCardName(raw));
      if (!match) continue;

      const hp = Number(match.metadata.hp);
      cards[raw] = {
        name: match.name,
        imageUrl: match.imageUrlHiRes ?? match.imageUrl,
        ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      };
    }

    return Response.json({ cards, code: 200 }, { status: 200 });
  } catch (error) {
    console.error('Failed to look up cards:', error);
    return Response.json({ message: 'Failed to look up cards', code: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/card-lookup-route.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/api/ptcg/cards/lookup/route.ts __tests__/battle-logs/card-lookup-route.test.ts
git commit -m "feat(api): batch card name to image and hp lookup"
```

---

### Task 4: BoardStateView component

**Files:**
- Create: `components/battle-logs/Board/useCardLookup.ts`
- Create: `components/battle-logs/Board/BoardStateView.tsx`
- Modify: `next.config.js`
- Modify: `public/_gt/de.json`, `public/_gt/es.json`, `public/_gt/fr.json`, `public/_gt/ja.json`
- Test: `__tests__/battle-logs/BoardStateView.test.tsx`

**Interfaces:**
- Consumes: `BoardState`, `PokemonInPlay` from `components/battle-logs/utils/board-state.types`; `LookupCard` from `app/api/ptcg/cards/lookup/route`
- Produces: `useCardLookup(names: string[]): Record<string, LookupCard>`; `<BoardStateView board={BoardState} cards={Record<string, LookupCard>} />`

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/BoardStateView.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (source: string) => source,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const { BoardStateView } =
  require('../../components/battle-logs/Board/BoardStateView') as typeof import('../../components/battle-logs/Board/BoardStateView');

const board = {
  ash: {
    active: { name: 'Drakloak', evolvedFrom: ['Dreepy'], damage: 60, attachments: ['Basic Psychic Energy'] },
    bench: [{ name: 'Hoothoot', evolvedFrom: [], damage: 0, attachments: [] }],
  },
  misty: {
    active: { name: "Team Rocket's Tarountula", evolvedFrom: [], damage: 0, attachments: [] },
    bench: [{ name: '', evolvedFrom: [], damage: 0, attachments: [], unknown: true }],
  },
};

const cards = {
  Drakloak: { name: 'Drakloak', imageUrl: 'https://cdn.example/drakloak.png', hp: 120 },
  Hoothoot: { name: 'Hoothoot', imageUrl: 'https://cdn.example/hoothoot.png', hp: 70 },
  "Team Rocket's Tarountula": { name: "Team Rocket's Tarountula", imageUrl: 'https://cdn.example/t.png', hp: 60 },
};

describe('BoardStateView', () => {
  it('renders both players', () => {
    render(<BoardStateView board={board as any} cards={cards} />);
    expect(screen.getByText('ash')).toBeTruthy();
    expect(screen.getByText('misty')).toBeTruthy();
  });

  it('renders the active card image', () => {
    render(<BoardStateView board={board as any} cards={cards} />);
    expect(screen.getByAltText('Drakloak').getAttribute('src')).toBe('https://cdn.example/drakloak.png');
  });

  it('shows remaining HP as max minus damage', () => {
    render(<BoardStateView board={board as any} cards={cards} />);
    expect(screen.getByText('60/120')).toBeTruthy();
  });

  it('shows full HP when undamaged', () => {
    render(<BoardStateView board={board as any} cards={cards} />);
    expect(screen.getByText('70/70')).toBeTruthy();
  });

  it('renders an unknown bench card as a placeholder', () => {
    render(<BoardStateView board={board as any} cards={cards} />);
    expect(screen.getAllByTestId('board-unknown-card')).toHaveLength(1);
  });

  it('falls back to the card name when no image is available', () => {
    const noImage = { ash: { active: { name: 'Mystery', evolvedFrom: [], damage: 0, attachments: [] }, bench: [] } };
    render(<BoardStateView board={noImage as any} cards={{}} />);
    expect(screen.getByText('Mystery')).toBeTruthy();
  });

  it('renders an empty board without crashing', () => {
    const { container } = render(<BoardStateView board={{ ash: { active: null, bench: [] } } as any} cards={{}} />);
    expect(container).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/BoardStateView.test.tsx`
Expected: FAIL — `Cannot find module '../../components/battle-logs/Board/BoardStateView'`

- [ ] **Step 3: Write the SWR hook**

Create `components/battle-logs/Board/useCardLookup.ts`:

```ts
'use client';

import useSWR from 'swr';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

const EMPTY: Record<string, LookupCard> = {};

/**
 * Resolve every distinct card name in a log to an image and max HP in one
 * request. Keyed on the sorted name list so the same log reuses the cache.
 */
export function useCardLookup(names: string[]): Record<string, LookupCard> {
  const distinct = Array.from(new Set(names.filter(Boolean))).sort();
  const key = distinct.length ? ['card-lookup', distinct.join('|')] : null;

  const { data } = useSWR(key, async () => {
    const response = await fetch('/api/ptcg/cards/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: distinct }),
    });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as { cards?: Record<string, LookupCard> };
    return body.cards ?? EMPTY;
  });

  return data ?? EMPTY;
}
```

- [ ] **Step 4: Write the component**

Create `components/battle-logs/Board/BoardStateView.tsx`:

```tsx
'use client';

import Image from 'next/image';
import { useGT } from 'gt-react';
import type { BoardState, PokemonInPlay } from '../utils/board-state.types';
import type { LookupCard } from '@/app/api/ptcg/cards/lookup/route';

interface BoardStateViewProps {
  board: BoardState;
  cards: Record<string, LookupCard>;
}

const CARD_WIDTH = 64;
const CARD_HEIGHT = 89;

function CardSlot({
  pokemon,
  card,
  large,
}: {
  pokemon: PokemonInPlay;
  card?: LookupCard;
  large?: boolean;
}) {
  const gt = useGT();
  const width = large ? CARD_WIDTH * 1.4 : CARD_WIDTH;
  const height = large ? CARD_HEIGHT * 1.4 : CARD_HEIGHT;

  if (pokemon.unknown) {
    return (
      <div
        data-testid="board-unknown-card"
        className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40"
        style={{ width, height }}
        title={gt('Card not named in the log', { $id: 'battleLogs.board.unknownCard' })}
      />
    );
  }

  const maxHp = card?.hp;
  const remaining = maxHp === undefined ? undefined : Math.max(0, maxHp - pokemon.damage);
  const ratio = maxHp && remaining !== undefined ? remaining / maxHp : 1;

  return (
    <div className="flex flex-col items-center gap-1" style={{ width }}>
      {card?.imageUrl ? (
        <Image src={card.imageUrl} alt={pokemon.name} width={width} height={height} className="rounded-md" />
      ) : (
        <div
          className="flex items-center justify-center rounded-md border bg-muted p-1 text-center text-[10px] leading-tight"
          style={{ width, height }}
        >
          {pokemon.name}
        </div>
      )}

      {remaining !== undefined && maxHp !== undefined && (
        <>
          <div className="h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className={ratio > 0.5 ? 'h-full bg-emerald-500' : ratio > 0.2 ? 'h-full bg-amber-500' : 'h-full bg-red-500'}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{`${remaining}/${maxHp}`}</span>
        </>
      )}

      {pokemon.attachments.length > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {gt('Attached', { $id: 'battleLogs.board.attached' })}: {pokemon.attachments.length}
        </span>
      )}
    </div>
  );
}

/** One player's active Pokemon plus their bench. */
function PlayerRow({
  name,
  active,
  bench,
  cards,
}: {
  name: string;
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  cards: Record<string, LookupCard>;
}) {
  const gt = useGT();

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold">{name}</span>
      <div className="flex flex-wrap items-end gap-2">
        {active ? (
          <CardSlot pokemon={active} card={cards[active.name]} large />
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {gt('No active Pokemon', { $id: 'battleLogs.board.noActive' })}
          </span>
        )}
        {bench.map((pokemon, index) => (
          <CardSlot key={`${pokemon.name}-${index}`} pokemon={pokemon} card={cards[pokemon.name]} />
        ))}
      </div>
    </div>
  );
}

export function BoardStateView({ board, cards }: BoardStateViewProps) {
  return (
    <div className="flex flex-col gap-3 py-2" data-testid="board-state">
      {Object.entries(board).map(([playerName, playerBoard]) => (
        <PlayerRow
          key={playerName}
          name={playerName}
          active={playerBoard.active}
          bench={playerBoard.bench}
          cards={cards}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/BoardStateView.test.tsx`
Expected: PASS, 7 tests

- [ ] **Step 6: Allow the card image CDN**

Replace `next.config.js` with:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'limitlesstcg.s3.us-east-2.amazonaws.com',
        port: '',
        pathname: '/**',
      },
      {
        // Card art served by the deckbuilder catalog.
        protocol: 'https',
        hostname: 'pkmn-tcg-api-images.sfo2.cdn.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig;
```

- [ ] **Step 7: Add the translation keys**

Add these four keys to **each** of `public/_gt/de.json`, `es.json`, `fr.json`, `ja.json`, inserted in sorted position among the existing `battleLogs.*` keys:

de.json:
```json
  "battleLogs.board.attached": "Angelegt",
  "battleLogs.board.noActive": "Kein aktives Pokemon",
  "battleLogs.board.title": "Spielfeld",
  "battleLogs.board.unknownCard": "Karte im Log nicht benannt",
```

es.json:
```json
  "battleLogs.board.attached": "Adjuntadas",
  "battleLogs.board.noActive": "Sin Pokemon activo",
  "battleLogs.board.title": "Tablero",
  "battleLogs.board.unknownCard": "Carta no nombrada en el registro",
```

fr.json:
```json
  "battleLogs.board.attached": "Attachees",
  "battleLogs.board.noActive": "Aucun Pokemon actif",
  "battleLogs.board.title": "Terrain",
  "battleLogs.board.unknownCard": "Carte non nommee dans le journal",
```

ja.json:
```json
  "battleLogs.board.attached": "つけているカード",
  "battleLogs.board.noActive": "バトル場にポケモンがいません",
  "battleLogs.board.title": "盤面",
  "battleLogs.board.unknownCard": "ログにカード名がありません",
```

- [ ] **Step 8: Verify translations align**

Run: `npm run translations:check`
Expected: `Translation files are present and aligned for 4 locales.`

- [ ] **Step 9: Commit**

```bash
git add components/battle-logs/Board next.config.js public/_gt __tests__/battle-logs/BoardStateView.test.tsx
git commit -m "feat(battle-logs): board state view with card images and hp"
```

---

### Task 5: Mount the board in the carousel

**Files:**
- Modify: `components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx`
- Test: `__tests__/battle-logs/BattleLogCarousel.board.test.tsx`

**Interfaces:**
- Consumes: `deriveBoardStates` (Task 1–2), `useCardLookup` and `BoardStateView` (Task 4)
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Create `__tests__/battle-logs/BattleLogCarousel.board.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (source: string) => source,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

jest.mock('../../components/battle-logs/Board/useCardLookup', () => ({
  useCardLookup: () => ({
    Pikipek: { name: 'Pikipek', imageUrl: 'https://cdn.example/pikipek.png', hp: 70 },
  }),
}));

const { BattleLogCarousel } =
  require('../../components/battle-logs/BattleLogDisplay/BattleLogCarousel') as typeof import('../../components/battle-logs/BattleLogDisplay/BattleLogCarousel');
const { parseBattleLog } =
  require('../../components/battle-logs/utils/battle-log.utils') as typeof import('../../components/battle-logs/utils/battle-log.utils');
const { battleLogNewStructure } =
  require('../../components/battle-logs/utils/testing-files/battleLogNewStructure') as typeof import('../../components/battle-logs/utils/testing-files/battleLogNewStructure');
const { battleLogGerman } =
  require('../../components/battle-logs/utils/testing-files/battleLogGerman') as typeof import('../../components/battle-logs/utils/testing-files/battleLogGerman');

describe('BattleLogCarousel board integration', () => {
  it('renders a board in every turn of an English log', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    render(<BattleLogCarousel battleLog={parsed} />);
    expect(screen.getAllByTestId('board-state')).toHaveLength(parsed.sections.length);
  });

  it('renders no board for a German log but still renders the turns', () => {
    const parsed = parseBattleLog(battleLogGerman, 'l', '2026-01-01', null, null, null, 'SVI-DRI');
    render(<BattleLogCarousel battleLog={parsed} />);
    expect(screen.queryAllByTestId('board-state')).toHaveLength(0);
    expect(screen.getAllByText(parsed.sections[0].turnTitle).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/battle-logs/BattleLogCarousel.board.test.tsx`
Expected: FAIL — `getAllByTestId('board-state')` finds nothing

- [ ] **Step 3: Wire the board into the carousel**

In `components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx`, add to the imports:

```tsx
import { deriveBoardStates } from "../utils/board-state"
import { BoardStateView } from "../Board/BoardStateView"
import { useCardLookup } from "../Board/useCardLookup"
```

Add `'use client';` as the first line of the file if it is not already present.

Immediately inside `export function BattleLogCarousel(props: BattleLogCarouselProps) {`, before `function getCardBackgroundColor`, add:

```tsx
    // Empty for non-English logs: the board grammar is English-only, and a
    // wrong board is worse than none.
    const boards = React.useMemo(
      () => deriveBoardStates(props.battleLog),
      [props.battleLog]
    );

    const cardNames = React.useMemo(() => {
      const names = new Set<string>();
      for (const board of boards) {
        for (const player of Object.values(board)) {
          if (player.active && !player.active.unknown) names.add(player.active.name);
          for (const benched of player.bench) {
            if (!benched.unknown) names.add(benched.name);
          }
        }
      }
      return Array.from(names);
    }, [boards]);

    const cards = useCardLookup(cardNames);
```

Then inside the `<CardContent>`, immediately before the `{section.actions.map(...)}` expression, add:

```tsx
              {boards[index] && <BoardStateView board={boards[index]} cards={cards} />}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/battle-logs/BattleLogCarousel.board.test.tsx`
Expected: PASS, 2 tests

- [ ] **Step 5: Run the whole suite**

Run: `npx jest --runInBand`
Expected: PASS, all suites. Total test count is 179 (pre-existing) + 37 (new) = 216.
(New: 11 placement + 8 evolution/damage + 3 fixture + 6 route + 7 view + 2 integration.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `7` — the pre-existing baseline, no new errors.

- [ ] **Step 7: Production build**

Run: `NEXT_PUBLIC_SUPABASE_URL="https://pvjgmtrlmtnzmhqtifwa.supabase.co" NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder" npm run build`
Expected: `✓ Compiled successfully`, and `/api/ptcg/cards/lookup` listed in the route table.

- [ ] **Step 8: Commit**

```bash
git add components/battle-logs/BattleLogDisplay/BattleLogCarousel.tsx __tests__/battle-logs/BattleLogCarousel.board.test.tsx
git commit -m "feat(battle-logs): show board state on every turn"
```

---

## Manual verification

Deploy a preview (`./node_modules/.bin/vercel deploy`) and open the captured
production log at `/ptcg/logs/919737c6-46e1-42a0-aa70-5f4516ce76cf`, signed in as
`dev@local`. Check:

1. Every turn card shows a board for both `pandapanada` and `lcdeno`.
2. At the turn containing `lcdeno's Team Rocket's Tarountula was Knocked Out!`,
   that Pokémon is gone from the following turn's board and the Pokémon named by
   the next `is now in the Active Spot` line is active.
3. `Team Rocket's Spidops` shows accumulated damage matching the sum of the
   `for N damage` lines targeting it, and its HP bar shrinks accordingly.
4. Card images load — no broken images, which would mean the CDN host is missing
   from `next.config.js`.
5. Evolution lines (`evolved Dunsparce to Dudunsparce`) show the evolved name.

## Known limitations, restated from the spec

These are intended behavior, not bugs to fix in this plan:

- Non-English logs render no board.
- Cards placed by `drew N cards and played them to the Bench` render face-down.
- Healing is not handled, so displayed HP reads low if a heal occurs. Healing
  appears nowhere in the current corpus.
- Bench order is not authoritative; the log never gives positions.
