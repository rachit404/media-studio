import { formatTimecode, type ProjectDocument } from '@media-studio/core';
import { fitView, toViewTransform, type ViewState } from '@media-studio/engine-image';
import { CanvasRenderer } from '@media-studio/render';
import { Button } from '@media-studio/ui';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { diagnostics } from '../../diagnostics';
import { WorkspaceScreen } from '../../screens/WorkspaceScreen';
import { useGlobalShortcuts } from '../../use-shortcuts';
import type { ProjectSession } from '../project-session';
import { ExportVideoDialog } from './ExportVideoDialog';
import { MediaLibrary } from './MediaLibrary';
import { PreviewPlayer } from './preview-player';
import { Timeline } from './Timeline';
import { TransformHandles } from './TransformHandles';
import { VideoInspector } from './VideoInspector';

/** The video editor: media library, preview with transport, timeline and inspector. */
export function VideoWorkspace({
  session,
  project,
  heading,
  toolbar,
}: {
  session: ProjectSession;
  project: ProjectDocument;
  heading: ReactNode;
  toolbar: ReactNode;
}) {
  const content = project.content;
  if (content.kind !== 'video') throw new Error('VideoWorkspace needs a video project');
  const assets = project.assets.byId;
  const { sequence } = content;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLOutputElement>(null);
  const [renderer, setRenderer] = useState<CanvasRenderer | null>(null);
  const [player, setPlayer] = useState<PreviewPlayer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [graphicsProblem, setGraphicsProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // The renderer lives as long as the workspace; the canvas follows the size of its container.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let created: CanvasRenderer;
    try {
      created = new CanvasRenderer(canvas, {
        onError: (error) => {
          diagnostics.log(
            'error',
            'render',
            error instanceof Error ? error.message : 'Render failed',
          );
          setGraphicsProblem('The preview could not be drawn. Try reloading the page.');
        },
      });
    } catch (error) {
      setGraphicsProblem(error instanceof Error ? error.message : 'Graphics are unavailable.');
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      created.resize(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio);
    });
    observer.observe(container);
    setRenderer(created);
    return () => {
      observer.disconnect();
      created.dispose();
      setRenderer(null);
    };
  }, []);

  // The player needs the renderer; it reads the latest document through the session.
  useEffect(() => {
    if (!renderer) return;
    const created = new PreviewPlayer(session.id, renderer, () => {
      const state = session.history.state;
      if (state.content.kind !== 'video') throw new Error('video');
      return { content: state.content, assets: state.assets.byId };
    });
    setPlayer(created);
    return () => {
      created.dispose();
      setPlayer(null);
    };
  }, [renderer, session]);

  // Fit the picture into the preview area.
  useEffect(() => {
    const container = containerRef.current;
    if (!renderer || !container) return;
    const fit = () => {
      const box = container.getBoundingClientRect();
      const fitted = fitView(
        { width: sequence.width, height: sequence.height },
        { width: box.width, height: box.height },
        8,
      );
      renderer.setView(toViewTransform(fitted));
      setView(fitted);
      setViewport({ width: box.width, height: box.height });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [renderer, sequence.width, sequence.height]);

  // An edit, undo or redo changed the sequence or the media.
  useEffect(() => {
    player?.refresh();
  }, [player, content, assets]);

  // The clock readout moves without re-rendering.
  useEffect(() => {
    if (!player) return;
    return player.onTime((time) => {
      if (clockRef.current) clockRef.current.textContent = formatTimecode(time, sequence.fps);
    });
  }, [player, sequence.fps]);

  const state = useSyncExternalStore(
    (listener) => player?.subscribe(listener) ?? (() => undefined),
    () => player?.getState() ?? EMPTY_STATE,
  );

  useGlobalShortcuts({
    'transport.toggle': () => player?.toggle(),
    'transport.back': () => player?.step(-1),
    'transport.forward': () => player?.step(1),
    'transport.start': () => player?.seek(0),
    'transport.end': () => player?.seek(player.transport.duration),
  });

  const shownProblem = graphicsProblem ?? problem ?? state.problem;

  const center = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        className="relative min-h-40 flex-1 bg-canvas"
        data-testid="preview-container"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Video preview"
          data-testid="preview-canvas"
          className="absolute inset-0 size-full"
        />
        <TransformHandles
          session={session}
          content={content}
          assets={assets}
          clipId={selectedId}
          time={state.time}
          playing={state.playing}
          view={view}
          viewport={viewport}
          onProblem={setProblem}
        />
        {content.clips && Object.keys(content.clips).length === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-fg-muted">
            Import a video, then add it to the timeline to preview it here.
          </p>
        )}
      </div>

      <div
        role="group"
        aria-label="Playback"
        className="flex flex-wrap items-center justify-center gap-1 border-t border-line bg-surface px-2 py-1"
      >
        <Button variant="ghost" aria-label="Go to start" onPress={() => player?.seek(0)}>
          ⏮
        </Button>
        <Button variant="ghost" aria-label="Back one frame" onPress={() => player?.step(-1)}>
          ◀
        </Button>
        <Button
          variant="primary"
          aria-label={state.playing ? 'Pause' : 'Play'}
          onPress={() => player?.toggle()}
        >
          {state.playing ? 'Pause' : 'Play'}
        </Button>
        <Button variant="ghost" aria-label="Forward one frame" onPress={() => player?.step(1)}>
          ▶
        </Button>
        <Button
          variant="ghost"
          aria-label="Go to end"
          onPress={() => player?.seek(player.transport.duration)}
        >
          ⏭
        </Button>
        <output
          ref={clockRef}
          aria-label="Playhead time"
          data-testid="clock"
          className="ml-3 tabular-nums text-sm"
        >
          {formatTimecode(0, sequence.fps)}
        </output>
      </div>

      <p
        role="status"
        className={`min-h-6 px-3 text-xs ${shownProblem ? 'text-danger' : 'text-fg-muted'}`}
      >
        {shownProblem ?? ''}
      </p>

      <Timeline
        session={session}
        content={content}
        assets={assets}
        player={player}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onProblem={setProblem}
      />
    </div>
  );

  return (
    <WorkspaceScreen
      kind="video"
      heading={heading}
      toolbar={
        <>
          {toolbar}
          <Button
            variant="primary"
            onPress={() => {
              player?.pause();
              setExporting(true);
            }}
          >
            Export…
          </Button>
          <ExportVideoDialog
            projectId={session.id}
            project={project}
            content={content}
            isOpen={exporting}
            onClose={() => setExporting(false)}
          />
        </>
      }
      leftContent={
        <MediaLibrary
          session={session}
          project={project}
          content={content}
          playhead={() => player?.transport.time ?? 0}
          onAdded={setSelectedId}
        />
      }
      centerContent={center}
      rightContent={
        <VideoInspector
          session={session}
          content={content}
          assets={assets}
          selectedId={selectedId}
          time={state.time}
          onProblem={setProblem}
        />
      }
    />
  );
}

const EMPTY_STATE = { playing: false, time: 0, problem: null } as const;
