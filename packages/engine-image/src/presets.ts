import type { Adjustment } from '@media-studio/core';

/** A filter preset is a named stack of adjustment layers, so applying one stays fully editable afterwards. */
export interface FilterPreset {
  id: string;
  name: string;
  adjustments: readonly { name: string; adjustment: Adjustment }[];
}

export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    id: 'vivid',
    name: 'Vivid',
    adjustments: [
      { name: 'Vivid saturation', adjustment: { kind: 'saturation', saturation: 0.35 } },
      {
        name: 'Vivid contrast',
        adjustment: { kind: 'brightness-contrast', brightness: 0, contrast: 0.15 },
      },
    ],
  },
  {
    id: 'mono',
    name: 'Mono',
    adjustments: [
      { name: 'Mono', adjustment: { kind: 'black-white', amount: 1 } },
      {
        name: 'Mono contrast',
        adjustment: { kind: 'brightness-contrast', brightness: 0, contrast: 0.1 },
      },
    ],
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    adjustments: [
      {
        name: 'High contrast levels',
        adjustment: {
          kind: 'levels',
          inBlack: 0.12,
          inWhite: 0.88,
          gamma: 1,
          outBlack: 0,
          outWhite: 1,
        },
      },
    ],
  },
  {
    id: 'faded',
    name: 'Faded',
    adjustments: [
      {
        name: 'Faded levels',
        adjustment: {
          kind: 'levels',
          inBlack: 0,
          inWhite: 1,
          gamma: 1,
          outBlack: 0.1,
          outWhite: 0.92,
        },
      },
      { name: 'Faded saturation', adjustment: { kind: 'saturation', saturation: -0.25 } },
    ],
  },
  {
    id: 'dramatic',
    name: 'Dramatic',
    adjustments: [
      { name: 'Dramatic exposure', adjustment: { kind: 'exposure', exposure: -0.3 } },
      {
        name: 'Dramatic contrast',
        adjustment: { kind: 'brightness-contrast', brightness: 0, contrast: 0.35 },
      },
      { name: 'Dramatic sharpen', adjustment: { kind: 'sharpen', amount: 0.8, radius: 2 } },
    ],
  },
];
