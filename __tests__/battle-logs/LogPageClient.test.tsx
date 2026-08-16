import React from 'react';
import { render, screen } from '@testing-library/react';
import { battleLogNewStructure } from '../../components/battle-logs/utils/testing-files/battleLogNewStructure';

// The one admin id the premium gate accepts (components/admin/admin.utils.ts).
const OWNER_ID = '01a36333-aa26-47e1-bec6-bbdd596a7020';
const IMPERSONATOR_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let currentUser: { id: string } | null = { id: OWNER_ID };
let currentUserData: { live_screen_name: string | null } | null = {
  live_screen_name: 'Bassoonboy135',
};

jest.mock('recoil', () => ({
  useRecoilValue: (atom: { key: string }) => {
    if (atom.key === 'user') return currentUser;
    if (atom.key === 'authLoading') return false;
    if (atom.key === 'userData') return currentUserData;
    return null;
  },
}));

jest.mock('../../app/recoil/atoms/user', () => ({
  userAtom: { key: 'user' },
  authLoadingAtom: { key: 'authLoading' },
  userDataAtom: { key: 'userData' },
}));

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

let logRow: Record<string, unknown> | null = null;

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: logRow, isLoading: false }),
}));

jest.mock('../../utils/supabase/client', () => ({ createClient: jest.fn() }));

jest.mock('../../components/battle-logs/Notes/Notes', () => ({
  Notes: () => <div data-testid="notes" />,
}));
jest.mock('../../components/battle-logs/Analysis/MatchAnalysis', () => ({
  MatchAnalysis: () => <div data-testid="match-analysis" />,
}));
jest.mock('../../components/battle-logs/BattleLogDisplay/BattleLogCarousel', () => ({
  BattleLogCarousel: () => <div data-testid="carousel" />,
}));
jest.mock('../../components/archetype/sprites/Sprite', () => ({ Sprite: () => <span /> }));

const { LogPageClient } =
  require('../../components/battle-logs/BattleLogDisplay/LogPageClient') as typeof import('../../components/battle-logs/BattleLogDisplay/LogPageClient');

const LOG_ROW = {
  id: 'log-1',
  user: OWNER_ID,
  log: battleLogNewStructure,
  created_at: '2026-01-01T00:00:00Z',
  archetype: 'gholdengo',
  opp_archetype: 'dragapult',
  decklist_id: null,
  notes: null,
  format: 'SVI-DRI',
};

beforeEach(() => {
  logRow = LOG_ROW;
  currentUser = { id: OWNER_ID };
  currentUserData = { live_screen_name: 'Bassoonboy135' };
});

describe('LogPageClient — private panel gating', () => {
  it('shows Notes and Analysis to the user who owns the row', () => {
    render(<LogPageClient logId="log-1" />);

    expect(screen.getByTestId('notes')).toBeTruthy();
    expect(screen.getByTestId('match-analysis')).toBeTruthy();
  });

  /**
   * Screen names are self-assigned, so gating on one meant anybody could set
   * theirs to another player's PTCGL handle and have both private panels render
   * on that person's public log. The API 404s and RLS blocks the note write, so
   * nothing leaked — but the panels have no business being there.
   */
  it('hides them from a visitor whose screen name matches the logged player', () => {
    currentUser = { id: IMPERSONATOR_ID };
    currentUserData = { live_screen_name: 'Bassoonboy135' };

    render(<LogPageClient logId="log-1" />);

    expect(screen.queryByTestId('notes')).toBeNull();
    expect(screen.queryByTestId('match-analysis')).toBeNull();
  });

  it('hides them from a signed-out visitor', () => {
    currentUser = null;
    currentUserData = null;

    render(<LogPageClient logId="log-1" />);

    expect(screen.queryByTestId('notes')).toBeNull();
    expect(screen.queryByTestId('match-analysis')).toBeNull();
  });
});
