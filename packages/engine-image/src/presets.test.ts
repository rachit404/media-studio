import {
  History,
  addAdjustmentLayers,
  adjustmentSchema,
  createProject,
  sortedItems,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { FILTER_PRESETS } from './presets';

describe('FILTER_PRESETS', () => {
  it('has unique ids and non-empty stacks', () => {
    const ids = FILTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of FILTER_PRESETS) expect(preset.adjustments.length).toBeGreaterThan(0);
  });

  it('only uses adjustments the document schema accepts', () => {
    for (const preset of FILTER_PRESETS) {
      for (const item of preset.adjustments) {
        expect(adjustmentSchema.safeParse(item.adjustment).success, item.name).toBe(true);
      }
    }
  });

  it('applies a preset as one undo step that removes every layer it added', () => {
    for (const preset of FILTER_PRESETS) {
      const history = new History(
        createProject({ id: 'p', name: 'P', type: 'image', createdAt: '2026-11-17T10:00:00.000Z' }),
      );
      history.execute(
        addAdjustmentLayers(
          preset.adjustments.map((item, index) => ({
            id: `${preset.id}-${String(index)}`,
            name: item.name,
            adjustment: item.adjustment,
          })),
          `Apply ${preset.name}`,
        ),
      );
      const layers = (): number => {
        const content = history.state.content;
        if (content.kind !== 'image') throw new Error('expected image');
        return sortedItems(content.layers).length;
      };
      expect(layers()).toBe(preset.adjustments.length);
      history.undo();
      expect(layers()).toBe(0);
    }
  });
});
