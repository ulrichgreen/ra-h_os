"use client";

import { useState, type ReactNode } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  LayoutList,
  Map,
  Folder,
  Table2,
  BookOpen,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from 'lucide-react';
import type { PaneType, NavigablePaneType } from '../panes/types';
import type { Theme } from '@/hooks/useTheme';

interface LeftToolbarProps {
  onSearchClick: () => void;
  onAddStuffClick: () => void;
  onRefreshClick: () => void;
  onSettingsClick: () => void;
  onPaneTypeClick: (paneType: NavigablePaneType) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  openTabTypes: Set<PaneType>;
  activeTabType: PaneType | null;
  theme: Theme;
  onThemeToggle: () => void;
}

const NAV_WIDTH_COLLAPSED = 50;
const NAV_WIDTH_EXPANDED = 280;

const VIEW_ITEMS: Array<{ paneType: NavigablePaneType; label: string; icon: typeof LayoutList }> = [
  { paneType: 'views', label: 'Nodes', icon: LayoutList },
  { paneType: 'skills', label: 'Skills', icon: BookOpen },
  { paneType: 'map', label: 'Map', icon: Map },
  { paneType: 'dimensions', label: 'Dimension', icon: Folder },
  { paneType: 'table', label: 'Table', icon: Table2 },
];

function NavButton({
  icon: Icon,
  label,
  expanded,
  active,
  onClick,
  trailing,
  activeTone = 'neutral',
  title,
}: {
  icon: typeof Search;
  label: string;
  expanded: boolean;
  active?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  activeTone?: 'neutral' | 'green';
  title?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const activeColor = activeTone === 'green' ? 'var(--rah-accent-green)' : 'var(--rah-text-active)';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title ?? (expanded ? undefined : label)}
      style={{
        width: '100%',
        height: '36px',
        borderRadius: '8px',
        border: 'none',
        background: active ? 'var(--rah-bg-hover)' : (hovered ? 'var(--rah-bg-subtle)' : 'transparent'),
        color: active ? activeColor : (hovered ? 'var(--rah-text-secondary)' : 'var(--rah-text-muted)'),
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: expanded ? 'space-between' : 'center',
        gap: '10px',
        padding: expanded ? '0 10px' : '0',
        transition: 'all 0.15s ease',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <Icon size={18} />
        {expanded ? (
          <span style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </span>
        ) : null}
      </span>
      {expanded ? trailing : null}
    </button>
  );
}

export default function LeftToolbar({
  onSearchClick,
  onAddStuffClick,
  onRefreshClick,
  onSettingsClick,
  onPaneTypeClick,
  isExpanded,
  onToggleExpanded,
  openTabTypes,
  activeTabType,
  theme,
  onThemeToggle,
}: LeftToolbarProps) {
  return (
    <div
      style={{
        width: isExpanded ? `${NAV_WIDTH_EXPANDED}px` : `${NAV_WIDTH_COLLAPSED}px`,
        height: '100%',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        flexShrink: 0,
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
        {/* Top: collapse + actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <NavButton
            icon={isExpanded ? PanelLeftClose : PanelLeftOpen}
            label={isExpanded ? 'Collapse' : 'Expand'}
            expanded={isExpanded}
            onClick={onToggleExpanded}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <NavButton icon={Search} label="Search" title="Search (⌘K)" expanded={isExpanded} onClick={onSearchClick} />
            <NavButton icon={Plus} label="Add Stuff" title="New node (⌘N)" expanded={isExpanded} onClick={onAddStuffClick} />
            <NavButton icon={RefreshCw} label="Refresh" expanded={isExpanded} onClick={onRefreshClick} />
          </div>
        </div>

        {/* Middle: view items, vertically centered */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
          <div style={{ borderTop: '1px solid var(--rah-border)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {VIEW_ITEMS.map((item) => (
                <NavButton
                  key={`${item.paneType}-${item.label}`}
                  icon={item.icon}
                  label={item.label}
                  expanded={isExpanded}
                  active={activeTabType === item.paneType || openTabTypes.has(item.paneType)}
                  onClick={() => onPaneTypeClick(item.paneType)}
                  activeTone="green"
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--rah-border)', paddingTop: '8px' }}>
        <NavButton
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          expanded={isExpanded}
          onClick={onThemeToggle}
        />
        <NavButton icon={Settings} label="Settings" expanded={isExpanded} onClick={onSettingsClick} />
      </div>
    </div>
  );
}
