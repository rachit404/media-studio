import {
  AppError,
  addImageLayer,
  duplicateLayer,
  pasteLayer,
  removeLayer,
  setLayerMask,
  snapshotLayer,
  type LayerSnapshot,
  type ProjectDocument,
} from '@media-studio/core';
import {
  buildScene,
  featherSelection,
  invertSelection,
  selectAll,
  selectionToMaskTiles,
  type CombineMode,
  type Selection,
} from '@media-studio/engine-image';
import { rasterMetrics } from '@media-studio/render';
import { Button } from '@media-studio/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { WorkspaceScreen } from '../../screens/WorkspaceScreen';
import { useGlobalShortcuts } from '../../use-shortcuts';
import { AssetLibrary } from '../AssetLibrary';
import type { ProjectSession } from '../project-session';
import { CanvasPanel } from './CanvasPanel';
import { ExportDialog } from './ExportDialog';
import { ImageCanvas, type Tool } from './ImageCanvas';
import { LayerInspector } from './LayerInspector';
import { LayersPanel } from './LayersPanel';
import { DEFAULT_PAINT, paintTargetFor, type LiveStroke, type PaintSettings } from './painting';
import { ToolOptions } from './ToolOptions';

export interface ImageWorkspaceProps {
  session: ProjectSession;
  project: ProjectDocument;
  heading: ReactNode;
  toolbar: ReactNode;
}

const TOOLS: readonly { id: Tool; label: string }[] = [
  { id: 'move', label: 'Move' },
  { id: 'hand', label: 'Hand' },
  { id: 'brush', label: 'Brush' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'select-rect', label: 'Rectangle select' },
  { id: 'select-ellipse', label: 'Ellipse select' },
  { id: 'select-lasso', label: 'Lasso select' },
];

/** The image editor: canvas in the middle, assets on the left, layers and properties on the right. */
export function ImageWorkspace({ session, project, heading, toolbar }: ImageWorkspaceProps) {
  const [tool, setTool] = useState<Tool>('move');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clipboard, setClipboard] = useState<LayerSnapshot | null>(null);
  const [paint, setPaint] = useState<PaintSettings>(DEFAULT_PAINT);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionMode, setSelectionMode] = useState<CombineMode>('replace');
  const [editMask, setEditMask] = useState(false);
  const [live, setLive] = useState<LiveStroke | null>(null);

  const content = project.content;
  if (content.kind !== 'image') throw new Error('ImageWorkspace needs an image project');

  // A selection belongs to one canvas size: drop it when crop, resize or rotate changes the canvas.
  useEffect(() => {
    setSelection(null);
  }, [content.width, content.height]);

  // Painted pixels come from the session's store, except for the layer being painted right now.
  const built = useMemo(
    () =>
      buildScene(content, project.assets.byId, rasterMetrics, (layerId, target, contentId) =>
        live?.layerId === layerId && live.target === target
          ? live.tiles
          : session.pixels.get(contentId),
      ),
    [content, project.assets.byId, session.pixels, live],
  );
  const selected = selectedId ? (content.layers.byId[selectedId] ?? null) : null;
  const selectedNode = built.scene.nodes.find((node) => node.id === selectedId);
  const selectedMasked =
    selected !== null && selected.type !== 'adjustment' && selected.mask !== undefined;
  const editingMask = editMask && selectedMasked;
  const paintTarget = paintTargetFor(selected, selectedNode, editingMask);
  const localSize =
    selectedNode?.type === 'image'
      ? { width: selectedNode.width, height: selectedNode.height }
      : null;

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

  const selectionToMask = () => {
    if (
      !selection ||
      !selected ||
      selected.type === 'adjustment' ||
      selectedNode?.type !== 'image'
    ) {
      return;
    }
    const { width, height } = selectedNode;
    const tiles = selectionToMaskTiles(selection, selectedNode.matrix, width, height, () =>
      crypto.randomUUID(),
    );
    const pixels = tiles.size > 0 ? session.createPixelVersion(null, 1, tiles) : null;
    history.execute(setLayerMask(selected.id, { width, height, pixels }));
    setEditMask(false);
  };
  const canvasSelectAll = () => setSelection(selectAll(content.width, content.height));

  useGlobalShortcuts({
    'tool.move': () => setTool('move'),
    'tool.hand': () => setTool('hand'),
    'tool.brush': () => setTool('brush'),
    'tool.eraser': () => setTool('eraser'),
    'tool.select': () => setTool('select-rect'),
    'tool.lasso': () => setTool('select-lasso'),
    'selection.all': canvasSelectAll,
    'selection.none': () => setSelection(null),
    'selection.invert': () =>
      setSelection((current) => (current ? invertSelection(current) : null)),
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
            <div role="group" aria-label="Tools" className="flex flex-wrap gap-1">
              {TOOLS.map(({ id, label }) => (
                <Button
                  key={id}
                  variant={tool === id ? 'primary' : 'secondary'}
                  aria-pressed={tool === id}
                  onPress={() => setTool(id)}
                >
                  {label}
                </Button>
              ))}
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
            paint={paint}
            paintTarget={paintTarget}
            selection={selection}
            selectionMode={selectionMode}
            onLiveStroke={setLive}
            onSelectionChange={setSelection}
            onDropAsset={(assetId, at) => {
              const asset = project.assets.byId[assetId];
              if (asset?.kind !== 'image') return;
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
            <ToolOptions
              tool={tool}
              paint={paint}
              onPaint={setPaint}
              editingMask={editingMask}
              selection={selection}
              selectionMode={selectionMode}
              onSelectionMode={setSelectionMode}
              onSelectAll={canvasSelectAll}
              onDeselect={() => setSelection(null)}
              onInvert={() =>
                setSelection((current) => (current ? invertSelection(current) : null))
              }
              onFeather={(radius) =>
                setSelection((current) => (current ? featherSelection(current, radius) : null))
              }
              onToMask={
                selected && selected.type !== 'adjustment' && localSize ? selectionToMask : null
              }
            />
            <LayerInspector
              session={session}
              layer={selected}
              localSize={localSize}
              editingMask={editingMask}
              onEditMask={setEditMask}
            />
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
        pixels={session.pixels}
      />
    </>
  );
}
