import type { CapabilityReport } from '@media-studio/capabilities';
import { displayCombo } from '@media-studio/core';
import { Button } from '@media-studio/ui';
import { useState } from 'react';
import { shortcutRegistry } from './commands';
import { LimitationsBanner } from './LimitationsBanner';
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  useGlobalShortcuts({
    'settings.open': () => openSettings('appearance'),
    'settings.shortcuts': () => openSettings('shortcuts'),
    'theme.toggle': toggleTheme,
    'nav.home': () => navigate({ name: 'home' }),
  });

  const settingsHint = shortcutRegistry
    .bindingsFor('settings.open')
    .map((combo) => displayCombo(combo, isMacPlatform()))
    .join(' or ');

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex h-[3.25rem] items-center justify-between border-b border-line bg-surface-raised px-4">
        <a href="#/" className="text-base font-semibold">
          Media Studio
        </a>
        <Button variant="ghost" onPress={() => openSettings('appearance')}>
          Settings
          {settingsHint && <span className="text-xs text-fg-muted">{settingsHint}</span>}
        </Button>
      </header>

      <LimitationsBanner limitations={report.limitations} />

      {route.name === 'home' && <HomeScreen />}
      {route.name === 'preview' && <WorkspaceScreen kind={route.kind} />}
      {route.name === 'project' && <ProjectScreen key={route.id} id={route.id} />}

      <SettingsDialog
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </div>
  );
}
