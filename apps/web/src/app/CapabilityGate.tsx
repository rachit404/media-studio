import {
  getBrowserEnv,
  probeCapabilities,
  type CapabilityReport,
} from '@media-studio/capabilities';
import { useEffect, useState, type ReactNode } from 'react';
import { diagnostics } from './diagnostics';
import { UnsupportedScreen } from './UnsupportedScreen';

/** Probes the browser once at start. Unsupported browsers get an explanation instead of a broken app (PLAT-2, PLAT-3). */
export function CapabilityGate({
  children,
}: {
  children: (report: CapabilityReport) => ReactNode;
}) {
  const [report, setReport] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    let active = true;
    void probeCapabilities(getBrowserEnv()).then((result) => {
      if (!active) return;
      diagnostics.log('info', 'capabilities', `Browser support tier: ${result.tier}`, {
        codecs: result.codecs,
        webgl2: result.webgl2,
        opfs: result.opfs,
        filePickers: result.filePickers,
      });
      setReport(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!report) {
    return (
      <p role="status" className="p-6 text-fg-muted">
        Checking your browser…
      </p>
    );
  }
  if (report.tier === 'unsupported') return <UnsupportedScreen issues={report.blockers} />;
  return <>{children(report)}</>;
}
