import { useEffect, useState } from 'react';
import { getStorage } from '../storage-client';

/** Thumbnail loaded from the project's storage. The object URL is revoked when the component goes away. */
export function AssetThumb({
  projectId,
  path,
  className,
}: {
  projectId: string;
  path: string;
  className: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void getStorage()
      .getFile(projectId, path)
      .then((bytes) => {
        if (!active || !bytes) return;
        const type = path.endsWith('.webp') ? 'image/webp' : 'image/png';
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, path]);

  return url ? (
    <img src={url} alt="" className={`${className} object-cover`} />
  ) : (
    <span aria-hidden="true" className={`${className} bg-surface-sunken`} />
  );
}
