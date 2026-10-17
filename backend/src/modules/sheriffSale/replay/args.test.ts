import { describe, expect, it } from 'vite-plus/test';
import { NJ_COUNTIES } from '../../../shared/nj';
import { parseReplayArgs } from './args';

describe('parseReplayArgs', () => {
  it('replays one county over a range, earliest date first', () => {
    expect(parseReplayArgs(['--county', 'Atlantic', '--from', '2025-03-01', '--to', '2025-03-04'])).toEqual({
      counties: ['Atlantic'],
      dates: ['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04'],
      dryRun: false,
    });
  });

  it('replays every county when none is given', () => {
    expect(parseReplayArgs(['--from', '2025-03-01', '--to', '2025-03-01']).counties).toEqual([...NJ_COUNTIES]);
  });

  it('matches counties case-insensitively, with a space or a hyphen, and keeps NJ_COUNTIES order', () => {
    const { counties } = parseReplayArgs([
      '--county',
      'union',
      '--county=cape-may',
      '--county',
      'CAPE MAY',
      '--county',
      'Gloucester',
      '--from=2025-03-01',
      '--to=2025-03-01',
    ]);

    expect(counties).toEqual(['Cape May', 'Gloucester', 'Union']);
  });

  it('crosses month and year ends', () => {
    expect(parseReplayArgs(['--from', '2024-12-30', '--to', '2025-01-02']).dates).toEqual([
      '2024-12-30',
      '2024-12-31',
      '2025-01-01',
      '2025-01-02',
    ]);
  });

  it('sets dry run', () => {
    expect(parseReplayArgs(['--from', '2025-03-01', '--to', '2025-03-01', '--dry-run']).dryRun).toBe(true);
  });

  it('rejects an unknown county, naming it', () => {
    expect(() => parseReplayArgs(['--county', 'Atlantis', '--from', '2025-03-01', '--to', '2025-03-01'])).toThrow(
      'Unknown county "Atlantis"',
    );
  });

  it('rejects a reversed range', () => {
    expect(() => parseReplayArgs(['--from', '2025-04-01', '--to', '2025-03-01'])).toThrow(
      '--from 2025-04-01 is after --to 2025-03-01',
    );
  });

  it.each([
    [['--from', '2025-3-1', '--to', '2025-03-01'], '--from must be a date as YYYY-MM-DD, got "2025-3-1"'],
    [['--from', '2025-02-30', '--to', '2025-03-01'], '--from must be a date as YYYY-MM-DD, got "2025-02-30"'],
    [['--from', '2025-03-01', '--to', 'yesterday'], '--to must be a date as YYYY-MM-DD, got "yesterday"'],
    [['--from', '2025-03-01'], '--to must be a date as YYYY-MM-DD, got nothing'],
    [['--county', '--from', '2025-03-01', '--to', '2025-03-01'], '--county needs a value'],
    [['--from', '2025-03-01', '--to', '2025-03-01', '--counties', 'Salem'], 'Unknown argument "--counties"'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseReplayArgs(argv)).toThrow(message);
  });
});
