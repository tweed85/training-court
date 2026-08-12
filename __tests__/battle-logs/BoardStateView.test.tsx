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
  },
  misty: {
    active: { name: "Team Rocket's Tarountula", evolvedFrom: [], damage: 0, attachments: [] },
    bench: [{ name: '', evolvedFrom: [], damage: 0, attachments: [], unknown: true }],
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
    const noImage = { ash: { active: { name: 'Mystery', evolvedFrom: [], damage: 0, attachments: [] }, bench: [] } };
    render(<BoardStateView board={noImage as any} cards={{}} />);
    expect(screen.getByText('Mystery')).toBeTruthy();
  });

  it('renders an empty board without crashing', () => {
    const { container } = render(<BoardStateView board={{ ash: { active: null, bench: [] } } as any} cards={{}} />);
    expect(container).toBeTruthy();
  });
});
