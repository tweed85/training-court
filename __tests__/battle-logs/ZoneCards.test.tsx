import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('gt-react', () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useGT: () => (source: string) => source,
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const { ZoneCards } =
  require('../../components/battle-logs/Board/ZoneCards') as typeof import('../../components/battle-logs/Board/ZoneCards');
const { DiscardPile } =
  require('../../components/battle-logs/Board/DiscardPile') as typeof import('../../components/battle-logs/Board/DiscardPile');

const cards = { Iono: { name: 'Iono', imageUrl: 'https://cdn.example/iono.png', hp: undefined } };

describe('ZoneCards', () => {
  it('renders known cards as art', () => {
    render(<ZoneCards zone={{ known: ['Iono'], size: 1 }} cards={cards} />);
    expect(screen.getByAltText('Iono').getAttribute('src')).toBe('https://cdn.example/iono.png');
  });

  it('renders one labelled placeholder per unknown card', () => {
    render(<ZoneCards zone={{ known: [], size: 3 }} cards={cards} />);
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(3);
    expect(screen.getAllByText('Unknown')).toHaveLength(3);
  });

  it('mixes known art with placeholders', () => {
    render(<ZoneCards zone={{ known: ['Iono'], size: 3 }} cards={cards} />);
    expect(screen.getByAltText('Iono')).toBeTruthy();
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(2);
  });

  it('falls back to the card name when the lookup has no image', () => {
    render(<ZoneCards zone={{ known: ['Mystery Card'], size: 1 }} cards={{}} />);
    expect(screen.getByText('Mystery Card')).toBeTruthy();
  });

  it('renders nothing for an empty zone', () => {
    const { container } = render(<ZoneCards zone={{ known: [], size: 0 }} cards={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('honours a display limit', () => {
    render(<ZoneCards zone={{ known: [], size: 10 }} cards={{}} limit={4} />);
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(4);
  });
});

describe('DiscardPile', () => {
  it('shows the count collapsed', () => {
    render(<DiscardPile zone={{ known: ['Iono'], size: 14 }} cards={cards} />);
    expect(screen.getByText(/14/)).toBeTruthy();
  });

  it('expands to the full pile on click', () => {
    render(<DiscardPile zone={{ known: [], size: 8 }} cards={cards} />);
    expect(screen.getAllByTestId('zone-unknown-card').length).toBeLessThan(8);
    fireEvent.click(screen.getByTestId('discard-toggle'));
    expect(screen.getAllByTestId('zone-unknown-card')).toHaveLength(8);
  });

  it('renders nothing when the pile is empty', () => {
    const { container } = render(<DiscardPile zone={{ known: [], size: 0 }} cards={{}} />);
    expect(container.firstChild).toBeNull();
  });
});
