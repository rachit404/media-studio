import {
  layerMatrix,
  rasterKey,
  sortedItems,
  type Asset,
  type ImageContent,
  type RasterSpec,
} from '@media-studio/core';
import type { RasterMetrics, RenderScene, Rgb, SceneNode } from '@media-studio/render';

/** `#RRGGBB` to 0..1 channels. */
export function parseHexColor(hex: string): Rgb {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1];
  if (!value) throw new RangeError(`Invalid colour: ${hex}`);
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4) };
}

export interface BuiltScene {
  scene: RenderScene;
  /** Asset ids of visible image layers, i.e. the textures the renderer needs. */
  textureIds: string[];
  /** Visible image layers whose asset is not in the project (their layers are skipped). */
  missingAssets: string[];
}

/** Turn the image document into what the renderer draws: visible layers only, bottom to top. */
export function buildScene(
  content: ImageContent,
  assets: Readonly<Record<string, Asset>>,
  metrics: RasterMetrics,
): BuiltScene {
  const nodes: SceneNode[] = [];
  const textureIds = new Set<string>();
  const missing = new Set<string>();

  for (const layer of sortedItems(content.layers)) {
    if (!layer.visible) continue;
    if (layer.type === 'adjustment') {
      nodes.push({
        type: 'adjustment',
        id: layer.id,
        adjustment: layer.adjustment,
        opacity: layer.opacity,
      });
      continue;
    }
    if (layer.type === 'text' || layer.type === 'shape') {
      const raster: RasterSpec =
        layer.type === 'text' ? { kind: 'text', ...layer.spec } : { kind: 'shape', ...layer.spec };
      const { width, height } = metrics.measure(raster);
      nodes.push({
        type: 'image',
        id: layer.id,
        textureId: rasterKey(raster),
        width,
        height,
        matrix: layerMatrix(layer.transform, width, height),
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        raster,
      });
      continue;
    }
    const asset = assets[layer.assetId];
    if (!asset) {
      missing.add(layer.assetId);
      continue;
    }
    textureIds.add(asset.id);
    nodes.push({
      type: 'image',
      id: layer.id,
      textureId: asset.id,
      width: asset.width,
      height: asset.height,
      matrix: layerMatrix(layer.transform, asset.width, asset.height),
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    });
  }

  return {
    scene: {
      width: content.width,
      height: content.height,
      background: content.background ? parseHexColor(content.background) : null,
      nodes,
    },
    textureIds: [...textureIds],
    missingAssets: [...missing],
  };
}
