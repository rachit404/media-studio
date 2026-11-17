import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import type { JournalRecord } from './history';
import { decodeJournal, encodeRecord, replayRecords } from './journal';

const record = (seq: number, value: number): JournalRecord => ({
  seq,
  label: `edit ${String(seq)}`,
  patches: [{ op: 'replace', path: ['n'], value }],
});

describe('journal encoding', () => {
  it('round-trips records', () => {
    const records = [record(1, 10), record(2, 20)];
    const text = records.map(encodeRecord).join('');
    expect(decodeJournal(text)).toEqual({ records, damaged: false });
  });

  it('keeps intact records and flags a torn final line', () => {
    const text = encodeRecord(record(1, 1)) + encodeRecord(record(2, 2)).slice(0, 20);
    const { records, damaged } = decodeJournal(text);
    expect(records.map((r) => r.seq)).toEqual([1]);
    expect(damaged).toBe(true);
  });

  it('stops at out-of-order sequence numbers and at invalid shapes', () => {
    expect(
      decodeJournal(encodeRecord(record(1, 1)) + encodeRecord(record(3, 3))).records,
    ).toHaveLength(1);
    expect(
      decodeJournal('{"seq":1,"label":"x","patches":[{"op":"nope","path":[]}]}\n').damaged,
    ).toBe(true);
    expect(decodeJournal('not json\n').records).toEqual([]);
  });

  it('treats an empty journal as valid', () => {
    expect(decodeJournal('')).toEqual({ records: [], damaged: false });
  });
});

describe('replayRecords', () => {
  it('applies only records after the checkpoint sequence', () => {
    const result = replayRecords({ n: 0 }, [record(1, 1), record(2, 2), record(3, 3)], 1);
    expect(result).toEqual({ state: { n: 3 }, applied: 2, lastSeq: 3 });
  });

  it('is a no-op when everything is already in the checkpoint', () => {
    expect(replayRecords({ n: 5 }, [record(1, 1)], 1)).toEqual({
      state: { n: 5 },
      applied: 0,
      lastSeq: 1,
    });
  });

  it('refuses to apply across a gap', () => {
    expect(() => replayRecords({ n: 0 }, [record(5, 5)], 1)).toThrow(AppError);
  });

  it('rejects patches that try to reach into prototypes', () => {
    const hostile: JournalRecord = {
      seq: 1,
      label: 'evil',
      patches: [{ op: 'add', path: ['__proto__', 'polluted'], value: true }],
    };
    expect(() => replayRecords({ n: 0 }, [hostile], 0)).toThrow();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
