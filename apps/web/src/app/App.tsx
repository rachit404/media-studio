import { AppShell } from './AppShell';
import { CapabilityGate } from './CapabilityGate';

export function App() {
  return <CapabilityGate>{(report) => <AppShell report={report} />}</CapabilityGate>;
}
