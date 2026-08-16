import type { DeckbuilderCatalogCard } from '../../lib/server/ptcg-card-catalog';

jest.mock('../../lib/server/ptcg-card-catalog', () => ({
  getAllDeckbuilderCards: jest.fn(),
}));

const { POST } = require('../../app/api/ptcg/cards/lookup/route') as typeof import('../../app/api/ptcg/cards/lookup/route');
const { getAllDeckbuilderCards } = require('../../lib/server/ptcg-card-catalog');

beforeAll(() => {
  Object.defineProperty(global, 'Response', {
    value: {
      json: (payload: unknown, init?: { status?: number }) => ({
        status: init?.status ?? 200,
        json: async () => payload,
      }),
    },
    configurable: true,
  });
});

const card = (name: string, hp?: string, imageUrl?: string): DeckbuilderCatalogCard => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  localId: '1',
  name,
  category: 'Pokemon',
  imageUrl,
  metadata: { hp, cardText: [], weakness: [], resistance: [], retreatCost: [], rulebox: [] },
});

const request = (names: string[]) => ({ json: async () => ({ names }) }) as Request;

beforeEach(() => {
  jest.clearAllMocks();
  getAllDeckbuilderCards.mockResolvedValue([
    card('Dreepy', '70', 'https://cdn.example/dreepy.png'),
    card("Team Rocket's Tarountula", '60', 'https://cdn.example/tarountula.png'),
  ]);
});

describe('POST /api/ptcg/cards/lookup', () => {
  it('resolves names to image and numeric hp', async () => {
    const body = await (await POST(request(['Dreepy']))).json();
    expect(body.cards.Dreepy).toEqual({
      name: 'Dreepy',
      imageUrl: 'https://cdn.example/dreepy.png',
      hp: 70,
    });
  });

  it('resolves a name containing an apostrophe', async () => {
    const body = await (await POST(request(["Team Rocket's Tarountula"]))).json();
    expect(body.cards["Team Rocket's Tarountula"].hp).toBe(60);
  });

  it('is keyed by the requested name, not the catalog name', async () => {
    const body = await (await POST(request(['dreepy']))).json();
    expect(body.cards.dreepy.name).toBe('Dreepy');
  });

  it('omits names the catalog does not have', async () => {
    const body = await (await POST(request(['Totally Invented Card']))).json();
    expect(body.cards).toEqual({});
  });

  it('400s when names is missing', async () => {
    const response = await POST({ json: async () => ({}) } as Request);
    expect(response.status).toBe(400);
  });

  it('caps the number of names accepted', async () => {
    const many = Array.from({ length: 501 }, (_, i) => `Card ${i}`);
    const response = await POST(request(many));
    expect(response.status).toBe(400);
  });
});
