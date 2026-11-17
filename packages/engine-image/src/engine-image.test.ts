import {
  AppError,
  History,
  addAdjustmentLayer,
  addImageLayer,
  createProject,
  setLayerBlendMode,
  setLayerVisible,
  type ImageContent,
  type NewAsset,
  type ProjectDocument,
} from '@media-studio/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, exportFilename, planExport } from './export-plan';
import { buildScene, parseHexColor } from './scene';
import { clampZoom, fitView, panBy, viewToDoc, zoomAt } from './view';

const asset = (id: string, width = 100, height = 50): NewAsset => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  mime: 'image/png',
  size: 1,
  width,
  height,
  file: `media/${id}.png`,
  thumb: `thumbs/${id}.webp`,
});

function imageContent(project: ProjectDocument): ImageContent {
  if (project.content.kind !== 'image') throw new Error('expected image');
  return project.content;
}

describe('buildScene', () => {
  const setup = () => {
    const history = new History(
      createProject({ id: 'p', name: 'P', type: 'image', createdAt: '2026-11-17T10:00:00.000Z' }),
    );
    const assets: Record<string, ReturnType<typeof asset>> = {
      a1: asset('a1'),
      a2: asset('a2', 40, 40),
    };
    history.execute(addImageLayer('L1', { id: 'a1', name: 'one', width: 100, height: 50 }));
    history.execute(addImageLayer('L2', { id: 'a2', name: 'two', width: 40, height: 40 }));
    history.execute(addAdjustmentLayer('A1', 'saturation'));
    return { history, assets: assets as unknown as Parameters<typeof buildScene>[1] };
  };

  it('lists visible layers bottom to top with matrices, blend modes and texture ids', () => {
    const { history, assets } = setup();
    history.execute(setLayerBlendMode('L2', 'multiply'));
    const { scene, textureIds, missingAssets } = buildScene(imageContent(history.state), assets);
    expect(scene).toMatchObject({ width: 100, height: 50, background: null });
    expect(scene.nodes.map((n) => n.id)).toEqual(['L1', 'L2', 'A1']);
    expect(scene.nodes[1]).toMatchObject({
      type: 'image',
      textureId: 'a2',
      blendMode: 'multiply',
      width: 40,
      height: 40,
    });
    expect(textureIds.sort()).toEqual(['a1', 'a2']);
    expect(missingAssets).toEqual([]);
  });

  it('skips hidden layers and reports layers whose asset is missing', () => {
    const { history, assets } = setup();
    history.execute(setLayerVisible('L2', false));
    const withoutL1 = { a2: assets['a2'] } as unknown as Parameters<typeof buildScene>[1];
    const result = buildScene(imageContent(history.state), withoutL1);
    expect(result.scene.nodes.map((n) => n.id)).toEqual(['A1']);
    expect(result.missingAssets).toEqual(['a1']);
  });

  it('parses colours', () => {
    expect(parseHexColor('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
    expect(() => parseHexColor('orange')).toThrow(RangeError);
  });
});

describe('view maths', () => {
  it('fits a document into the viewport, centred, and never upscales beyond 4x', () => {
    const view = fitView({ width: 1000, height: 500 }, { width: 548, height: 400 });
    expect(view.zoom).toBeCloseTo(0.5);
    expect(view.panX).toBeCloseTo(24);
    expect(view.panY).toBeCloseTo(75);
    expect(fitView({ width: 1, height: 1 }, { width: 800, height: 600 }).zoom).toBe(4);
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const start = { zoom: 1, panX: 40, panY: 10 };
    const anchor = { x: 300, y: 200 };
    const before = viewToDoc(start, anchor.x, anchor.y);
    const zoomed = zoomAt(start, 2.5, anchor);
    const after = viewToDoc(zoomed, anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom and pans', () => {
    expect(clampZoom(1000)).toBe(32);
    expect(clampZoom(0)).toBe(0.02);
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 1000, { x: 0, y: 0 }).zoom).toBe(32);
    expect(panBy({ zoom: 1, panX: 5, panY: 5 }, 10, -2)).toEqual({ zoom: 1, panX: 15, panY: 3 });
  });
});

describe('planExport', () => {
  const canvas = { width: 400, height: 200 };

  it('computes output size, mime and quality', () => {
    expect(planExport(canvas, { ...DEFAULT_EXPORT_SETTINGS, scalePercent: 50 })).toMatchObject({
      width: 200,
      height: 100,
      mime: 'image/png',
      extension: 'png',
    });
    expect(
      planExport(canvas, { ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', quality: 75 }),
    ).toMatchObject({
      mime: 'image/jpeg',
      extension: 'jpg',
      quality: 0.75,
    });
  });

  it('rounds odd sizes and never returns zero', () => {
    expect(
      planExport({ width: 3, height: 1 }, { ...DEFAULT_EXPORT_SETTINGS, scalePercent: 10 }),
    ).toMatchObject({ width: 1, height: 1 });
  });

  it('rejects unusable scales and oversized outputs with typed errors', () => {
    expect(() => planExport(canvas, { ...DEFAULT_EXPORT_SETTINGS, scalePercent: 5 })).toThrow(
      AppError,
    );
    expect(() =>
      planExport(canvas, { ...DEFAULT_EXPORT_SETTINGS, scalePercent: Number.NaN }),
    ).toThrow(AppError);
    expect(() =>
      planExport(
        { width: 16000, height: 16000 },
        { ...DEFAULT_EXPORT_SETTINGS, scalePercent: 100 },
      ),
    ).toThrow(/too large/);
    expect(() =>
      planExport(
        { width: 10000, height: 10000 },
        { ...DEFAULT_EXPORT_SETTINGS, scalePercent: 150 },
      ),
    ).toThrow(AppError);
  });
});

describe('exportFilename', () => {
  it('builds safe names', () => {
    expect(exportFilename('Holiday 2026', 'png')).toBe('Holiday 2026.png');
    expect(exportFilename('a/b\\c:d*e?"<>|', 'jpg')).toBe('abcde.jpg');
    expect(exportFilename('   ', 'webp')).toBe('image.webp');
    expect(exportFilename('name...', 'png')).toBe('name.png');
    expect(exportFilename('x'.repeat(300), 'png')).toHaveLength(104);
  });
});
