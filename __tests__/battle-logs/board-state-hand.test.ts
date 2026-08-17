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
