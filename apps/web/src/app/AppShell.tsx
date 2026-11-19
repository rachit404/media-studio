import type { CapabilityReport } from '@media-studio/capabilities';
import { displayCombo } from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { useState } from 'react';
import { CommandPalette } from './CommandPalette';
import { shortcutRegistry } from './commands';
import { LimitationsBanner } from './LimitationsBanner';
import { UpdateBanner } from './UpdateBanner';
import { isMacPlatform } from './platform';
import { HomeScreen } from './screens/HomeScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';
import { SettingsDialog, type SettingsTab } from './settings/SettingsDialog';
import { ProjectScreen } from './project/ProjectScreen';
import { navigate, useHashRoute } from './use-hash-route';
import { useGlobalShortcuts } from './use-shortcuts';
import { toggleTheme } from './use-theme';

export function AppShell({ report }: { report: CapabilityReport }) {
  const route = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  useGlobalShortcuts({
    'palette.open': () => setPaletteOpen(true),
    'settings.open': () => openSettings('appearance'),
    'settings.shortcuts': () => openSettings('shortcuts'),
    'theme.toggle': toggleTheme,
    'nav.home': () => navigate({ name: 'home' }),
  });

  const hintFor = (command: string) =>
    shortcutRegistry
      .bindingsFor(command)
      .map((combo) => displayCombo(combo, isMacPlatform()))
      .join(' or ');
  const settingsHint = hintFor('settings.open');
  const paletteHint = hintFor('palette.open');

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex h-[3.25rem] items-center justify-between border-b border-line bg-surface-raised px-4">
        <a href="#/" className="text-base font-semibold">
          Media Studio
        </a>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onPress={() => setPaletteOpen(true)}>
            Commands
            {paletteHint && <span className="text-xs text-fg-muted">{paletteHint}</span>}
          </Button>
          <Button variant="ghost" onPress={() => openSettings('appearance')}>
            Settings
            {settingsHint && <span className="text-xs text-fg-muted">{settingsHint}</span>}
          </Button>
        </div>
      </header>

      <UpdateBanner />
      <LimitationsBanner limitations={report.limitations} />

      {route.name === 'home' && <HomeScreen />}
      {route.name === 'preview' && <WorkspaceScreen kind={route.kind} />}
      {route.name === 'project' && <ProjectScreen key={route.id} id={route.id} />}

      <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} />
      <SettingsDialog
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </div>
  );
}
