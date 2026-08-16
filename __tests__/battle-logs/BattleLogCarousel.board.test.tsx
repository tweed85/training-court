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

jest.mock('../../components/battle-logs/Board/useCardLookup', () => ({
  useCardLookup: () => ({
    Pikipek: { name: 'Pikipek', imageUrl: 'https://cdn.example/pikipek.png', hp: 70 },
  }),
}));

const { BattleLogCarousel } =
  require('../../components/battle-logs/BattleLogDisplay/BattleLogCarousel') as typeof import('../../components/battle-logs/BattleLogDisplay/BattleLogCarousel');
const { parseBattleLog } =
  require('../../components/battle-logs/utils/battle-log.utils') as typeof import('../../components/battle-logs/utils/battle-log.utils');
const { battleLogNewStructure } =
  require('../../components/battle-logs/utils/testing-files/battleLogNewStructure') as typeof import('../../components/battle-logs/utils/testing-files/battleLogNewStructure');
const { battleLogGerman } =
  require('../../components/battle-logs/utils/testing-files/battleLogGerman') as typeof import('../../components/battle-logs/utils/testing-files/battleLogGerman');

describe('BattleLogCarousel board integration', () => {
  it('renders a board in every turn of an English log', () => {
    const parsed = parseBattleLog(battleLogNewStructure, 'l', '2026-01-01', null, null, 'Bassoonboy135', 'SVI-DRI');
    render(<BattleLogCarousel battleLog={parsed} />);
    expect(screen.getAllByTestId('board-state')).toHaveLength(parsed.sections.length);
  });

  it('renders no board for a German log but still renders the turns', () => {
    const parsed = parseBattleLog(battleLogGerman, 'l', '2026-01-01', null, null, null, 'SVI-DRI');
    render(<BattleLogCarousel battleLog={parsed} />);
    expect(screen.queryAllByTestId('board-state')).toHaveLength(0);
    expect(screen.getAllByText(parsed.sections[0].turnTitle).length).toBeGreaterThan(0);
  });
});
