import { Immer, enablePatches } from 'immer';
import { z } from 'zod';
import { AppError } from './errors';
import type { JournalRecord } from './history';

enablePatches();

const patchSchema = z.object({
  op: z.enum(['add', 'remove', 'replace']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

const recordSchema = z.object({
  seq: z.number().int().positive(),
  label: z.string(),
  patches: z.array(patchSchema),
});

/** One journal line (JSON Lines). */
export function encodeRecord(record: JournalRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export interface DecodedJournal {
  records: JournalRecord[];
  /** True when trailing data was ignored (a write torn by a crash, or corruption). Earlier records are still valid. */
  damaged: boolean;
}

/** Parse a journal, keeping every intact record up to the first damaged or out-of-order line. */
export function decodeJournal(text: string): DecodedJournal {
  const records: JournalRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = recordSchema.parse(JSON.parse(line));
      const previous = records.at(-1);
      if (previous && parsed.seq !== previous.seq + 1) return { records, damaged: true };
      records.push({ seq: parsed.seq, label: parsed.label, patches: parsed.patches });
    } catch {
      return { records, damaged: true };
    }
  }
  return { records, damaged: false };
}

const replayer = new Immer({ autoFreeze: false });

export interface ReplayResult<D> {
  state: D;
  /** Number of records applied (records at or before `afterSeq` are skipped). */
  applied: number;
  lastSeq: number;
}

/**
 * Re-apply journal records on top of a checkpoint. Records with seq <= afterSeq are already in the checkpoint
 * and are skipped, which makes recovery safe even if a crash happened between writing the checkpoint and
 * deleting the journal. The caller must validate the result against the schema before using it.
 */
export function replayRecords<D extends object>(
  base: D,
  records: readonly JournalRecord[],
  afterSeq: number,
): ReplayResult<D> {
  let state = base;
  let applied = 0;
  let lastSeq = afterSeq;
  for (const record of records) {
    if (record.seq <= afterSeq) continue;
    if (record.seq !== lastSeq + 1) {
      throw new AppError({
        code: 'invalid-project',
        message: 'The recovery data has a gap and cannot be applied safely.',
        hint: 'Discard the unsaved changes and continue with the last saved version.',
      });
    }
    state = replayer.applyPatches(state, record.patches);
    applied += 1;
    lastSeq = record.seq;
  }
  return { state, applied, lastSeq };
}
