import { describe, expect, it } from 'vitest';
import { describeShare, describeSpread, phrase } from './describe';

const slice = (label: string, value: number, caption = `${value}`) => ({ label, value, caption });
const bar = (label: string, net: number, caption = `${net}`) => ({ label, net, caption });

describe('a ring, described', () => {
  it('names the biggest part and counts the ones that are drawn', () => {
    const seen = describeShare([slice('Food', 40), slice('Rent', 90), slice('Fuel', 10)]);
    expect(seen).toMatchObject({ count: 3, top: { label: 'Rent' } });
  });

  it('counts only the parts with something in them', () => {
    // A donut built from ten categories where seven are zero is a three-part ring, and
    // calling it ten describes a picture nobody is looking at.
    const seen = describeShare([slice('Food', 40), slice('Rent', 0), slice('Fuel', 0)]);
    expect(seen.count).toBe(1);
  });

  it('has nothing to say about an empty ring', () => {
    expect(describeShare([])).toMatchObject({ count: 0, top: null });
    expect(describeShare([slice('Food', 0)])).toMatchObject({ count: 0, top: null });
  });
});

describe('bars, described', () => {
  it('names both ends, because a bar chart is read as the comparison between them', () => {
    const seen = describeSpread([bar('Mon', 5), bar('Tue', -3), bar('Wed', 1)]);
    expect(seen.top?.label).toBe('Mon');
    expect(seen.bottom?.label).toBe('Tue');
  });

  it('does not name one bar twice', () => {
    // A single bar has no spread; reporting "highest Mon, lowest Mon" is a sentence that
    // sounds like a comparison and is not one.
    const seen = describeSpread([bar('Mon', 5)]);
    expect(seen.top?.label).toBe('Mon');
    expect(seen.bottom).toBeNull();
  });

  it('keeps a zero bar in the count', () => {
    // Unlike a ring: an empty weekday is a bar the chart draws, at zero, and the reader is
    // looking at it.
    expect(describeSpread([bar('Mon', 0), bar('Tue', -3)]).count).toBe(2);
  });

  it('has nothing to say about no bars', () => {
    expect(describeSpread([])).toMatchObject({ count: 0, top: null, bottom: null });
  });
});

describe('one end, as a phrase', () => {
  it('joins the label to its figure', () => {
    expect(phrase({ label: 'Rent', caption: '₪4,000 · 38%' })).toBe('Rent · ₪4,000 · 38%');
  });

  it('drops a figure that is not one', () => {
    // An untraded weekday's caption is a dash, and "Highest: Monday · —" spends four
    // characters saying there is nothing there.
    expect(phrase({ label: 'Monday', caption: '—' })).toBe('Monday');
    expect(phrase({ label: 'Monday', caption: '   ' })).toBe('Monday');
  });

  it('says nothing about nothing', () => {
    expect(phrase(null)).toBe('');
  });
});
