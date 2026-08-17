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

  // The count pattern insists on "were", so the singular line reaches the named
  // pattern and used to record a card literally called "1 card".
  it('a single card discarded from a Pokemon is not a card named "1 card"', () => {
    const boards = deriveBoardStates(log([turn(["1 card was discarded from ash's Pikipek."])]));
    expect(boards[0].ash.discard).toEqual({ known: [], size: 1 });
  });

  // The named-discard pattern only guards against digits, so the written-out
  // count used to become a card called "a card".
  it('an unnamed discard from hand is not a card named "a card"', () => {
    const boards = deriveBoardStates(log([turn(['ash drew 3 cards.', 'ash discarded a card.'])]));
    expect(boards[0].ash.discard).toEqual({ known: [], size: 1 });
    expect(boards[0].ash.hand).toEqual({ known: [], size: 2 });
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
