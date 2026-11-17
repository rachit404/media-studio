import type { ReactNode } from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type Key,
} from 'react-aria-components';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  selectedKey?: string;
  onSelectionChange?: (id: string) => void;
}

export function Tabs({ label, items, selectedKey, onSelectionChange }: TabsProps) {
  const handleChange = (key: Key) => onSelectionChange?.(String(key));
  return (
    <AriaTabs
      {...(selectedKey !== undefined ? { selectedKey } : {})}
      onSelectionChange={handleChange}
    >
      <AriaTabList aria-label={label} className="mb-4 flex gap-1 border-b border-line">
        {items.map((item) => (
          <AriaTab
            key={item.id}
            id={item.id}
            className="cursor-pointer rounded-t-md px-3 py-2 text-sm text-fg-muted outline-offset-[-2px] data-[hovered]:text-fg data-[selected]:border-b-2 data-[selected]:border-accent data-[selected]:text-fg"
          >
            {item.label}
          </AriaTab>
        ))}
      </AriaTabList>
      {items.map((item) => (
        <AriaTabPanel key={item.id} id={item.id} className="outline-offset-2">
          {item.content}
        </AriaTabPanel>
      ))}
    </AriaTabs>
  );
}
