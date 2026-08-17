# Hands and discard piles in the battle log

## Context

Each turn of the battle log now shows both players' active and benched Pokémon.
The rest of the board is still invisible: what you were holding, what the
opponent was known to be holding, and what each player had burned through.

This adds three zones per player per turn — hand and discard, with the
opponent's hand partially known — so a turn can be read the way it was actually
played rather than inferred from the action list.

## The core problem: partial knowledge with no resync

The board replayer self-heals. The log states `X's Y is now in the Active Spot`,
an assertion of truth, so `promote` can be authoritative and any accumulated
drift is corrected on the next promotion.

**Hands and discards have no equivalent line.** Nothing in the log ever says
"the hand is now these cards". Once identity tracking drifts, it stays drifted
for the remainder of the match.

The design does not try to prevent drift. It makes drift degrade honestly:

```ts
interface Zone {
  /** Cards we can name, best-effort. */
  known: string[];
  /** Authoritative count, from explicit count lines. */
  size: number;
}
```

`size` and `known` are tracked independently. The view renders `size` cards, of
which `known.length` show real art and the remainder render an Unknown
placeholder. A missed identity therefore shows as one more face-down card, never
as a confidently wrong one.

The same mechanism produces the opponent-hand behaviour with no second code
path: their draws are mostly `drew a card` (size only), so their hand renders
mostly face-down, with real cards wherever the log leaked one.

## Grammar

Derived from a census across four English logs — the captured production log
plus the `battleLogNewStructure`, `battleLogNoPlayer2Turn` and
`battleLogRedactedPlayerNameError` fixtures. Counts are corpus totals.

### Hand additions

| Line | Effect |
|---|---|
| `P drew <Card>.` (44) | `known +1`, `size +1` |
| `P drew a card.` (26) | `size +1` |
| `P drew N cards.` (38) | `size +N` |
| `P drew N cards for the opening hand.` (5) | `size +N`; if the action's details carry a comma-separated list, `known += list` |
| `<Card> was added to P's hand.` | `known +1`, `size +1` |
| `A card was added to P's hand.` (6) | `size +1` |
| `P moved P's <Pokemon> to their hand.` (3) | `known +1`, `size +1` |

### Hand removals

| Line | Effect |
|---|---|
| `P played <Card>.` (94) | `known −1` if present, `size −1` |
| `P attached <Card> to …` (23) | `known −1`, `size −1` |
| `P played <Pokemon> to the Bench/Active Spot.` | `size −1` |
| `P discarded <Card>.` (11) | hand `−1`; discard `+1` named |
| `P discarded N cards.` (4) | hand `size −N`; discard `size +N` |
| `P shuffled N cards into their deck.` (15) | `size −N`, drop `N` from `known` |
| `P put N cards on the bottom of their deck.` (6) | `size −N` |
| **`P shuffled their hand.` (8)** | **hand emptied** — `known = []`, `size = 0` |

### Discard additions

| Line | Effect |
|---|---|
| `<Card> was discarded from P's <Pokemon>.` | `known +1`, `size +1` |
| `N cards were discarded from P's <Pokemon>.` | `size +N` |

`P shuffled their hand.` is the single most important line here. It is Iono and
Judge, it appears eight times across the corpus, and it appears **zero times** in
the captured production log. A grammar written from that log alone would leave
the hand permanently wrong after the first disruption card of the match — the
same class of mistake that made the board replayer wrong on its own fixture.

## Two parsing traps

**`A card` is capitalised.** A naive named-card pattern
(`^[A-Z].* was added to P's hand`) matches `A card was added to lcdeno's hand`
and would record a card literally named "A card". The unnamed form must be
tested first, or excluded explicitly.

**The opening hand needs action-level context.** The card list lives in the
action's `details`, and the two logs format it differently:

```
real log:  "pandapanada drew 7 cards for the opening hand."
             details: ["- 7 drawn cards.", "• Boss's Orders, Drakloak, …"]

fixture:   "Bassoonboy135 drew 7 cards for the opening hand. - 7 drawn cards."
             details: ["Luxray V, Rare Candy, Mimikyu, …"]
```

Every other event is decidable from one line. This one is not, so the replayer
must expose an action-level hook rather than processing title and details as a
flat sequence.

## Reconciliation rules

Invariants enforced after every event, so no arithmetic error can render
nonsense:

- `size` is clamped at zero and never negative.
- `known.length` is clamped to `size`; the oldest entries drop first.
- A removal naming a card absent from `known` still decrements `size`.
- Removing an unnamed card drops the oldest `known` entry only when
  `known.length === size`; otherwise it reduces `size` alone, preferring to
  convert a known card into an unknown rather than delete the wrong identity.

## Architecture

Three units, each testable alone.

**1. `zone.ts`** — the `Zone` type and its pure operations (`addKnown`,
`addUnknown`, `removeKnown`, `removeUnknown`, `clear`), carrying every
reconciliation rule above. No knowledge of logs or regexes.

**2. `board-state.ts`** — extended with the grammar. `PlayerBoard` gains
`hand: Zone` and `discard: Zone`. Placement events already work and are
untouched. `applyLine` gains the hand and discard shapes; a new action-level
pass handles the opening hand.

**3. `HandView` / `DiscardView`** — presentational, mounted in `BoardStateView`
beneath the existing board. Hand renders as a card row. Discard renders
collapsed as `Discard (14)` with the most recent thumbnails, expanding on click.

The Unknown placeholder is CSS-drawn in the existing 63:88 shape, muted, labelled
"Unknown" — the same treatment already used for unnamed bench Pokémon, extended
with a label. No new asset and no new image host.

## Known limitations

Stated in the UI, not hidden:

- **English only**, like the existing replayer. Non-English logs render no zones.
- **The opponent's hand is mostly unknown by design.** That is the truth of the
  format, not a gap to close.
- **Deck and prize cards are out of scope.** Prize *counts* already render on the
  turn header.
- **Drift is possible and shows as extra unknowns.** An unhandled line shape
  makes the hand read more face-down than it should, never wrong.

## Testing

- `zone.ts`: every reconciliation rule, including clamping at zero, `known`
  exceeding `size`, and removing a card that was never known.
- Grammar: one test per line shape in the table, using the exact text from the
  corpus.
- `A card was added to P's hand` must not produce a card named "A card".
- `P shuffled their hand.` empties the hand and subsequent draws refill it.
- Opening hand: both detail formats populate `known`.
- Fixture regression: derive the full match for `battleLogNewStructure` and
  assert the analysed player's hand size never goes negative, `known.length`
  never exceeds `size`, and the discard only grows.
- Non-English logs still yield no zones.

## Verification

1. `npx jest --runInBand`, `npx tsc --noEmit` at the 7-error baseline,
   `npm run translations:check`.
2. On the deployed preview, open the captured log as `dev@local` and check the
   opening turn: your hand shows the seven named cards from the log's own list,
   the opponent's shows seven face-down Unknown cards.
3. Find a turn where the opponent draws a named card and confirm it appears face
   up in their hand.
4. Confirm the discard count only ever increases across turns.
