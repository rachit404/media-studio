import { exposeRpc } from '@media-studio/storage';
import { StorageApi } from './storage-api';

// Dedicated worker: all OPFS access happens here (sync access handles are worker-only).
exposeRpc(new StorageApi(__APP_VERSION__), self, { lock: self.name });
