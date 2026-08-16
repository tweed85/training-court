# Board state images per turn in the battle log

## Context

The battle log detail page renders each turn as a list of text actions. A reader
has to hold the board in their head to follow the match. This adds a visual board
to every turn — both players' active and benched Pokémon as card images, with
damage and remaining HP — so a match can be followed at a glance.

The AI match analysis feature already cites turns ("on T7 you played Iono").
A visible board at each turn makes those citations checkable.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Card images | Reuse the existing catalog | `lib/server/ptcg-card-catalog.ts` already serves `imageUrl`/`imageUrlHiRes` for every card and the deckbuilder renders them today |
| Fidelity | Active + bench, with damage and HP | Damage is logged explicitly with named targets; max HP comes from `metadata.hp` |
| Placement | Inline in each turn card | Reads naturally while scrolling; no new route |
| TCGVibes | Borrow the state model only | Its engine simulates rules a replayer doesn't need |
| Simulation | Out of scope | Display only; the replayer's output is the natural input if it comes later |

### Why not GrailPing

The request suggested sourcing card images from the GrailPing database. Training
Court already has them — verified live against the deployment:

```
Dreepy → https://pkmn-tcg-api-images.sfo2.cdn.digitaloceanspaces.com/…/dreepy%20158.png
```

Using GrailPing would put a second Supabase project's credentials in this app and
a production database for a different product in the request path, for images
already being served. `card-index.ts` (built for the analysis feature) already
resolves log card names to catalog cards.

### Why not vendor the TCGVibes engine

`tweed85/TCGVibes` is a forward game simulator — 28,664 lines across `effects`,
`trainerEffects`, `abilities`, `ai`. It contains no PTCGL log parsing, so the
replayer must be written regardless. Its `PokemonCard` requires structured
`attacks: Attack[]` and `hp: number`, which the catalog (`cardText: string[]`,
`hp?: string`) cannot supply. It also carries its own dataset filtered to
regulation marks H/I/J — Standard-only, so older logs would lose images — and its
own Limitless CDN with hand-maintained set-code translation tables.

What transfers is the **state shape** from `src/engine/types/core.ts`, trimmed to
what a replayer can actually know.

## Architecture

Four units, each independently testable.

### 1. `components/battle-logs/utils/board-state.ts` — the replayer

A pure function. No network, no DB.

```ts
deriveBoardStates(battleLog: BattleLog): BoardState[]   // one per section
```

State model, borrowed from TCGVibes and trimmed. Fields it drops are ones a log
reader cannot observe (`deck`, `hand`, `prizes` as cards, turn-scoped rule flags):

```ts
interface PokemonInPlay {
  name: string;
  evolvedFrom: string[];      // pre-evolution stack, e.g. ['Dreepy','Drakloak']
  damage: number;
  attachments: string[];      // energy and tools, by card name
  status?: string;            // 'Poisoned' etc., when logged
  unknown?: boolean;          // placed by a line that named no card
}

interface PlayerBoard { active: PokemonInPlay | null; bench: PokemonInPlay[] }
type BoardState = Record<string, PlayerBoard>;   // keyed by player name
```

**Event grammar** (all verified present in a real log):

| Line | Effect |
|---|---|
| `X played Y to the Active Spot.` | set active |
| `X played Y to the Bench.` | push bench |
| `X evolved A to B on the Bench.` / `in the Active Spot.` | rename in place, push `A` onto `evolvedFrom`, **keep damage** |
| `X's Y is now in the Active Spot.` | promote from bench (this is how post-KO promotion is logged) |
| `X retreated Y to the Bench.` | active → bench |
| `X's Y was Knocked Out!` | remove from play (damage discarded with it) |
| `X attached E to Y in the Active Spot/on the Bench.` | push to `attachments` |
| `A's P used ATK on B's Q for N damage.` | `Q.damage += N` |
| `X drew N cards and played them to the Bench.` | push N `unknown: true` entries |

Damage persists across evolution, which matches the real game.

### 2. `app/api/ptcg/cards/lookup/route.ts` — name → image/HP

The catalog is server-only; `BattleLogCarousel` is a client component. This route
takes the log's distinct card names in one POST and returns
`{ name → { imageUrl, hp } }`, resolved with the existing `buildCardIndex` and
`normalizeCardName`. One request per log, SWR-cached — not one per card.

Follows the auth-free shape of the sibling `app/api/ptcg/cards/search` route.

### 3. `components/battle-logs/Analysis/BoardStateView.tsx`

Renders one `BoardState`: each player's active card larger, bench in a row, each
with an HP bar (`maxHp - damage`) and attachment count. Unknown cards render as
face-down placeholders. Uses `next/image`, so
`pkmn-tcg-api-images.sfo2.cdn.digitaloceanspaces.com` must be added to
`next.config.js` — only the Limitless S3 host is allowed today.

### 4. Wiring

`BattleLogCarousel` calls `deriveBoardStates(battleLog)` once, fetches the name
map via SWR, and renders `<BoardStateView>` inside each existing turn `Card`
above the action list.

## Known limitations

Stated in the UI, not hidden:

- **English only.** The parser supports six languages; this grammar is English.
  Non-English logs render no board rather than a wrong one.
- **Unnamed bench plays.** `X drew 2 cards and played them to the Bench` names
  nothing — rendered face-down.
- **Healing drifts HP high.** Healing appears nowhere in the current corpus
  (one `damage counters`, one `is now Poisoned` across the real log and all six
  fixtures), so it is not handled. If a heal occurs, displayed HP reads low.
- **Bench order is not authoritative.** The log does not give positions.

## Testing

Unit tests against the real fixtures in `components/battle-logs/utils/testing-files/`
plus the captured production log:

- Every board-affecting line type applies correctly in isolation
- Evolution preserves damage; knockout removes the Pokémon entirely
- Promotion after a knockout moves the right Pokémon from bench to active
- Bench never exceeds five; active is null only before setup completes
- Damage accumulates across turns and matches the log's own totals
- Non-English fixtures produce empty boards, not wrong ones
- Route test: one POST resolves many names, unknown names omitted

## Verification

1. `npm test` and `npx tsc --noEmit`
2. `npm run translations:check` — new `battleLogs.board.*` keys in all four locales
3. Open the captured production log on the deployment and check the board at a
   turn where a knockout happens: the KO'd Pokémon leaves, the promoted one
   becomes active, and damage on the survivors matches the log's numbers
4. Confirm a non-English fixture renders no board and does not error
