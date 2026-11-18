import { exposeRpc } from '@media-studio/storage';
import { AnalysisApi } from './analysis-api';

// Dedicated worker: decoding for thumbnails and waveforms never blocks the interface.
exposeRpc(new AnalysisApi(), self);
