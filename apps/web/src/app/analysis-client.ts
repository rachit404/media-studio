import { createSupervisedRpc, type Remote } from '@media-studio/storage';
import type { AnalysisApi } from '../workers/analysis-api';
import { diagnostics } from './diagnostics';

export type AnalysisClient = Remote<AnalysisApi>;

let client: AnalysisClient | undefined;

/** The analysis worker, created on first use and replaced if it dies. */
export function getAnalysis(): AnalysisClient {
  client ??= createSupervisedRpc<AnalysisApi>({
    spawn: (name) => {
      const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
        name,
      });
      worker.addEventListener('error', (event) => {
        diagnostics.log('error', 'analysis-worker', event.message || 'Analysis worker error');
      });
      return worker;
    },
    onCrash: (cause) => {
      diagnostics.log(
        'error',
        'analysis-worker',
        'The analysis worker stopped and will be restarted',
        {
          cause,
        },
      );
    },
  });
  return client;
}
