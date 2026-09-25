import { describe, expect, it } from 'vitest';
import { analyzeInput, formatClipId } from './analysis';

const baseInput = {
  rate: '30000/1001',
  clips: [
    {
      id: 'A',
      sourceIn: '01:00:00;00',
      sourceOut: '01:00:05;00',
      recordIn: '00:10:00;00'
    },
    {
      id: 'B',
      sourceIn: '02:00:00;00',
      sourceOut: '02:00:05;00',
      recordIn: '00:10:05;00'
    },
    {
      id: 'C',
      sourceIn: '03:00:00;00',
      sourceOut: '03:00:05;00',
      recordIn: '00:10:11;00'
    },
    {
      id: 'D',
      sourceIn: '04:00:00;00',
      sourceOut: '04:00:05;00',
      recordIn: '00:10:15;00'
    }
  ]
} as const;

describe('edit decision analysis', () => {
  it('computes recordOut from integer frame duration and orders clips by record position', () => {
    const response = analyzeInput(baseInput);
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);

    const { clips, breaks, firstBreak } = response.result;
    expect(clips.map((clip) => clip.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(clips.map((clip) => clip.durationFrames)).toEqual([150, 150, 150, 150]);
    expect(clips[0].recordOut.timecode).toBe('00:10:05;00');
    expect(clips[1].relation).toBe('contiguous');
    expect(clips[2].relation).toBe('gap');
    expect(clips[3].relation).toBe('overlap');
    expect(clips[2].gapBeforeFrames).toBe(30);
    expect(clips[3].overlapBeforeFrames).toBe(30);
    expect(breaks).toHaveLength(2);
    expect(firstBreak?.kind).toBe('gap');
    expect(firstBreak?.afterClipId).toBe('B');
    expect(firstBreak?.beforeClipId).toBe('C');
    expect(firstBreak?.start.timecode).toBe('00:10:10;00');
    expect(firstBreak?.end.timecode).toBe('00:10:11;00');
    expect(clips.find((clip) => clip.id === 'C')?.firstBreak).toBe(true);
  });

  it('uses the dropped minute boundary label after adding a one-minute duration', () => {
    const response = analyzeInput({
      rate: '30000/1001',
      clips: [
        {
          id: 1,
          sourceIn: '00:00:00;00',
          sourceOut: '00:01:00;02',
          recordIn: '00:00:00;00'
        }
      ]
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);
    expect(response.result.clips[0].recordOut.frame).toBe(1_800);
    expect(response.result.clips[0].recordOut.timecode).toBe('00:01:00;02');
  });

  it('handles an interval contained by an earlier longer clip as overlap with that coverage', () => {
    const response = analyzeInput({
      rate: '30000/1001',
      clips: [
        {
          id: 'long',
          sourceIn: '01:00:00;00',
          sourceOut: '01:00:10;00',
          recordIn: '00:10:00;00'
        },
        {
          id: 'adjacent',
          sourceIn: '02:00:00;00',
          sourceOut: '02:00:02;00',
          recordIn: '00:10:10;00'
        },
        {
          id: 'inside-long',
          sourceIn: '03:00:00;00',
          sourceOut: '03:00:02;00',
          recordIn: '00:10:05;00'
        }
      ]
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);
    const contained = response.result.clips.find((clip) => clip.id === 'inside-long');
    expect(contained?.relation).toBe('overlap');
    expect(contained?.previousClipId).toBe('long');
    // 半开区间交集：短片 [00:10:05;00, 00:10:07;00) 完全落在长片内，重叠只有自身 60 帧，
    // 短片结束之后直到长片结束的帧不计入。
    expect(contained?.overlapBeforeFrames).toBe(60);
    const overlapBreak = response.result.breaks.find((item) => item.beforeClipId === 'inside-long');
    expect(overlapBreak?.start.timecode).toBe('00:10:05;00');
    expect(overlapBreak?.end.timecode).toBe('00:10:07;00');
    expect(overlapBreak?.durationFrames).toBe(60);
  });

  it('keeps disjoint short clips inside one long clip as separate non-overlapping overlap bands', () => {
    const response = analyzeInput({
      rate: '30000/1001',
      clips: [
        {
          id: 'long',
          sourceIn: '01:00:00;00',
          sourceOut: '01:00:10;00',
          recordIn: '00:10:00;00'
        },
        {
          id: 's1',
          sourceIn: '02:00:00;00',
          sourceOut: '02:00:01;00',
          recordIn: '00:10:02;00'
        },
        {
          id: 's2',
          sourceIn: '03:00:00;00',
          sourceOut: '03:00:01;00',
          recordIn: '00:10:05;00'
        },
        {
          id: 's3',
          sourceIn: '04:00:00;00',
          sourceOut: '04:00:01;00',
          recordIn: '00:10:08;00'
        }
      ]
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);

    const { clips, breaks, firstBreak } = response.result;
    expect(clips.map((clip) => clip.id)).toEqual(['long', 's1', 's2', 's3']);
    for (const id of ['s1', 's2', 's3']) {
      const clip = clips.find((item) => item.id === id);
      expect(clip?.relation).toBe('overlap');
      expect(clip?.previousClipId).toBe('long');
      expect(clip?.overlapBeforeFrames).toBe(30);
    }

    expect(breaks).toHaveLength(3);
    expect(breaks.map((item) => item.durationFrames)).toEqual([30, 30, 30]);
    expect(breaks.map((item) => [item.start.timecode, item.end.timecode])).toEqual([
      ['00:10:02;00', '00:10:03;00'],
      ['00:10:05;00', '00:10:06;00'],
      ['00:10:08;00', '00:10:09;00']
    ]);
    // 重复带互不相接、互不覆盖，累计审阅范围就是三段各 30 帧。
    for (let index = 1; index < breaks.length; index += 1) {
      expect(breaks[index - 1].end.frame).toBeLessThanOrEqual(breaks[index].start.frame);
    }
    expect(firstBreak?.beforeClipId).toBe('s1');
    expect(firstBreak?.durationFrames).toBe(30);
    expect(clips.find((clip) => clip.id === 's1')?.firstBreak).toBe(true);

    // 导出快照与页面引用同一份结果，帧数一致。
    const exported = JSON.parse(JSON.stringify(response.result)) as typeof response.result;
    expect(exported.breaks).toEqual(breaks);
  });

  it('keeps numeric and text ids that look alike as distinct identities end to end', () => {
    const response = analyzeInput({
      rate: '30000/1001',
      clips: [
        {
          id: 1,
          sourceIn: '01:00:00;00',
          sourceOut: '01:00:05;00',
          recordIn: '00:10:00;00'
        },
        {
          id: '1',
          sourceIn: '02:00:00;00',
          sourceOut: '02:00:05;00',
          recordIn: '00:10:05;00'
        }
      ]
    });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);

    const { clips } = response.result;
    expect(clips).toHaveLength(2);
    expect(clips[0].id).toBe(1);
    expect(typeof clips[0].id).toBe('number');
    expect(clips[1].id).toBe('1');
    expect(typeof clips[1].id).toBe('string');
    expect(clips[1].relation).toBe('contiguous');
    expect(clips[1].previousClipId).toBe(1);
    expect(typeof clips[1].previousClipId).toBe('number');

    // 屏幕显示可区分两种类型，且与导出 JSON 的身份一致。
    expect(formatClipId(clips[0].id)).toBe('1');
    expect(formatClipId(clips[1].id)).toBe('"1"');
    expect(formatClipId(clips[0].id)).not.toBe(formatClipId(clips[1].id));

    const exported = JSON.parse(JSON.stringify(response.result)) as typeof response.result;
    expect(exported.clips[0].id).toBe(1);
    expect(exported.clips[1].id).toBe('1');
    expect(typeof exported.clips[0].id).toBe('number');
    expect(typeof exported.clips[1].id).toBe('string');
  });

  it('rejects structural errors, forbidden frames, non-positive durations, duplicates, and day wrap', () => {
    const invalidInputs = [
      null,
      { rate: '29.97', clips: [] },
      { rate: '30000/1001', clips: [] },
      { rate: '30000/1001', clips: [{}] },
      {
        rate: '30000/1001',
        clips: [
          { id: 'x', sourceIn: '00:01:00;00', sourceOut: '00:00:02;00', recordIn: '00:00:00;00' }
        ]
      },
      {
        rate: '30000/1001',
        clips: [
          { id: 'x', sourceIn: '00:00:02;00', sourceOut: '00:00:01;00', recordIn: '00:00:00;00' }
        ]
      },
      {
        rate: '30000/1001',
        clips: [
          { id: 'x', sourceIn: '00:00:00;00', sourceOut: '00:00:01;00', recordIn: '00:00:00;00' },
          { id: 'x', sourceIn: '00:00:00;00', sourceOut: '00:00:01;00', recordIn: '00:00:01;00' }
        ]
      },
      {
        rate: '30000/1001',
        clips: [
          { id: 'x', sourceIn: '00:00:00;00', sourceOut: '00:00:01;00', recordIn: '23:59:59;29' }
        ]
      }
    ];

    for (const input of invalidInputs) {
      const response = analyzeInput(input);
      expect(response.ok, JSON.stringify(input)).toBe(false);
      if (!response.ok) expect(response.issues.length).toBeGreaterThan(0);
    }
  });

  it('returns a serializable immutable analysis snapshot and does not recompute derived fields', () => {
    const response = analyzeInput(baseInput);
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.issues[0]?.message);
    const exported = JSON.parse(JSON.stringify(response.result)) as typeof response.result;
    expect(exported.schemaVersion).toBe(1);
    expect(exported.clips[0].recordOut).toEqual(response.result.clips[0].recordOut);
    expect(exported.firstBreak).toEqual(response.result.firstBreak);
    expect(exported.dayFrames).toBe(2_589_408);
  });
});
