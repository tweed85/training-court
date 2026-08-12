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
