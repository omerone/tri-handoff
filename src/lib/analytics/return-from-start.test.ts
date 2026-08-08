import { describe, expect, it } from 'vitest';
import { returnFromStart } from './metrics';

/**
 * The figure the equity curve's tooltip shows beside each balance.
 *
 * Most of what is worth asserting here is the cases where there is *no* honest answer. The
 * arithmetic itself is one subtraction and one division; what makes it a trap is a starting
 * balance of zero or below, where the same expression produces a number that renders happily
 * and means the opposite of what it says.
 */
describe('return from the starting balance', () => {
  it('reports the gain as a percentage of what the account opened with', () => {
    expect(returnFromStart(11_000, 10_000)).toBeCloseTo(10);
    expect(returnFromStart(12_500, 10_000)).toBeCloseTo(25);
  });

  it('reports a loss as a negative percentage', () => {
    expect(returnFromStart(9_000, 10_000)).toBeCloseTo(-10);
  });

  it('is zero at the starting balance itself', () => {
    expect(returnFromStart(10_000, 10_000)).toBe(0);
  });

  it('is independent of scale — the same move on a smaller account is the same percentage', () => {
    expect(returnFromStart(1_100, 1_000)).toBeCloseTo(returnFromStart(110_000, 100_000)!);
  });

  /*
   * The two that would otherwise print a confident lie.
   *
   * Zero is a division by zero — Infinity, or NaN when the balance is zero too. Negative is
   * worse than an error: an account opening at -500 and moving to -250 has improved by 250,
   * and the expression reports -50%, so the one case where the trader most wants to know
   * things got better is the one that says they got worse.
   */
  it('declines to answer when the account opened at zero', () => {
    expect(returnFromStart(5_000, 0)).toBeNull();
    expect(returnFromStart(0, 0)).toBeNull();
  });

  it('declines to answer when the account opened below zero', () => {
    expect(returnFromStart(-250, -500)).toBeNull();
    expect(returnFromStart(500, -500)).toBeNull();
  });

  it('declines to answer on a figure that is not a number', () => {
    expect(returnFromStart(Number.NaN, 10_000)).toBeNull();
    expect(returnFromStart(10_000, Number.NaN)).toBeNull();
    expect(returnFromStart(Number.POSITIVE_INFINITY, 10_000)).toBeNull();
  });
});
