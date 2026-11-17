import type { ProjectDocument } from '@media-studio/core';
import { buildScene } from '@media-studio/engine-image';
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

  const content = project.content;
  if (content.kind !== 'image') throw new Error('ImageWorkspace needs an image project');

  const built = useMemo(
    () => buildScene(content, project.assets.byId),
    [content, project.assets.byId],
  );
  const selected = selectedId ? (content.layers.byId[selectedId] ?? null) : null;

  useGlobalShortcuts({
    'tool.move': () => setTool('move'),
    'tool.hand': () => setTool('hand'),
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
          />
        }
        rightContent={
          <div className="space-y-6">
            <LayersPanel
              session={session}
              content={content}
              selectedId={selected ? selectedId : null}
              onSelect={setSelectedId}
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
