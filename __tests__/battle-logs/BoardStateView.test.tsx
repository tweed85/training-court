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
    hand: { known: [], size: 0 },
    discard: { known: [], size: 0 },
  },
  misty: {
    active: { name: "Team Rocket's Tarountula", evolvedFrom: [], damage: 0, attachments: [] },
    bench: [{ name: '', evolvedFrom: [], damage: 0, attachments: [], unknown: true }],
    hand: { known: [], size: 0 },
    discard: { known: [], size: 0 },
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
    const noImage = {
      ash: {
        active: { name: 'Mystery', evolvedFrom: [], damage: 0, attachments: [] },
        bench: [],
        hand: { known: [], size: 0 },
        discard: { known: [], size: 0 },
      },
    };
    render(<BoardStateView board={noImage as any} cards={{}} />);
    expect(screen.getByText('Mystery')).toBeTruthy();
  });

  it('renders an empty board without crashing', () => {
    const { container } = render(
      <BoardStateView
        board={
          {
            ash: {
              active: null,
              bench: [],
              hand: { known: [], size: 0 },
              discard: { known: [], size: 0 },
            },
          } as any
        }
        cards={{}}
      />
    );
    expect(container).toBeTruthy();
  });
});

describe('BoardStateView attachment chips', () => {
  const withAttachments = (attachments: string[]) => ({
    ash: {
      active: { name: 'Drakloak', evolvedFrom: [], damage: 0, attachments },
      bench: [],
      hand: { known: [], size: 0 },
      discard: { known: [], size: 0 },
    },
  });
  const cards = { Drakloak: { name: 'Drakloak', imageUrl: 'https://cdn.example/d.png', hp: 120 } };

  it('renders no chip group when nothing is attached', () => {
    render(<BoardStateView board={withAttachments([]) as any} cards={cards} />);
    expect(screen.queryByTestId('attachment-chips')).toBeNull();
  });

  it('shows the TCG shorthand letter for a basic energy', () => {
    render(<BoardStateView board={withAttachments(['Basic Psychic Energy']) as any} cards={cards} />);
    expect(screen.getByTitle('Basic Psychic Energy').textContent).toBe('P');
  });

  it('uses R for fire, matching decklist shorthand rather than F', () => {
    render(<BoardStateView board={withAttachments(['Basic Fire Energy']) as any} cards={cards} />);
    expect(screen.getByTitle('Basic Fire Energy').textContent).toBe('R');
  });

  it('marks a special energy with S rather than a type letter', () => {
    render(<BoardStateView board={withAttachments(["Team Rocket's Energy"]) as any} cards={cards} />);
    expect(screen.getByTitle("Team Rocket's Energy").textContent).toBe('S');
  });

  it('renders a tool without a letter, so shape carries the distinction', () => {
    render(<BoardStateView board={withAttachments(['Brave Bangle']) as any} cards={cards} />);
    expect(screen.getByTitle('Brave Bangle').textContent).toBe('');
  });

  it('names every attachment in the group label for screen readers', () => {
    render(
      <BoardStateView board={withAttachments(['Basic Fire Energy', 'Brave Bangle']) as any} cards={cards} />
    );
    expect(screen.getByTestId('attachment-chips').getAttribute('aria-label')).toContain(
      'Basic Fire Energy, Brave Bangle'
    );
  });

  it('collapses past four attachments into an overflow chip', () => {
    const many = ['Basic Fire Energy', 'Basic Grass Energy', 'Basic Water Energy', 'Brave Bangle', 'Sparkling Crystal'];
    render(<BoardStateView board={withAttachments(many) as any} cards={cards} />);
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByTitle('Sparkling Crystal')).toBeTruthy();
  });
});

describe('BoardStateView zones', () => {
  const board = {
    ash: {
      active: { name: 'Drakloak', evolvedFrom: [], damage: 0, attachments: [] },
      bench: [],
      hand: { known: ['Iono'], size: 3 },
      discard: { known: [], size: 6 },
    },
  };
  const zoneCards = { Iono: { name: 'Iono', imageUrl: 'https://cdn.example/iono.png' } };

  it('renders the hand with placeholders for the unknown cards', () => {
    render(<BoardStateView board={board as any} cards={zoneCards as any} />);
    expect(screen.getByAltText('Iono')).toBeTruthy();
    expect(screen.getAllByTestId('zone-unknown-card').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the discard pile collapsed with its count', () => {
    render(<BoardStateView board={board as any} cards={zoneCards as any} />);
    expect(screen.getByTestId('discard-toggle').textContent).toContain('6');
  });

  it('omits both zones when they are empty', () => {
    const bare = {
      ash: { active: null, bench: [], hand: { known: [], size: 0 }, discard: { known: [], size: 0 } },
    };
    render(<BoardStateView board={bare as any} cards={{}} />);
    expect(screen.queryByTestId('discard-toggle')).toBeNull();
  });
});
