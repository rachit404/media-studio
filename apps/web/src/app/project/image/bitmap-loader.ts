import { AppError, type Asset } from '@media-studio/core';
import { getStorage } from '../../storage-client';

/**
 * Decode a stored asset for the GPU. The bitmap is premultiplied here because WebGL ignores the premultiply
 * pixel-store flag for ImageBitmap sources; premultiplied textures also filter correctly at transparent edges.
 */
export async function loadAssetBitmap(projectId: string, asset: Asset): Promise<ImageBitmap> {
  const bytes = await getStorage().getFile(projectId, asset.file);
  if (!bytes) {
    throw new AppError({
      code: 'invalid-project',
      message: `The file for "${asset.name}" is missing from this project.`,
      hint: 'Remove the layer or import the image again.',
    });
  }
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type: asset.mime }), {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'default',
    });
  } catch (error) {
    throw new AppError({
      code: 'decode-failed',
      message: `"${asset.name}" could not be read.`,
      cause: error,
    });
  }
}

/** Load several assets; the caller owns the bitmaps and must close them. */
export async function loadBitmaps(
  projectId: string,
  assets: Readonly<Record<string, Asset>>,
  ids: readonly string[],
): Promise<Map<string, ImageBitmap>> {
  const bitmaps = new Map<string, ImageBitmap>();
  try {
    for (const id of ids) {
      const asset = assets[id];
      if (asset) bitmaps.set(id, await loadAssetBitmap(projectId, asset));
    }
    return bitmaps;
  } catch (error) {
    for (const bitmap of bitmaps.values()) bitmap.close();
    throw error;
  }
}
