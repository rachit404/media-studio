import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { History } from './history';
import {
  addAdjustmentLayer,
  addAdjustmentLayers,
  addImageLayer,
  addShapeLayer,
  addTextLayer,
  cropCanvas,
  duplicateLayer,
  flipCanvas,
  moveLayer,
  pasteLayer,
  removeLayer,
  renameLayer,
  resizeCanvas,
  rotateCanvas,
  setAdjustmentParams,
  setBackground,
  setLayerBlendMode,
  setLayerOpacity,
  setLayerTransform,
  setLayerVisible,
  setShapeSpec,
  setTextSpec,
  snapshotLayer,
} from './image-commands';
import { rasterKey, type Layer } from './image-document';
import { applyAffine, layerMatrix } from './image-geometry';
import { sortedItems } from './ordered';
import {
  CURRENT_FORMAT_VERSION,
  createProject,
  parseProject,
  addAssets,
  parseProjectFile,
  type ProjectDocument,
} from './project';

const NOW = '2026-11-17T10:00:00.000Z';
const photo = { id: 'a1', name: 'photo.png', width: 400, height: 200 };

function newHistory(): History<ProjectDocument> {
  return new History(createProject({ id: 'p1', name: 'Image', type: 'image', createdAt: NOW }), {
    autoFreeze: true,
  });
}

function content(history: History<ProjectDocument>) {
  if (history.state.content.kind !== 'image') throw new Error('expected an image project');
  return history.state.content;
}

const layers = (history: History<ProjectDocument>): Layer[] => sortedItems(content(history).layers);

/** A history with a 400x200 canvas holding one photo layer (id L1) and a second layer (L2) on top. */
function withLayers(): History<ProjectDocument> {
  const history = newHistory();
  history.execute(addImageLayer('L1', photo));
  history.execute(addImageLayer('L2', { id: 'a2', name: 'second.png', width: 100, height: 50 }));
  return history;
}

function corners(layer: Layer, width: number, height: number): [number, number][] {
  if (layer.type !== 'image') throw new Error('expected an image layer');
  const m = layerMatrix(layer.transform, width, height);
  return [
    applyAffine(m, 0, 0),
    applyAffine(m, width, 0),
    applyAffine(m, 0, height),
    applyAffine(m, width, height),
  ];
}

describe('layers', () => {
  it('the first layer sets the canvas size and is centred', () => {
    const history = newHistory();
    history.execute(addImageLayer('L1', photo));
    expect(content(history)).toMatchObject({ width: 400, height: 200 });
    expect(layers(history)[0]).toMatchObject({
      type: 'image',
      transform: { x: 200, y: 100, scaleX: 1, scaleY: 1, rotation: 0 },
    });
  });

  it('later layers keep the canvas and shrink to fit when larger', () => {
    const history = withLayers();
    history.execute(addImageLayer('L3', { id: 'a3', name: 'big.png', width: 800, height: 400 }));
    expect(content(history)).toMatchObject({ width: 400, height: 200 });
    expect(layers(history).at(-1)).toMatchObject({ transform: { scaleX: 0.5, scaleY: 0.5 } });
  });

  it('adds adjustment layers with identity defaults', () => {
    const history = withLayers();
    history.execute(addAdjustmentLayer('A1', 'saturation'));
    expect(layers(history).at(-1)).toMatchObject({
      type: 'adjustment',
      adjustment: { kind: 'saturation', saturation: 0 },
    });
  });

  it('edits properties and keeps the project valid', () => {
    const history = withLayers();
    history.execute(renameLayer('L1', 'Background'));
    history.execute(setLayerVisible('L2', false));
    history.execute(setLayerOpacity('L2', 0.4));
    history.execute(setLayerBlendMode('L2', 'multiply'));
    history.execute(setLayerTransform('L2', { x: 10, rotation: 45 }));
    history.execute(setBackground('#336699'));
    expect(layers(history)[0]).toMatchObject({ name: 'Background' });
    expect(layers(history)[1]).toMatchObject({
      visible: false,
      opacity: 0.4,
      blendMode: 'multiply',
      transform: { x: 10, rotation: 45 },
    });
    expect(content(history).background).toBe('#336699');
    expect(() => parseProject(history.state)).not.toThrow();
  });

  it('reorders and removes layers', () => {
    const history = withLayers();
    history.execute(addAdjustmentLayer('A1', 'exposure'));
    history.execute(moveLayer('A1', 0));
    expect(layers(history).map((l) => l.id)).toEqual(['A1', 'L1', 'L2']);
    history.execute(moveLayer('L1', 99));
    expect(layers(history).map((l) => l.id)).toEqual(['A1', 'L2', 'L1']);
    history.execute(removeLayer('L2'));
    expect(layers(history).map((l) => l.id)).toEqual(['A1', 'L1']);
  });

  it('coalesces slider-style edits into one undo step', () => {
    const history = withLayers();
    for (const value of [0.9, 0.8, 0.7, 0.6]) history.execute(setLayerOpacity('L1', value));
    expect(layers(history)[0]).toMatchObject({ opacity: 0.6 });
    history.undo();
    expect(layers(history)[0]).toMatchObject({ opacity: 1 });
  });

  it('edits adjustment parameters', () => {
    const history = withLayers();
    history.execute(addAdjustmentLayer('A1', 'brightness-contrast'));
    history.execute(setAdjustmentParams('A1', { brightness: 0.2, contrast: -0.5 }));
    expect(layers(history).at(-1)).toMatchObject({
      adjustment: { brightness: 0.2, contrast: -0.5 },
    });
    expect(() => history.execute(setAdjustmentParams('A1', { nonsense: 1 }))).toThrow(AppError);
    const before = history.state;
    expect(() => history.execute(setAdjustmentParams('A1', { brightness: 5 }))).toThrow(AppError);
    expect(history.state).toBe(before); // an invalid value changes nothing
  });

  it('rejects invalid operations with typed or range errors', () => {
    const history = withLayers();
    history.execute(addAdjustmentLayer('A1', 'exposure'));
    expect(() => history.execute(removeLayer('nope'))).toThrow(RangeError);
    expect(() => history.execute(setLayerBlendMode('A1', 'screen'))).toThrow(AppError);
    expect(() => history.execute(setAdjustmentParams('L1', { exposure: 1 }))).toThrow(AppError);
    expect(() => setLayerTransform('L1', { scaleX: 0 })).toThrow(AppError);
    expect(() => setLayerTransform('L1', { x: Number.NaN })).toThrow(AppError);
    expect(() => setBackground('red')).toThrow(AppError);
    const video = new History(createProject({ id: 'v', name: 'V', type: 'video', createdAt: NOW }));
    expect(() => video.execute(addImageLayer('L', photo))).toThrow(AppError);
  });
});

describe('canvas operations', () => {
  it('cropping shifts layers and changes only the canvas size', () => {
    const history = withLayers();
    const before = corners(layers(history)[0] as Layer, 400, 200);
    history.execute(cropCanvas({ x: 50, y: 20, width: 300, height: 120 }));
    expect(content(history)).toMatchObject({ width: 300, height: 120 });
    const after = corners(layers(history)[0] as Layer, 400, 200);
    before.forEach(([x, y], i) => {
      expect(after[i]?.[0]).toBeCloseTo(x - 50);
      expect(after[i]?.[1]).toBeCloseTo(y - 20);
    });
  });

  it('refuses crops outside the canvas or with fractional pixels', () => {
    const history = withLayers();
    expect(() => history.execute(cropCanvas({ x: 0, y: 0, width: 401, height: 10 }))).toThrow(
      AppError,
    );
    expect(() => history.execute(cropCanvas({ x: -1, y: 0, width: 10, height: 10 }))).toThrow(
      AppError,
    );
    expect(() => history.execute(cropCanvas({ x: 0.5, y: 0, width: 10, height: 10 }))).toThrow(
      AppError,
    );
    expect(() => history.execute(cropCanvas({ x: 0, y: 0, width: 0, height: 10 }))).toThrow(
      AppError,
    );
  });

  it('resizing keeps the aspect ratio and scales layers with the canvas', () => {
    const history = withLayers();
    const before = corners(layers(history)[0] as Layer, 400, 200);
    history.execute(resizeCanvas(200));
    expect(content(history)).toMatchObject({ width: 200, height: 100 });
    const after = corners(layers(history)[0] as Layer, 400, 200);
    before.forEach(([x, y], i) => {
      expect(after[i]?.[0]).toBeCloseTo(x / 2);
      expect(after[i]?.[1]).toBeCloseTo(y / 2);
    });
    expect(() => history.execute(resizeCanvas(0))).toThrow(AppError);
    expect(() => history.execute(resizeCanvas(20000))).toThrow(AppError);
  });

  it('rotating 90° clockwise moves every layer corner like a rotated sheet of paper', () => {
    const history = withLayers();
    history.execute(setLayerTransform('L2', { x: 120, y: 40, rotation: 30, scaleX: -0.7 }));
    const before = layers(history).map((l) =>
      corners(l, l.id === 'L1' ? 400 : 100, l.id === 'L1' ? 200 : 50),
    );
    history.execute(rotateCanvas('cw'));
    expect(content(history)).toMatchObject({ width: 200, height: 400 });
    layers(history).forEach((layer, index) => {
      const after = corners(layer, layer.id === 'L1' ? 400 : 100, layer.id === 'L1' ? 200 : 50);
      before[index]?.forEach(([x, y], i) => {
        expect(after[i]?.[0]).toBeCloseTo(200 - y, 6); // new x = old height - y
        expect(after[i]?.[1]).toBeCloseTo(x, 6); // new y = old x
      });
    });
  });

  it('rotating counter-clockwise is the inverse of clockwise', () => {
    const history = withLayers();
    history.execute(setLayerTransform('L2', { x: 77, y: 33, rotation: -20 }));
    const original = JSON.stringify(content(history).layers);
    history.execute(rotateCanvas('cw'));
    history.execute(rotateCanvas('ccw'));
    const restored = content(history);
    expect(restored).toMatchObject({ width: 400, height: 200 });
    JSON.parse(original) as unknown;
    layers(history).forEach((layer) => {
      const w = layer.id === 'L1' ? 400 : 100;
      const h = layer.id === 'L1' ? 200 : 50;
      const fresh = (JSON.parse(original) as { byId: Record<string, Layer> }).byId[
        layer.id
      ] as Layer;
      corners(layer, w, h).forEach(([x, y], i) => {
        expect(x).toBeCloseTo(corners(fresh, w, h)[i]?.[0] ?? NaN, 6);
        expect(y).toBeCloseTo(corners(fresh, w, h)[i]?.[1] ?? NaN, 6);
      });
    });
  });

  it('flips mirror every layer corner across the canvas', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const history = withLayers();
      history.execute(setLayerTransform('L2', { x: 120, y: 40, rotation: 25 }));
      const before = layers(history).map((l) =>
        corners(l, l.id === 'L1' ? 400 : 100, l.id === 'L1' ? 200 : 50),
      );
      history.execute(flipCanvas(axis));
      layers(history).forEach((layer, index) => {
        const after = corners(layer, layer.id === 'L1' ? 400 : 100, layer.id === 'L1' ? 200 : 50);
        // Mirroring reverses the corner order along the flipped axis, so compare as sets of points.
        const expected = (before[index] ?? []).map(([x, y]) =>
          axis === 'horizontal' ? [400 - x, y] : [x, 200 - y],
        );
        const key = (p: readonly number[]) => `${(p[0] ?? 0).toFixed(4)},${(p[1] ?? 0).toFixed(4)}`;
        expect(new Set(after.map(key))).toEqual(new Set(expected.map(key)));
      });
    }
  });
});

describe('undo and redo for every command', () => {
  const commands: [
    string,
    () => History<ProjectDocument>,
    Parameters<History<ProjectDocument>['execute']>[0],
  ][] = [
    ['add layer', newHistory, addImageLayer('L9', photo)],
    ['add adjustment', withLayers, addAdjustmentLayer('A9', 'exposure')],
    ['remove layer', withLayers, removeLayer('L1')],
    ['rename layer', withLayers, renameLayer('L1', 'New name')],
    ['hide layer', withLayers, setLayerVisible('L1', false)],
    ['opacity', withLayers, setLayerOpacity('L1', 0.3)],
    ['blend mode', withLayers, setLayerBlendMode('L1', 'overlay')],
    ['reorder', withLayers, moveLayer('L1', 1)],
    ['transform', withLayers, setLayerTransform('L1', { x: 5, y: 6, scaleX: -2, rotation: 90 })],
    ['background', withLayers, setBackground('#ffffff')],
    ['crop', withLayers, cropCanvas({ x: 10, y: 10, width: 100, height: 50 })],
    ['resize', withLayers, resizeCanvas(100)],
    ['rotate cw', withLayers, rotateCanvas('cw')],
    ['rotate ccw', withLayers, rotateCanvas('ccw')],
    ['flip horizontal', withLayers, flipCanvas('horizontal')],
    ['flip vertical', withLayers, flipCanvas('vertical')],
  ];

  it.each(commands)('%s round-trips exactly through undo and redo', (_name, setup, command) => {
    const history = setup();
    const before = history.state;
    history.execute(command);
    const after = history.state;
    expect(after).not.toEqual(before);
    expect(() => parseProject(after)).not.toThrow();
    history.undo();
    expect(history.state).toEqual(before);
    history.redo();
    expect(history.state).toEqual(after);
  });
});

describe('format migration v1 -> v2', () => {
  const v1 = (type: 'image' | 'video') => ({
    format: 'media-studio-project',
    formatVersion: 1,
    appVersion: '0.0.0',
    modifiedAt: NOW,
    journalSeq: 3,
    project: {
      id: 'old',
      name: 'Old project',
      type,
      createdAt: NOW,
      assets: { byId: {} },
      content: { kind: type },
    },
  });

  it('gives image projects an empty image document and keeps everything else', () => {
    const { file, migratedFrom } = parseProjectFile(v1('image'));
    expect(migratedFrom).toBe(1);
    expect(file.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(file.journalSeq).toBe(3);
    expect(file.project.content).toEqual({
      kind: 'image',
      width: 1920,
      height: 1080,
      background: null,
      layers: { byId: {} },
    });
  });

  it('gives video projects an empty sequence', () => {
    const { file } = parseProjectFile(v1('video'));
    expect(file.project.content).toMatchObject({ kind: 'video', clips: {} });
  });
});

describe('text and shape layers', () => {
  it('adds a centred text layer with readable defaults and edits it', () => {
    const history = withLayers();
    history.execute(addTextLayer('T1', 'Hello'));
    const layer = layers(history).at(-1);
    expect(layer).toMatchObject({
      type: 'text',
      name: 'Text',
      transform: { x: 200, y: 100 },
      spec: { text: 'Hello', fontFamily: 'sans-serif', fontWeight: 400, align: 'left' },
    });
    history.execute(
      setTextSpec('T1', { text: 'Changed', fontSize: 42, color: '#ff0000', align: 'center' }),
    );
    expect(layers(history).at(-1)).toMatchObject({
      spec: { text: 'Changed', fontSize: 42, color: '#ff0000', align: 'center' },
    });
    expect(() => parseProject(history.state)).not.toThrow();
  });

  it('rejects invalid text and shape settings before changing anything', () => {
    expect(() => setTextSpec('T1', { fontSize: 0 })).toThrow(AppError);
    expect(() => setTextSpec('T1', { color: 'red' })).toThrow(AppError);
    expect(() => setTextSpec('T1', { text: '' })).toThrow(AppError);
    expect(() => setShapeSpec('S1', { sides: 2 })).toThrow(AppError);
    expect(() => setShapeSpec('S1', { width: 0 })).toThrow(AppError);
    const history = withLayers();
    expect(() => history.execute(setTextSpec('L1', { fontSize: 20 }))).toThrow(AppError); // not a text layer
    expect(() => history.execute(setShapeSpec('L1', { width: 20 }))).toThrow(AppError);
  });

  it('adds each kind of shape with sensible defaults', () => {
    const history = withLayers();
    for (const shape of ['rectangle', 'ellipse', 'line', 'polygon'] as const) {
      history.execute(addShapeLayer(`S-${shape}`, shape));
    }
    const shapes = layers(history).filter((l) => l.type === 'shape');
    expect(shapes.map((l) => l.name)).toEqual(['Rectangle', 'Ellipse', 'Line', 'Polygon']);
    const line = shapes[2];
    expect(line).toMatchObject({
      spec: { shape: 'line', fill: null, stroke: '#000000', strokeWidth: 6 },
    });
    expect(() => parseProject(history.state)).not.toThrow();
    history.execute(
      setShapeSpec('S-rectangle', {
        width: 120,
        cornerRadius: 12,
        fill: null,
        stroke: '#112233',
        strokeWidth: 4,
      }),
    );
    expect(layers(history).find((l) => l.id === 'S-rectangle')).toMatchObject({
      spec: { width: 120, cornerRadius: 12, fill: null },
    });
  });

  it('text and shape layers take part in transforms, blend modes and canvas operations', () => {
    const history = withLayers();
    history.execute(addTextLayer('T1'));
    history.execute(addShapeLayer('S1', 'ellipse'));
    history.execute(setLayerBlendMode('T1', 'multiply'));
    history.execute(setLayerTransform('S1', { x: 50, y: 60, rotation: 30 }));
    history.execute(rotateCanvas('cw'));
    expect(layers(history).find((l) => l.id === 'S1')).toMatchObject({
      transform: { x: 200 - 60, y: 50, rotation: 120 },
    });
    history.execute(flipCanvas('horizontal'));
    expect(layers(history).find((l) => l.id === 'T1')).toMatchObject({
      blendMode: 'multiply',
      transform: { scaleX: -1 },
    });
    history.execute(cropCanvas({ x: 10, y: 10, width: 100, height: 100 }));
    history.execute(resizeCanvas(50));
    expect(() => parseProject(history.state)).not.toThrow();
  });

  it('adjustment layers still refuse blend modes and transforms', () => {
    const history = withLayers();
    history.execute(addAdjustmentLayer('A1', 'exposure'));
    expect(() => history.execute(setLayerTransform('A1', { x: 1 }))).toThrow(AppError);
  });

  it('undo and redo round-trip the new commands', () => {
    for (const command of [addTextLayer('T9'), addShapeLayer('S9', 'polygon')]) {
      const history = withLayers();
      const before = history.state;
      history.execute(command);
      const after = history.state;
      history.undo();
      expect(history.state).toEqual(before);
      history.redo();
      expect(history.state).toEqual(after);
    }
  });

  it('rasterKey is stable for equal specs and changes with any property', () => {
    const history = withLayers();
    history.execute(addTextLayer('T1'));
    const text = layers(history).at(-1);
    if (text?.type !== 'text') throw new Error('expected text');
    const a = rasterKey({ kind: 'text', ...text.spec });
    const reordered = rasterKey({
      kind: 'text',
      ...Object.fromEntries(Object.entries(text.spec).reverse()),
    } as never);
    expect(reordered).toBe(a);
    expect(rasterKey({ kind: 'text', ...text.spec, fontSize: text.spec.fontSize + 1 })).not.toBe(a);
  });
});

describe('levels, black & white, blur, sharpen and presets', () => {
  it('adds the new adjustment kinds with identity-like defaults and validates their settings', () => {
    const history = withLayers();
    for (const kind of ['levels', 'black-white', 'blur', 'sharpen'] as const) {
      history.execute(addAdjustmentLayer(`A-${kind}`, kind));
    }
    expect(
      layers(history)
        .slice(2)
        .map((l) => l.name),
    ).toEqual(['Levels', 'Black & White', 'Blur', 'Sharpen']);
    expect(() => parseProject(history.state)).not.toThrow();

    history.execute(setAdjustmentParams('A-levels', { inBlack: 0.1, inWhite: 0.9, gamma: 1.5 }));
    expect(() => history.execute(setAdjustmentParams('A-levels', { inBlack: 0.95 }))).toThrow(
      AppError,
    ); // would pass the white point
    expect(() => history.execute(setAdjustmentParams('A-blur', { radius: 500 }))).toThrow(AppError);
    expect(() => history.execute(setAdjustmentParams('A-sharpen', { radius: 0 }))).toThrow(
      AppError,
    );
    history.execute(setAdjustmentParams('A-blur', { radius: 12 }));
    expect(layers(history).find((l) => l.id === 'A-blur')).toMatchObject({
      adjustment: { kind: 'blur', radius: 12 },
    });
  });

  it('adds several adjustment layers as one undo step (presets)', () => {
    const history = withLayers();
    const before = history.state;
    history.execute(
      addAdjustmentLayers(
        [
          {
            id: 'P1',
            name: 'Vivid: saturation',
            adjustment: { kind: 'saturation', saturation: 0.3 },
          },
          {
            id: 'P2',
            name: 'Vivid: contrast',
            adjustment: { kind: 'brightness-contrast', brightness: 0, contrast: 0.2 },
          },
        ],
        'Apply Vivid',
      ),
    );
    expect(
      layers(history)
        .slice(2)
        .map((l) => l.id),
    ).toEqual(['P1', 'P2']);
    expect(history.undoLabel).toBe('Apply Vivid');
    history.undo();
    expect(history.state).toEqual(before);
  });
});

describe('duplicate and paste layers', () => {
  const setup = () => {
    const history = newHistory();
    history.execute(
      addAssets([
        {
          id: 'a1',
          kind: 'image',
          name: 'photo.png',
          mime: 'image/png',
          size: 1,
          width: 400,
          height: 200,
          file: 'media/a1.png',
          thumb: 'thumbs/a1.webp',
        },
      ]),
    );
    history.execute(addImageLayer('L1', photo));
    history.execute(addShapeLayer('S1', 'rectangle'));
    history.execute(addAdjustmentLayer('A1', 'levels'));
    return history;
  };
  const order = (history: History<ProjectDocument>) =>
    sortedItems(content(history).layers).map((l) => l.id);

  it('duplicates a layer directly above the original with the same settings and a new id', () => {
    const history = setup();
    history.execute(setLayerOpacity('L1', 0.4));
    history.execute(duplicateLayer('L1', 'L1b'));
    expect(order(history)).toEqual(['L1', 'L1b', 'S1', 'A1']);
    const copy = content(history).layers.byId['L1b'];
    expect(copy).toMatchObject({
      type: 'image',
      opacity: 0.4,
      name: 'photo.png copy',
      assetId: 'a1',
    });
  });

  it('keeps copies independent of the original', () => {
    const history = setup();
    history.execute(duplicateLayer('S1', 'S2'));
    history.execute(setShapeSpec('S2', { width: 12 }));
    const original = content(history).layers.byId['S1'];
    const copy = content(history).layers.byId['S2'];
    expect(original?.type === 'shape' && original.spec.width).not.toBe(12);
    expect(copy?.type === 'shape' && copy.spec.width).toBe(12);
  });

  it('duplicates adjustment layers with their parameters', () => {
    const history = setup();
    history.execute(setAdjustmentParams('A1', { gamma: 2 }));
    history.execute(duplicateLayer('A1', 'A2'));
    const copy = content(history).layers.byId['A2'];
    expect(copy?.type === 'adjustment' && copy.adjustment).toMatchObject({
      kind: 'levels',
      gamma: 2,
    });
  });

  it('pastes a snapshot above a given layer, or on top when that layer is gone', () => {
    const history = setup();
    const layer = content(history).layers.byId['S1'];
    if (!layer) throw new Error('missing');
    const snapshot = snapshotLayer(layer);
    history.execute(removeLayer('S1'));
    history.execute(pasteLayer(snapshot, 'P1', 'L1'));
    expect(order(history)).toEqual(['L1', 'P1', 'A1']);
    history.execute(pasteLayer(snapshot, 'P2', 'gone'));
    expect(order(history)).toEqual(['L1', 'P1', 'A1', 'P2']);
  });

  it('refuses to paste an image layer whose image is not in the project, and reused ids', () => {
    const history = setup();
    const layer = content(history).layers.byId['L1'];
    if (!layer) throw new Error('missing');
    const snapshot = snapshotLayer(layer);
    const other = newHistory();
    expect(() => {
      other.execute(pasteLayer(snapshot, 'X', null));
    }).toThrow(AppError);
    expect(() => {
      history.execute(pasteLayer(snapshot, 'L1', null));
    }).toThrow(AppError);
    expect(order(history)).toEqual(['L1', 'S1', 'A1']);
  });

  it('is one undo step', () => {
    const history = setup();
    history.execute(duplicateLayer('L1', 'L1b'));
    history.undo();
    expect(order(history)).toEqual(['L1', 'S1', 'A1']);
    history.redo();
    expect(order(history)).toEqual(['L1', 'L1b', 'S1', 'A1']);
  });
});

describe('addImageLayer position', () => {
  it('puts a later layer where it was dropped, but centres the first layer', () => {
    const history = newHistory();
    history.execute(addImageLayer('L1', { ...photo, id: 'a1' }, { x: 5, y: 5 }));
    expect(content(history).layers.byId['L1']).toMatchObject({ transform: { x: 200, y: 100 } });
    history.execute(
      addImageLayer('L2', { id: 'a2', name: 'small.png', width: 20, height: 20 }, { x: 30, y: 40 }),
    );
    expect(content(history).layers.byId['L2']).toMatchObject({ transform: { x: 30, y: 40 } });
  });
});
