import type { BattleLog, BattleLogTurn } from '../../components/battle-logs/utils/battle-log.types';
import { deriveBoardStates } from '../../components/battle-logs/utils/board-state';
import { parseBattleLog } from '../../components/battle-logs/utils/battle-log.utils';
import { battleLogNoPlayer2Turn } from '../../components/battle-logs/utils/testing-files/battleLogNoPlayer2Turn';
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

  // PTCGL puts the prize take and the hand addition on one physical line, which
  // defeats the ^-anchored unnamed pattern and lets the named one's greedy
  // capture eat the first sentence.
  it('does not fold a preceding sentence into an unnamed addition', () => {
    const h = hand(["ash took a Prize card. A card was added to ash's hand."]);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(1);
  });

  it('does not fold a preceding sentence into a named addition', () => {
    const h = hand(["ash took a Prize card. Iono was added to ash's hand."]);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(1);
  });

  // The sentence-break guard keys on period-space, so a period inside the name
  // itself must still resolve face-up.
  it('still names a card whose own name carries a period', () => {
    expect(hand(["Mime Jr. was added to ash's hand."]).known).toEqual(['Mime Jr.']);
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

  // "ash discarded a card." slips past the count pattern, which needs a digit.
  it('does not invent a card named "a card"', () => {
    const h = hand(['ash drew 3 cards.', 'ash discarded a card.']);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(2);
  });
});

describe('stadium plays', () => {
  // PTCGL prints the placement and then a plain play for the same card. Only
  // one of the two lines may spend a card out of the hand.
  it('leaves the arithmetic to the follow-up play line', () => {
    const h = hand([
      'ash drew 4 cards.',
      'ash drew Artazon.',
      'ash played Artazon to the Stadium spot.',
      'ash played Artazon.',
    ]);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(4);
  });

  // Without the follow-up we over-count by one. That is an extra face-down
  // card, which is the direction the whole zone split exists to fail in.
  it('drops the identity but not the count when no follow-up comes', () => {
    const h = hand(['ash drew 4 cards.', 'ash drew Artazon.', 'ash played Artazon to the Stadium spot.']);
    expect(h.known).toEqual([]);
    expect(h.size).toBe(5);
  });

  // Falling through to the plain play pattern captured "Artazon to the Stadium
  // spot" as the name, which removeKnown could never find: the count dropped
  // while the real Artazon kept rendering face-up in the hand.
  it('never strands the stadium card face-up in the hand', () => {
    const h = hand([
      'ash drew 4 cards.',
      'ash drew Artazon.',
      'ash drew Iono.',
      'ash played Artazon to the Stadium spot.',
    ]);
    expect(h.known).toEqual(['Iono']);
    expect(h.size).toBe(6);
  });
});

describe('knockouts stay out of the hand and discard', () => {
  it('a bench knockout touches the board only', () => {
    const boards = deriveBoardStates(
      log([
        turn([
          'ash drew 3 cards.',
          'ash played Hoothoot to the Bench.',
          "ash's Hoothoot was Knocked Out!",
        ]),
      ])
    );
    expect(boards[0].ash.bench).toEqual([]);
    expect(boards[0].ash.hand).toEqual({ known: [], size: 2 });
    expect(boards[0].ash.discard).toEqual({ known: [], size: 0 });
  });
});

describe('battleLogNoPlayer2Turn fixture', () => {
  const finalHand = () => {
    const parsed = parseBattleLog(battleLogNoPlayer2Turn, 'l', '2026-01-01', null, null, null);
    const boards = deriveBoardStates(parsed);
    return boards[boards.length - 1].player2.hand;
  };

  // The fixture's "player2 took a Prize card. A card was added to player2's
  // hand." used to land in the hand as a face-up card with that whole sentence
  // for a name, and got POSTed to the card-lookup route as one.
  it('never names a card after a sentence break', () => {
    const h = finalHand();
    expect(h.known).toEqual([]);
    expect(h.known).not.toContain("player2 took a Prize card. A card");
  });

  // The fixture also plays Artazon to the Stadium spot and then plays it, so
  // the hand used to drop by two for the one card.
  it('spends the stadium card exactly once', () => {
    expect(finalHand().size).toBe(5);
  });
});
