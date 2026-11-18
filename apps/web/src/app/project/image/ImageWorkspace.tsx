import {
  AppError,
  addImageLayer,
  duplicateLayer,
  pasteLayer,
  removeLayer,
  snapshotLayer,
  type LayerSnapshot,
  type ProjectDocument,
} from '@media-studio/core';
import { buildScene } from '@media-studio/engine-image';
import { rasterMetrics } from '@media-studio/render';
import { Button } from '@media-studio/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { WorkspaceScreen } from '../../screens/WorkspaceScreen';
import { useGlobalShortcuts } from '../../use-shortcuts';
import { AssetLibrary } from '../AssetLibrary';
import type { ProjectSession } from '../project-session';
import { CanvasPanel } from './CanvasPanel';
import { ExportDialog } from './ExportDialog';
import { ImageCanvas, type Tool } from './ImageCanvas';
import { LayerInspector } from './LayerInspector';
import { LayersPanel } from './LayersPanel';

export interface ImageWorkspaceProps {
  session: ProjectSession;
  project: ProjectDocument;
  heading: ReactNode;
  toolbar: ReactNode;
}

/** The image editor: canvas in the middle, assets on the left, layers and properties on the right. */
export function ImageWorkspace({ session, project, heading, toolbar }: ImageWorkspaceProps) {
  const [tool, setTool] = useState<Tool>('move');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clipboard, setClipboard] = useState<LayerSnapshot | null>(null);

  const content = project.content;
  if (content.kind !== 'image') throw new Error('ImageWorkspace needs an image project');

  const built = useMemo(
    () => buildScene(content, project.assets.byId, rasterMetrics),
    [content, project.assets.byId],
  );
  const selected = selectedId ? (content.layers.byId[selectedId] ?? null) : null;

  const { history } = session;
  const copyLayer = () => {
    if (selected) setClipboard(snapshotLayer(selected));
  };
  const pasteLayerFromClipboard = () => {
    if (!clipboard) return;
    const id = crypto.randomUUID();
    try {
      history.execute(pasteLayer(clipboard, id, selectedId));
      setSelectedId(id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // The copied layer's image is not in this project: there is nothing sensible to paste.
      setClipboard(null);
    }
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const id = crypto.randomUUID();
    history.execute(duplicateLayer(selected.id, id));
    setSelectedId(id);
  };
  const deleteSelected = () => {
    if (!selected) return;
    history.execute(removeLayer(selected.id));
    setSelectedId(null);
  };

  useGlobalShortcuts({
    'tool.move': () => setTool('move'),
    'tool.hand': () => setTool('hand'),
    'layer.copy': copyLayer,
    'layer.paste': pasteLayerFromClipboard,
    'layer.duplicate': duplicateSelected,
    'layer.delete': deleteSelected,
  });

  return (
    <>
      <WorkspaceScreen
        kind="image"
        heading={heading}
        toolbar={
          <>
            {toolbar}
            <div role="group" aria-label="Tools" className="flex gap-1">
              <Button
                variant={tool === 'move' ? 'primary' : 'secondary'}
                aria-pressed={tool === 'move'}
                onPress={() => setTool('move')}
              >
                Move
              </Button>
              <Button
                variant={tool === 'hand' ? 'primary' : 'secondary'}
                aria-pressed={tool === 'hand'}
                onPress={() => setTool('hand')}
              >
                Hand
              </Button>
            </div>
            <Button variant="primary" onPress={() => setExporting(true)}>
              Export…
            </Button>
          </>
        }
        leftContent={
          <AssetLibrary
            session={session}
            project={project}
            onAddedAsLayer={(layerId) => setSelectedId(layerId)}
          />
        }
        centerContent={
          <ImageCanvas
            session={session}
            scene={built.scene}
            textureIds={built.textureIds}
            assets={project.assets.byId}
            tool={tool}
            selectedLayerId={selectedId}
            canvasWidth={content.width}
            canvasHeight={content.height}
            onDropAsset={(assetId, at) => {
              const asset = project.assets.byId[assetId];
              if (!asset) return;
              const id = crypto.randomUUID();
              history.execute(addImageLayer(id, asset, at));
              setSelectedId(id);
            }}
          />
        }
        rightContent={
          <div className="space-y-6">
            <LayersPanel
              session={session}
              content={content}
              selectedId={selected ? selectedId : null}
              onSelect={setSelectedId}
              canPaste={clipboard !== null}
              onDuplicate={duplicateSelected}
              onCopy={copyLayer}
              onPaste={pasteLayerFromClipboard}
            />
            <LayerInspector session={session} layer={selected} />
            <CanvasPanel session={session} content={content} />
          </div>
        }
      />
      <ExportDialog
        isOpen={exporting}
        onClose={() => setExporting(false)}
        projectId={session.id}
        projectName={project.name}
        content={content}
        assets={project.assets.byId}
      />
    </>
  );
}
