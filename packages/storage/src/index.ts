// @media-studio/storage: persistence adapters (OPFS, memory), project store, archives and worker RPC.
export {
  ARCHIVE_LIMITS,
  buildArchive,
  isAllowedEntryName,
  isAssetPath,
  readArchive,
} from './archive';
export { EXPORT_JOB_ROOT, ExportJobStore, segmentCount } from './export-job';
export type { ExportJobInit, ExportJobState } from './export-job';
export { decodeText, encodeText, folderSize } from './fs-port';
export type { FileSystemPort, FsEntry } from './fs-port';
export { MemoryFileSystem } from './memory-fs';
export { OpfsFileSystem } from './opfs-fs';
export { probeWriteCapacity } from './probe';
export type { WriteProbeResult } from './probe';
export { ProjectStore } from './project-store';
export type {
  OpenResult,
  ProjectListing,
  ProjectStoreOptions,
  ProjectSummary,
  Recovery,
  StoreStats,
} from './project-store';
export { decodeTile, encodeTile } from './tile-codec';
export { createRpcClient, exposeRpc } from './rpc';
export type { PortLike, Remote } from './rpc';
