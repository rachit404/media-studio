import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { History } from './history';
import {
  addAdjustmentLayer,
  addRasterLayer,
  addShapeLayer,
  commitPixels,
  cropCanvas,
  duplicateLayer,
  flipCanvas,
  pixelContentIds,
  removeLayerMask,
  rotateCanvas,
  setLayerClip,
  setLayerMask,
  setMaskEnabled,
} from './image-commands';
import { layerSchema } from './image-document';
import { createProject, parseProject, parseProjectFile, CURRENT_FORMAT_VERSION } from './project';
import type { ProjectDocument } from './project';
import { PixelStore, createTile, readPixel, tileKey } from './tiles';

const NOW = '2026-11-18T10:00:00.000Z';

function setup() {
  const history = new History(
    createProject({ id: 'p1', name: 'Paint', type: 'image', createdAt: NOW }),
    { autoFreeze: true },
  );
  history.execute(addRasterLayer('R1'));
  return history;
}

function content(history: History<ProjectDocument>) {
  if (history.state.content.kind !== 'image') throw new Error('expected image');
  return history.state.content;
}

describe('paint layers', () => {
  it('adds an empty paint layer the size of the canvas, centred', () => {
    const history = setup();
    const layer = content(history).layers.byId['R1'];
    expect(layer).toMatchObject({
      type: 'raster',
      width: 1920,
      height: 1080,
      pixels: null,
      transform: { x: 960, y: 540, scaleX: 1, scaleY: 1, rotation: 0 },
    });
  });

  it('switches pixels with one undoable step, and undo points back at the older content', () => {
    const history = setup();
    history.execute(commitPixels('R1', 'layer', 'c1', 'Brush stroke'));
    history.execute(commitPixels('R1', 'layer', 'c2', 'Brush stroke'));
    const pixels = () => {
      const layer = content(history).layers.byId['R1'];
      return layer?.type === 'raster' ? layer.pixels : 'not raster';
    };
    expect(pixels()).toBe('c2');
    history.undo();
    expect(pixels()).toBe('c1');
    history.undo();
    expect(pixels()).toBeNull();
    history.redo();
    expect(pixels()).toBe('c1');
  });

  it('refuses to paint something that is not a paint layer', () => {
    const history = setup();
    history.execute(addShapeLayer('S1', 'rectangle'));
    expect(() => {
      history.execute(commitPixels('S1', 'layer', 'c1', 'x'));
    }).toThrow(AppError);
  });

  it('moves with canvas operations like any placed layer', () => {
    const history = setup();
    history.execute(cropCanvas({ x: 100, y: 50, width: 800, height: 600 }));
    expect(content(history).layers.byId['R1']).toMatchObject({
      transform: { x: 860, y: 490 },
    });
    history.execute(flipCanvas('horizontal'));
    history.execute(rotateCanvas('cw'));
    expect(content(history).layers.byId['R1']).toMatchObject({ type: 'raster' });
    history.undo();
    history.undo();
    expect(content(history).layers.byId['R1']).toMatchObject({ transform: { x: 860, y: 490 } });
  });

  it('can be duplicated with its pixels', () => {
    const history = setup();
    history.execute(commitPixels('R1', 'layer', 'c1', 'Brush stroke'));
    history.execute(duplicateLayer('R1', 'R2'));
    expect(content(history).layers.byId['R2']).toMatchObject({ type: 'raster', pixels: 'c1' });
  });
});

describe('layer masks and clipping', () => {
  it('adds, paints, disables and removes a mask, each as one undoable step', () => {
    const history = setup();
    history.execute(setLayerMask('R1', { width: 1920, height: 1080, pixels: null }));
    const mask = () => content(history).layers.byId['R1'];
    expect(mask()).toMatchObject({ mask: { pixels: null, enabled: true, width: 1920 } });
    history.execute(commitPixels('R1', 'mask', 'm1', 'Paint mask'));
    expect(mask()).toMatchObject({ mask: { pixels: 'm1' } });
    history.execute(setMaskEnabled('R1', false));
    expect(mask()).toMatchObject({ mask: { enabled: false } });
    history.execute(removeLayerMask('R1'));
    expect(mask() && 'mask' in (mask() as object)).toBe(false);
    history.undo();
    expect(mask()).toMatchObject({ mask: { enabled: false, pixels: 'm1' } });
  });

  it('works on image-less generated layers too, and refuses adjustment layers and missing masks', () => {
    const history = setup();
    history.execute(addShapeLayer('S1', 'ellipse'));
    history.execute(setLayerMask('S1', { width: 200, height: 100, pixels: null }));
    history.execute(addAdjustmentLayer('A1', 'levels'));
    expect(() => {
      history.execute(setLayerMask('A1', { width: 10, height: 10, pixels: null }));
    }).toThrow(AppError);
    expect(() => {
      history.execute(commitPixels('R1', 'mask', 'm', 'x'));
    }).toThrow(AppError);
    expect(() => {
      history.execute(setLayerMask('R1', { width: 0, height: 10, pixels: null }));
    }).toThrow(AppError);
  });

  it('clips a layer to the one below and releases it', () => {
    const history = setup();
    history.execute(addShapeLayer('S1', 'rectangle'));
    history.execute(setLayerClip('S1', true));
    expect(content(history).layers.byId['S1']).toMatchObject({ clip: true });
    history.execute(setLayerClip('S1', false));
    expect('clip' in (content(history).layers.byId['S1'] as object)).toBe(false);
  });

  it('lists the pixel content a document uses', () => {
    const history = setup();
    history.execute(commitPixels('R1', 'layer', 'c1', 'Brush stroke'));
    history.execute(setLayerMask('R1', { width: 10, height: 10, pixels: 'm1' }));
    history.execute(addRasterLayer('R2'));
    expect(pixelContentIds(content(history)).sort()).toEqual(['c1', 'm1']);
  });
});

describe('format v4', () => {
  it('round-trips a project with paint layers, masks and clipping', () => {
    const history = setup();
    history.execute(commitPixels('R1', 'layer', 'c1', 'Brush stroke'));
    history.execute(setLayerMask('R1', { width: 1920, height: 1080, pixels: 'm1' }));
    history.execute(setLayerClip('R1', true));
    const parsed = parseProject(JSON.parse(JSON.stringify(history.state)));
    expect(parsed).toEqual(history.state);
  });

  it('opens a v3 file unchanged', () => {
    const v3 = {
      format: 'media-studio-project',
      formatVersion: 3,
      appVersion: '0.0.0',
      modifiedAt: NOW,
      journalSeq: 0,
      project: createProject({ id: 'p1', name: 'Old', type: 'image', createdAt: NOW }),
    };
    const { file, migratedFrom } = parseProjectFile(v3);
    expect(file.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(migratedFrom).toBe(3);
  });

  it('rejects malformed masks and paint layers', () => {
    const base = {
      id: 'R',
      key: 'a0',
      type: 'raster',
      name: 'x',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      width: 10,
      height: 10,
      pixels: null,
    };
    expect(layerSchema.safeParse(base).success).toBe(true);
    expect(layerSchema.safeParse({ ...base, width: 0 }).success).toBe(false);
    expect(layerSchema.safeParse({ ...base, pixels: '../x' }).success).toBe(false);
    expect(
      layerSchema.safeParse({ ...base, mask: { pixels: null, width: 5, height: 5 } }).success,
    ).toBe(false);
    expect(layerSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('PixelStore', () => {
  it('shares untouched tiles between versions and reads defaults for missing tiles', () => {
    const store = new PixelStore();
    const a = createTile('a', 4);
    a.data[0] = 7;
    store.commit('v1', null, new Map([[tileKey(0, 0), a]]));
    const b = createTile('b', 4);
    store.commit('v2', 'v1', new Map([[tileKey(1, 0), b]]));
    expect(store.get('v2').get('0,0')).toBe(a);
    expect(store.get('v1').has('1,0')).toBe(false);
    const grid = { width: 600, height: 300, channels: 4 as const };
    expect(readPixel(store.get('v2'), grid, 0, 0)[0]).toBe(7);
    expect(readPixel(store.get('v2'), grid, 599, 299)).toEqual([0, 0, 0, 0]);
    expect(readPixel(store.get('v2'), { ...grid, channels: 1 }, 700, 10)).toEqual([255]);
    expect(store.stats().tiles).toBe(2);
    store.commit('v3', 'v2', new Map([[tileKey(1, 0), null]]));
    expect(store.get('v3').has('1,0')).toBe(false);
    store.retainOnly(new Set(['v3']));
    expect(store.has('v1')).toBe(false);
    expect(store.has('v3')).toBe(true);
  });
});
