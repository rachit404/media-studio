import {
  History,
  PixelStore,
  addRasterLayer,
  addShapeLayer,
  commitPixels,
  createProject,
  createTile,
  setLayerClip,
  setLayerMask,
  setMaskEnabled,
  tileKey,
  type ImageContent,
} from '@media-studio/core';
import type { RasterMetrics } from '@media-studio/render';
import { describe, expect, it } from 'vitest';
import { buildScene } from './scene';

const metrics: RasterMetrics = {
  measure: (spec) =>
    spec.kind === 'text' ? { width: 100, height: 20 } : { width: spec.width, height: spec.height },
};

function setup() {
  const history = new History(
    createProject({ id: 'p', name: 'P', type: 'image', createdAt: '2026-11-18T10:00:00.000Z' }),
  );
  history.execute(addRasterLayer('R1'));
  const store = new PixelStore();
  const tile = createTile('t1', 4);
  store.commit('c1', null, new Map([[tileKey(0, 0), tile]]));
  history.execute(commitPixels('R1', 'layer', 'c1', 'stroke'));
  const content = (): ImageContent => {
    if (history.state.content.kind !== 'image') throw new Error('image');
    return history.state.content;
  };
  const build = () =>
    buildScene(content(), history.state.assets.byId, metrics, (_layer, target, id) =>
      target === 'layer' ? store.get(id) : store.get(id),
    );
  return { history, store, tile, build };
}

describe('buildScene with paint layers', () => {
  it('draws a paint layer from its pixels at the canvas size', () => {
    const { build, tile } = setup();
    const node = build().scene.nodes[0];
    expect(node).toMatchObject({
      type: 'image',
      id: 'R1',
      textureId: 'pixels:R1',
      width: 1920,
      height: 1080,
      pixels: { width: 1920, height: 1080, channels: 4 },
    });
    expect(node?.type === 'image' && node.pixels?.tiles.get('0,0')).toBe(tile);
    expect(build().textureIds).toEqual([]);
  });

  it('passes an enabled mask and leaves out a disabled one', () => {
    const { history, build } = setup();
    history.execute(setLayerMask('R1', { width: 1920, height: 1080, pixels: null }));
    const withMask = build().scene.nodes[0];
    expect(withMask?.type === 'image' && withMask.mask).toMatchObject({
      width: 1920,
      height: 1080,
      channels: 1,
    });
    history.execute(setMaskEnabled('R1', false));
    const without = build().scene.nodes[0];
    expect(without?.type === 'image' && without.mask).toBeUndefined();
  });

  it('marks clipped layers and gives generated layers their masks', () => {
    const { history, build } = setup();
    history.execute(addShapeLayer('S1', 'rectangle'));
    history.execute(setLayerClip('S1', true));
    history.execute(setLayerMask('S1', { width: 300, height: 200, pixels: null }));
    const shape = build().scene.nodes[1];
    expect(shape).toMatchObject({ clip: true });
    expect(shape?.type === 'image' && shape.mask?.width).toBe(300);
  });

  it('skips hidden paint layers', () => {
    const { history, build } = setup();
    history.execute({
      label: 'hide',
      apply(draft) {
        const content = draft.content;
        if (content.kind === 'image') {
          const layer = content.layers.byId['R1'];
          if (layer) layer.visible = false;
        }
      },
    });
    expect(build().scene.nodes).toHaveLength(0);
  });
});
