import {
  EMPTY_TILES,
  layerMatrix,
  rasterKey,
  sortedItems,
  type Asset,
  type ImageContent,
  type PlacedLayer,
  type RasterSpec,
  type TileMap,
} from '@media-studio/core';
import type { ImageNode, RasterMetrics, RenderScene, Rgb, SceneNode } from '@media-studio/render';

/** `#RRGGBB` to 0..1 channels. */
export function parseHexColor(hex: string): Rgb {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1];
  if (!value) throw new RangeError(`Invalid colour: ${hex}`);
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4) };
}

/** Finds the tiles for a painted surface: a paint layer's pixels or a layer mask's, by content id. */
export type PixelResolver = (
  layerId: string,
  target: 'layer' | 'mask',
  contentId: string | null,
) => TileMap;

const noPixels: PixelResolver = () => EMPTY_TILES;

/** Mask and clipping settings of a placed layer, as renderer node fields (only those that apply). */
function maskAndClip(layer: PlacedLayer, resolve: PixelResolver): Pick<ImageNode, 'mask' | 'clip'> {
  const extra: Pick<ImageNode, 'mask' | 'clip'> = {};
  if (layer.mask?.enabled) {
    extra.mask = {
      width: layer.mask.width,
      height: layer.mask.height,
      channels: 1,
      tiles: resolve(layer.id, 'mask', layer.mask.pixels),
    };
  }
  if (layer.clip) extra.clip = true;
  return extra;
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
  resolvePixels: PixelResolver = noPixels,
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
        ...maskAndClip(layer, resolvePixels),
      });
      continue;
    }
    if (layer.type === 'raster') {
      nodes.push({
        type: 'image',
        id: layer.id,
        textureId: `pixels:${layer.id}`,
        width: layer.width,
        height: layer.height,
        matrix: layerMatrix(layer.transform, layer.width, layer.height),
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        pixels: {
          width: layer.width,
          height: layer.height,
          channels: 4,
          tiles: resolvePixels(layer.id, 'layer', layer.pixels),
        },
        ...maskAndClip(layer, resolvePixels),
      });
      continue;
    }
    const asset = assets[layer.assetId];
    if (asset?.kind !== 'image') {
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
      ...maskAndClip(layer, resolvePixels),
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
