import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockToast = jest.fn();

jest.mock('../../components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// gt-react needs a provider; the identity shims keep these tests about behavior.
jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (source: string) => source,
}));

let swrData: unknown = undefined;
let swrLoading = false;
const mockMutate = jest.fn();

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: swrData, isLoading: swrLoading, mutate: mockMutate }),
}));

const { MatchAnalysis } =
  require('../../components/battle-logs/Analysis/MatchAnalysis') as typeof import('../../components/battle-logs/Analysis/MatchAnalysis');

const ANALYSIS = {
  matchSummary: {
    headline: 'Lost the prize race after an early Iono.',
    narrative: 'You fell behind on board development.',
    result: 'loss',
    turnOrder: 'first',
    decidingFactor: 'prize_race',
    confidence: 'medium',
  },
  turningPoints: [
    {
      turnNumber: 7,
      turnLabel: "Ash's Turn",
      whatHappened: 'You played Iono at four prizes.',
      whyItMattered: 'It refilled their hand.',
      swing: 'favor_opponent',
      cardsInvolved: ['Iono'],
    },
  ],
  tacticalSuggestions: [
    {
      turnNumber: 7,
      actualPlay: 'Played Iono.',
      suggestedPlay: "Boss's Orders on Fezandipiti ex takes the knockout.",
      cardsInvolved: ["Boss's Orders"],
      requiresSearchOrDraw: true,
      rationale: 'It removes their draw engine.',
      expectedImpact: 'major',
      confidence: 'high',
    },
  ],
  deckSuggestions: [
    {
      kind: 'swap',
      cardsIn: [{ name: 'Dusknoir', count: 1 }],
      cardsOut: [{ name: 'Nest Ball', count: 1 }],
      rationale: 'You bricked on setup twice.',
      confidence: 'medium',
    },
  ],
  notEnoughInformation: false,
};

const response = (overrides: Record<string, unknown> = {}) => ({
  status: 'succeeded',
  analysis: ANALYSIS,
  warnings: [],
  grounding: null,
  errorCode: null,
  stale: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  swrData = undefined;
  swrLoading = false;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => response(),
  }) as unknown as typeof fetch;
});

describe('MatchAnalysis', () => {
  it('renders an empty state with an Analyze button before anything is generated', () => {
    swrData = { status: 'none', analysis: null, warnings: [], stale: false };
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByTestId('match-analysis-generate').textContent).toContain('Analyze');
    expect(screen.getByText(/Get a turn-by-turn read/)).toBeTruthy();
  });

  it('renders the summary, turning points, and both suggestion kinds', () => {
    swrData = response();
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByText('Lost the prize race after an early Iono.')).toBeTruthy();
    expect(screen.getByText('You fell behind on board development.')).toBeTruthy();
    expect(screen.getByText(/Boss's Orders on Fezandipiti ex/)).toBeTruthy();
    expect(screen.getByTestId('deck-suggestions')).toBeTruthy();
    expect(screen.getByText('-1 Nest Ball → +1 Dusknoir')).toBeTruthy();
  });

  it('flags a suggestion that depends on drawing into the card', () => {
    swrData = response();
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByText('Depends on finding the card that turn.')).toBeTruthy();
  });

  it('shows a caution banner when grounding was low', () => {
    swrData = response({ warnings: [{ code: 'low_grounding' }] });
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByText(/could not be verified against the card database/)).toBeTruthy();
  });

  it('offers regeneration and dims the body when the analysis is stale', () => {
    swrData = response({ stale: true });
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByText(/Your deck or this log changed/)).toBeTruthy();
    expect(screen.getByTestId('match-analysis-generate').textContent).toContain('Regenerate');
  });

  it('notes when suggestions were withheld by the validator', () => {
    swrData = response({
      warnings: [{ code: 'suggestion_dropped', reason: 'unknown card', where: 'tactical' }],
    });
    render(<MatchAnalysis logId="log-1" />);

    expect(screen.getByText(/Some suggestions were withheld/)).toBeTruthy();
  });

  it('POSTs once and revalidates on click', async () => {
    swrData = { status: 'none', analysis: null, warnings: [], stale: false };
    render(<MatchAnalysis logId="log-1" />);

    fireEvent.click(screen.getByTestId('match-analysis-generate'));

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/battle-logs/log-1/analysis', {
      method: 'POST',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not fire a second POST while one is in flight', async () => {
    swrData = { status: 'none', analysis: null, warnings: [], stale: false };
    let release: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    ) as unknown as typeof fetch;

    render(<MatchAnalysis logId="log-1" />);
    const button = screen.getByTestId('match-analysis-generate');

    fireEvent.click(button);
    fireEvent.click(button);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    release({ ok: true, json: async () => response() });
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
  });

  it('surfaces a specific message when the screen name is missing', async () => {
    swrData = { status: 'none', analysis: null, warnings: [], stale: false };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'screen_name_missing' }),
    }) as unknown as typeof fetch;

    render(<MatchAnalysis logId="log-1" />);
    fireEvent.click(screen.getByTestId('match-analysis-generate'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'Set your PTCG Live screen name in preferences first.',
        })
      )
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limit message without crashing', async () => {
    swrData = { status: 'none', analysis: null, warnings: [], stale: false };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'gateway_rate_limited' }),
    }) as unknown as typeof fetch;

    render(<MatchAnalysis logId="log-1" />);
    fireEvent.click(screen.getByTestId('match-analysis-generate'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Too many requests right now. Try again shortly.',
        })
      )
    );

    // The button must come back so the user can retry.
    await waitFor(() =>
      expect((screen.getByTestId('match-analysis-generate') as HTMLButtonElement).disabled).toBe(
        false
      )
    );
  });

  it('renders nothing while the initial fetch is in flight', () => {
    swrLoading = true;
    const { container } = render(<MatchAnalysis logId="log-1" />);
    expect(container.firstChild).toBeNull();
  });
});
