export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error('maxExclusive must be a positive integer');
    }
    return Math.floor(this.next() * maxExclusive);
  }
}

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type Card = {
  suit: Suit;
  rank: Rank;
};

const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function buildDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }

  return deck;
}

export function shuffleDeck(deck: Card[], rng: SeededRng): Card[] {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  return shuffled;
}
