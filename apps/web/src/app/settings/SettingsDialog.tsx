import { Dialog, Tabs, type TabItem } from '@media-studio/ui';
import { AppearancePanel } from './AppearancePanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ShortcutsPanel } from './ShortcutsPanel';

export type SettingsTab = 'appearance' | 'shortcuts' | 'diagnostics';

const TABS: readonly TabItem[] = [
  { id: 'appearance', label: 'Appearance', content: <AppearancePanel /> },
  { id: 'shortcuts', label: 'Shortcuts', content: <ShortcutsPanel /> },
  { id: 'diagnostics', label: 'Diagnostics', content: <DiagnosticsPanel /> },
];

export interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsDialog({ isOpen, onOpenChange, tab, onTabChange }: SettingsDialogProps) {
  return (
    <Dialog title="Settings" isOpen={isOpen} onOpenChange={onOpenChange}>
      <Tabs
        label="Settings sections"
        items={TABS}
        selectedKey={tab}
        onSelectionChange={(id) => onTabChange(id as SettingsTab)}
      />
    </Dialog>
  );
}
