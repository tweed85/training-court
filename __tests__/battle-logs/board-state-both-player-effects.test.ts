import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';

/**
 * Judge, Iono and Unfair Stamp act on both players, and PTCG Live prints both
 * players' halves under the *acting* player's name — the actor's line first.
 * Only the log owner's cards are ever itemised, so the bullet list rides
 * whichever half belongs to them.
 *
 * Reading the second half as a repeat of the first double-counts one player
 * and leaves the other untouched; reading its list as the actor's invents cards
 * in a hand that never held them.
 */
const action = (title: string, details: string[] = []) => ({ title, details });

const turn = (actions: { title: string; details: string[] }[]): BattleLogTurn => ({
  turnTitle: 'A Turn',
  body: '',
  player: 'ash',
  prizesAfterTurn: { ash: 6, misty: 6 },
  actions,
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

const stateOf = (actions: { title: string; details: string[] }[]) =>
  deriveBoardStates(log([turn(actions)]))[0];

describe('a both-player effect splits its two halves across the players', () => {
  it('gives the actor the first half and the opponent the second', () => {
    const board = stateOf([
      action('ash played Judge.', [
        '- ash drew 4 cards.',
        '   • Fan Rotom, Hoothoot, Dawn, Iono',
        '- ash drew 4 cards.',
      ]),
    ]);
    expect(board['ash'].hand.known).toEqual(['Fan Rotom', 'Hoothoot', 'Dawn', 'Iono']);
    expect(board['ash'].hand.size).toBe(4);
    // The second half is misty's draw, not a repeat of ash's.
    expect(board['misty'].hand.size).toBe(4);
    expect(board['misty'].hand.known).toEqual([]);
  });

  it('keeps the halves apart when the two counts differ', () => {
    const board = stateOf([
      action('ash played Judge.', [
        '- ash drew 4 cards.',
        '   • Fan Rotom, Hoothoot, Dawn, Iono',
        '- ash drew 6 cards.',
      ]),
    ]);
    expect(board['ash'].hand.size).toBe(4);
    expect(board['misty'].hand.size).toBe(6);
  });

  it('still reads the actor first when the opponent is the one acting', () => {
    // lcdeno plays Unfair Stamp: their own bare half prints first, and the
    // itemised half that follows is the log owner's.
    const board = stateOf([
      action('misty played Unfair Stamp.', [
        '- misty drew 5 cards.',
        '- misty drew 2 cards.',
        "   • Boss's Orders, Buddy-Buddy Poffin",
      ]),
    ]);
    expect(board['misty'].hand.size).toBe(5);
    expect(board['misty'].hand.known).toEqual([]);
    expect(board['ash'].hand.size).toBe(2);
    expect(board['ash'].hand.known).toEqual(["Boss's Orders", 'Buddy-Buddy Poffin']);
  });

  it('removes each half from the hand it belongs to', () => {
    const board = stateOf([
      action('ash played Professor.', [
        '- ash drew 4 cards.',
        '   • Judge, Iono, Arven, Nest Ball',
        '- ash drew 6 cards.',
      ]),
      action('ash played Judge.', [
        '- ash shuffled 3 cards into their deck.',
        '   • Iono, Arven, Nest Ball',
        '- ash shuffled 4 cards into their deck.',
      ]),
    ]);
    // ash: drew 4 named, played Judge, shuffled the other 3 back.
    expect(board['ash'].hand.size).toBe(0);
    // misty: drew 6, shuffled 4 back. Booking both shuffles against ash would
    // leave this at 6, so the count is what proves the split.
    expect(board['misty'].hand.size).toBe(2);
  });

  it('keeps the halves aligned when the first list is refused', () => {
    // A list that disagrees with its count is untrustworthy, but it still
    // occupies a line. Treating it as absent hides misty's half behind it.
    const board = stateOf([
      action('ash played Judge.', [
        '- ash drew 4 cards.',
        '   • Fan Rotom, Iono',
        '- ash drew 4 cards.',
      ]),
    ]);
    expect(board['ash'].hand.size).toBe(4);
    expect(board['ash'].hand.known).toEqual([]);
    expect(board['misty'].hand.size).toBe(4);
  });

  it('pairs a one-card draw, which PTCGL spells without a digit', () => {
    const board = stateOf([
      action('ash played Iono.', ['- ash drew a card.', '- ash drew a card.']),
    ]);
    expect(board['ash'].hand.size).toBe(1);
    expect(board['misty'].hand.size).toBe(1);
  });

  it('pairs a one-card draw with a counted one', () => {
    // Iono draws each player their remaining prize count, so the two halves
    // routinely differ in shape as well as in number.
    const board = stateOf([
      action('ash played Iono.', ['- ash drew a card.', '- ash drew 4 cards.']),
    ]);
    expect(board['ash'].hand.size).toBe(1);
    expect(board['misty'].hand.size).toBe(4);
  });

  it('does not pair two bench placements, which are never a both-player effect', () => {
    const board = stateOf([
      action('ash played Poffin.', [
        '- ash drew 2 cards and played them to the Bench.',
        '- ash drew 2 cards and played them to the Bench.',
      ]),
    ]);
    expect(board['ash'].bench).toHaveLength(4);
    expect(board['misty'].bench).toHaveLength(0);
  });

  it('leaves a lone counted line with the player who is named', () => {
    // Discards are public, so an itemised list on a single line is genuinely
    // the named player's and must not be handed to their opponent.
    const board = stateOf([
      action('misty played Ultra Ball.', [
        '- misty discarded 2 cards.',
        "   • Team Rocket's Factory, Basic Grass Energy",
      ]),
    ]);
    expect(board['misty'].discard.known).toEqual([
      "Team Rocket's Factory",
      'Basic Grass Energy',
    ]);
    expect(board['ash'].discard.size).toBe(0);
  });

  it('does not pair two counted lines that name different players', () => {
    const board = stateOf([
      action('ash played Professor.', ['- ash drew 3 cards.', '- misty drew 2 cards.']),
    ]);
    expect(board['ash'].hand.size).toBe(3);
    expect(board['misty'].hand.size).toBe(2);
  });

  it('does not pair two counted lines with different verbs', () => {
    const board = stateOf([
      action('ash played Bug Catching Set.', [
        '- ash drew 2 cards.',
        '   • Arven, Nest Ball',
        '- ash shuffled 2 cards into their deck.',
        '   • Arven, Nest Ball',
      ]),
    ]);
    expect(board['ash'].hand.size).toBe(0);
    expect(board['misty'].hand.size).toBe(0);
  });
});

describe('a bullet list must look like card names', () => {
  it('rejects a damage breakdown that happens to follow a counted line', () => {
    const board = stateOf([
      action('ash used Attack.', [
        '- ash discarded 1 card.',
        '   • (Pokemon Tool) Brave Bangle: 30 damage',
      ]),
    ]);
    expect(board['ash'].discard.known).toEqual([]);
    expect(board['ash'].discard.size).toBe(1);
  });

  it('rejects a count-shaped breakdown line', () => {
    const board = stateOf([
      action('ash used Attack.', ['- ash drew 1 card.', '   • 5 Pokemon: 150 damage']),
    ]);
    expect(board['ash'].hand.known).toEqual([]);
    expect(board['ash'].hand.size).toBe(1);
  });

  it('accepts a real card name that carries a colon', () => {
    // "Type: Null" is a genuine card, so a colon cannot be what marks a
    // breakdown -- and one rejected name would discard the whole list.
    const board = stateOf([
      action('ash played Professor.', [
        '- ash drew 2 cards.',
        '   • Type: Null, Nest Ball',
      ]),
    ]);
    expect(board['ash'].hand.known).toEqual(['Type: Null', 'Nest Ball']);
  });
});

describe('publicly revealed KO discards keep their names', () => {
  it('names the cards a bulk discard from a Pokemon reveals', () => {
    const board = stateOf([
      action("ash's Pikipek was Knocked Out.", [
        "- 3 cards were discarded from ash's Pikipek.",
        '   • Rare Candy, Basic Fire Energy, Night Stretcher',
      ]),
    ]);
    expect(board['ash'].discard.known).toEqual([
      'Rare Candy',
      'Basic Fire Energy',
      'Night Stretcher',
    ]);
    expect(board['ash'].discard.size).toBe(3);
  });
});
