import { describe, expect, it } from 'vitest';
import { computeRulerTicks } from './Timeline';
import { formatFrame } from '../lib/timecode';

const RATE_29 = { rate: '30000/1001', dayFrames: 2_589_408 } as const;
const RATE_59 = { rate: '60000/1001', dayFrames: 5_178_816 } as const;

describe('ruler ticks at the 24-hour boundary', () => {
  it.each([RATE_29, RATE_59])(
    'never emits the day-wrap frame at full-day zoom for %s',
    ({ rate, dayFrames }) => {
      const pixelsPerFrame = 0.0002;
      const width = dayFrames * pixelsPerFrame;
      const ticks = computeRulerTicks(pixelsPerFrame, 0, width, dayFrames);

      expect(ticks.values.length).toBeGreaterThan(0);
      expect(ticks.values[0]).toBe(0);
      expect(ticks.values).not.toContain(dayFrames);
      expect(Math.max(...ticks.values)).toBeLessThan(dayFrames);
      for (const frame of ticks.values) {
        expect(() => formatFrame(frame, rate)).not.toThrow();
      }
    }
  );

  it('keeps end-of-day labels formattable when scrolled to the day end at 29.97', () => {
    const pixelsPerFrame = 0.001;
    const width = RATE_29.dayFrames * pixelsPerFrame;
    const scrollLeft = Math.max(0, width - 1200);
    const ticks = computeRulerTicks(pixelsPerFrame, scrollLeft, 1200, RATE_29.dayFrames);

    expect(ticks.values.length).toBeGreaterThan(0);
    expect(Math.max(...ticks.values)).toBeLessThan(RATE_29.dayFrames);
    const labels = ticks.values.map((frame) => formatFrame(frame, RATE_29.rate));
    expect(labels).toContain('23:00:00;00');
  });

  it('keeps end-of-day labels formattable when scrolled to the day end at 59.94', () => {
    const pixelsPerFrame = 0.001;
    const width = RATE_59.dayFrames * pixelsPerFrame;
    const scrollLeft = Math.max(0, width - 1200);
    const ticks = computeRulerTicks(pixelsPerFrame, scrollLeft, 1200, RATE_59.dayFrames);

    expect(ticks.values.length).toBeGreaterThan(0);
    expect(Math.max(...ticks.values)).toBeLessThan(RATE_59.dayFrames);
    const labels = ticks.values.map((frame) => formatFrame(frame, RATE_59.rate));
    expect(labels).toContain('23:30:00;00');
  });

  it('produces strictly increasing in-day ticks at every zoom level used by the app', () => {
    for (const { rate, dayFrames } of [RATE_29, RATE_59]) {
      for (const pixelsPerFrame of [0.0002, 0.001, 0.02, 0.08, 0.7, 2]) {
        const width = dayFrames * pixelsPerFrame;
        // 扫过整个滚动范围，模拟从片头滚到日末。
        for (let scrollLeft = 0; scrollLeft <= width; scrollLeft += Math.max(1, width / 24)) {
          const ticks = computeRulerTicks(pixelsPerFrame, scrollLeft, 1200, dayFrames);
          for (const frame of ticks.values) {
            expect(frame).toBeGreaterThanOrEqual(0);
            expect(frame).toBeLessThan(dayFrames);
            expect(() => formatFrame(frame, rate)).not.toThrow();
          }
          for (let index = 1; index < ticks.values.length; index += 1) {
            expect(ticks.values[index]).toBeGreaterThan(ticks.values[index - 1]);
          }
        }
      }
    }
  });
});
