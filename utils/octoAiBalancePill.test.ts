import { describe, expect, it } from 'vitest';
import { calculateAiBalancePillPosition } from './octoAiBalancePill';

describe('calculateAiBalancePillPosition', () => {
  it('pins the pill to the composer top-right, above its border', () => {
    expect(
      calculateAiBalancePillPosition({ left: 200, right: 1000, top: 620 }, 120, { width: 1200 }),
    ).toEqual({ x: 876, y: 592 });
  });

  it('keeps the pill inside a narrow viewport', () => {
    expect(
      calculateAiBalancePillPosition({ left: 4, right: 320, top: 20 }, 200, { width: 320 }),
    ).toEqual({ x: 112, y: 8 });
  });

  it('never leaves the top edge, however high the composer sits', () => {
    expect(
      calculateAiBalancePillPosition({ left: 0, right: 400, top: 0 }, 100, { width: 800 }).y,
    ).toBe(8);
  });

  it('clamps to the left margin when the pill is wider than the viewport', () => {
    expect(
      calculateAiBalancePillPosition({ left: 0, right: 200, top: 300 }, 400, { width: 200 }).x,
    ).toBe(8);
  });
});
