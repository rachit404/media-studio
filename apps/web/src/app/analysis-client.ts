import { createRpcClient, type Remote } from '@media-studio/storage';
import type { AnalysisApi } from '../workers/analysis-api';
import { diagnostics } from './diagnostics';

export type AnalysisClient = Remote<AnalysisApi>;

let client: AnalysisClient | undefined;

/** The analysis worker, created on first use. */
export function getAnalysis(): AnalysisClient {
  if (!client) {
    const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('error', (event) => {
      diagnostics.log('error', 'analysis-worker', event.message || 'Analysis worker error');
    });
    client = createRpcClient<AnalysisApi>(worker);
  }
  return client;
}
