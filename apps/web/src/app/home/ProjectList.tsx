import type { ProjectListing, ProjectSummary } from '@media-studio/storage';
import { Button } from '@media-studio/ui';
import { AssetThumb } from '../project/AssetThumb';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export interface ProjectListProps {
  listing: ProjectListing;
  onExport: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}

export function ProjectList({ listing, onExport, onDelete }: ProjectListProps) {
  if (listing.projects.length === 0 && listing.broken.length === 0) {
    return <p className="mt-2 text-sm text-fg-muted">No projects yet.</p>;
  }
  return (
    <>
      <ul aria-label="Recent projects" className="mt-3 space-y-2">
        {listing.projects.map((project) => (
          <li
            key={project.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-raised p-3"
          >
            {project.thumbPath ? (
              <AssetThumb
                projectId={project.id}
                path={project.thumbPath}
                className="size-14 shrink-0 rounded-md"
              />
            ) : (
              <span aria-hidden="true" className="size-14 shrink-0 rounded-md bg-surface-sunken" />
            )}
            <span className="min-w-0 flex-1">
              <a
                className="block truncate font-medium text-accent underline"
                href={`#/project/${project.id}`}
              >
                {project.name}
              </a>
              <span className="block text-xs text-fg-muted">
                {project.type === 'image' ? 'Image' : 'Video'} project ·{' '}
                {String(project.assetCount)} {project.assetCount === 1 ? 'asset' : 'assets'} ·{' '}
                {formatDate(project.modifiedAt)}
              </span>
            </span>
            <Button
              variant="ghost"
              aria-label={`Export ${project.name}`}
              onPress={() => onExport(project)}
            >
              Export
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete ${project.name}`}
              onPress={() => onDelete(project)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      {listing.broken.length > 0 && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {String(listing.broken.length)} project{' '}
          {listing.broken.length === 1 ? 'folder' : 'folders'} could not be read and{' '}
          {listing.broken.length === 1 ? 'was' : 'were'} skipped.
        </p>
      )}
    </>
  );
}
