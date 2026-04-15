"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import SettingsModal, { SettingsTab } from '../settings/SettingsModal';
import SearchModal from '../nodes/SearchModal';
import type { ContextSummary, Node } from '@/types/database';
import { DatabaseEvent } from '@/services/events';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useTheme } from '@/hooks/useTheme';

import LeftToolbar from './LeftToolbar';
import SplitHandle from './SplitHandle';

import { NodePane, ContextsPane, MapPane, ViewsPane, TablePane, SkillsPane, SlotTabBar } from '../panes';
import QuickAddInput from '../agents/QuickAddInput';
import type { PaneType, SlotState, SlotTab, PaneAction, SlotId } from '../panes/types';
import { createTabId, getActiveTab } from '../panes/types';

export interface PendingNode {
  id: string;
  input: string;
  inputType: string;
  submittedAt: number;
  status: 'processing' | 'error';
  error?: string;
}

const SLOT_A_KEY = 'ui.slotA.v7';
const SLOT_B_KEY = 'ui.slotB.v7';
const SLOT_C_KEY = 'ui.slotC.v7';
const VISIBLE_PANE_COUNT_KEY = 'ui.visiblePaneCount.v1';
const PANEL_A_EXPANDED_KEY = 'ui.panelA.expanded.v1';
const PANEL_B_EXPANDED_KEY = 'ui.panelB.expanded.v1';
const PANEL_C_EXPANDED_KEY = 'ui.panelC.expanded.v1';
const PANEL_A_WEIGHT_KEY = 'ui.panelA.weight.v1';
const PANEL_B_WEIGHT_KEY = 'ui.panelB.weight.v1';
const PANEL_C_WEIGHT_KEY = 'ui.panelC.weight.v1';
const LEFT_NAV_EXPANDED_KEY = 'ui.leftNavExpanded';
const ACTIVE_CONTEXT_KEY = 'ui.focus.activeContextId';

const VALID_PANE_TYPES = new Set<PaneType>(['node', 'contexts', 'map', 'views', 'table', 'skills']);

const DEFAULT_SLOT_A: SlotState = {
  tabs: [{ id: 'views', type: 'views' }],
  activeTabId: 'views',
};

const EMPTY_SEARCH_FILTERS: Array<{ type: 'context' | 'title' | 'tag'; value: string }> = [];
const SLOT_ORDER: SlotId[] = ['A', 'B', 'C'];

function createSingletonState(type: Exclude<PaneType, 'node'>): SlotState {
  return {
    tabs: [{ id: createTabId(type), type }],
    activeTabId: createTabId(type),
  };
}

function migrateSlotState(raw: unknown): SlotState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;

  if (Array.isArray(value.tabs)) {
    const tabs: SlotTab[] = [];
    for (const tab of value.tabs) {
      if (!tab || typeof tab !== 'object') continue;
      const tabValue = tab as Record<string, unknown>;
      const rawType = tabValue.type === 'guides' ? 'skills' : tabValue.type;
      if (typeof rawType !== 'string' || !VALID_PANE_TYPES.has(rawType as PaneType)) continue;

      tabs.push({
        id: typeof tabValue.id === 'string'
          ? tabValue.id
          : createTabId(rawType as PaneType, typeof tabValue.nodeId === 'number' ? tabValue.nodeId : undefined),
        type: rawType as PaneType,
        ...(typeof tabValue.nodeId === 'number' ? { nodeId: tabValue.nodeId } : {}),
      });
    }

    if (tabs.length === 0) return null;

    const activeTabId = typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0].id;

    return { tabs, activeTabId };
  }

  if (typeof value.type === 'string') {
    const rawType = value.type === 'guides' ? 'skills' : value.type;
    if (rawType === 'dimensions') return null;
    if (!VALID_PANE_TYPES.has(rawType as PaneType)) return null;

    if (rawType === 'node') {
      const nodeTabs = Array.isArray(value.nodeTabs)
        ? value.nodeTabs.filter((nodeId): nodeId is number => typeof nodeId === 'number')
        : [];
      if (nodeTabs.length === 0) return null;
      const tabs = nodeTabs.map((nodeId) => ({ id: createTabId('node', nodeId), type: 'node' as const, nodeId }));
      const preferredNodeId = typeof value.activeNodeTab === 'number' ? value.activeNodeTab : nodeTabs[0];
      return {
        tabs,
        activeTabId: createTabId('node', preferredNodeId),
      };
    }

    return createSingletonState(rawType as Exclude<PaneType, 'node'>);
  }

  return null;
}

function sanitizeSlotState(state: SlotState | null, fallback: SlotState | null = null): SlotState | null {
  const migrated = migrateSlotState(state);
  return migrated ?? fallback;
}

function areSlotStatesEqual(a: SlotState | null, b: SlotState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.activeTabId !== b.activeTabId) return false;
  if (a.tabs.length !== b.tabs.length) return false;

  return a.tabs.every((tab, index) => {
    const other = b.tabs[index];
    return (
      tab.id === other?.id &&
      tab.type === other?.type &&
      tab.nodeId === other?.nodeId
    );
  });
}

function getSlotTabsByType(state: SlotState | null, type: PaneType): SlotTab[] {
  return state?.tabs.filter((tab) => tab.type === type) ?? [];
}

export default function ThreePanelLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<SlotId, HTMLDivElement | null>>({ A: null, B: null, C: null });
  const [theme, toggleTheme] = useTheme();

  const [slotA, setSlotA] = usePersistentState<SlotState | null>(SLOT_A_KEY, DEFAULT_SLOT_A);
  const [slotB, setSlotB] = usePersistentState<SlotState | null>(SLOT_B_KEY, null);
  const [slotC, setSlotC] = usePersistentState<SlotState | null>(SLOT_C_KEY, null);
  const [visiblePaneCount, setVisiblePaneCount] = usePersistentState<number>(VISIBLE_PANE_COUNT_KEY, 2);

  const [panelAExpanded, setPanelAExpanded] = usePersistentState<boolean>(PANEL_A_EXPANDED_KEY, true);
  const [panelBExpanded, setPanelBExpanded] = usePersistentState<boolean>(PANEL_B_EXPANDED_KEY, false);
  const [panelCExpanded, setPanelCExpanded] = usePersistentState<boolean>(PANEL_C_EXPANDED_KEY, false);
  const [panelAWeight, setPanelAWeight] = usePersistentState<number>(PANEL_A_WEIGHT_KEY, 1);
  const [panelBWeight, setPanelBWeight] = usePersistentState<number>(PANEL_B_WEIGHT_KEY, 1);
  const [panelCWeight, setPanelCWeight] = usePersistentState<number>(PANEL_C_WEIGHT_KEY, 1);
  const [leftNavExpanded, setLeftNavExpanded] = usePersistentState<boolean>(LEFT_NAV_EXPANDED_KEY, false);
  const [activeContextId, setActiveContextId] = usePersistentState<number | null>(ACTIVE_CONTEXT_KEY, null);

  const [activePane, setActivePane] = useState<SlotId>('A');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>();
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showAddStuff, setShowAddStuff] = useState(false);
  const [nodesPanelRefresh, setNodesPanelRefresh] = useState(0);
  const [focusPanelRefresh, setFocusPanelRefresh] = useState(0);
  const [availableContexts, setAvailableContexts] = useState<ContextSummary[]>([]);
  const [browseContextFilters, setBrowseContextFilters] = useState<Record<SlotId, number | null>>({
    A: null,
    B: null,
    C: null,
  });
  const [highlightedPassage, setHighlightedPassage] = useState<{
    nodeId: number;
    nodeTitle: string;
    selectedText: string;
  } | null>(null);
  const [pendingNodes, setPendingNodes] = useState<PendingNode[]>([]);
  const [dragOverSlot, setDragOverSlot] = useState<SlotId | null>(null);
  const openNodeIdsRef = useRef<number[]>([]);
  const handleNodeDeletedRef = useRef<(nodeId: number) => void>(() => {});

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialTab(undefined);
  }, []);

  useEffect(() => {
    setSlotA((prev) => {
      const next = sanitizeSlotState(prev, DEFAULT_SLOT_A);
      return areSlotStatesEqual(prev, next) ? prev : next;
    });
    setSlotB((prev) => {
      const next = sanitizeSlotState(prev);
      return areSlotStatesEqual(prev, next) ? prev : next;
    });
    setSlotC((prev) => {
      const next = sanitizeSlotState(prev);
      return areSlotStatesEqual(prev, next) ? prev : next;
    });
  }, [setSlotA, setSlotB, setSlotC]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/contexts');
        const payload = await response.json();
        if (response.ok && payload.success) {
          setAvailableContexts(payload.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch contexts:', error);
      }
    })();
  }, [nodesPanelRefresh]);

  const getSlotState = useCallback((slot: SlotId): SlotState | null => {
    switch (slot) {
      case 'A':
        return slotA;
      case 'B':
        return slotB;
      case 'C':
        return slotC;
    }
  }, [slotA, slotB, slotC]);

  const getSlotSetter = useCallback((slot: SlotId) => {
    switch (slot) {
      case 'A':
        return setSlotA;
      case 'B':
        return setSlotB;
      case 'C':
        return setSlotC;
    }
  }, [setSlotA, setSlotB, setSlotC]);

  const visibleSlots = useMemo(
    () => SLOT_ORDER.slice(0, Math.max(1, Math.min(3, visiblePaneCount))),
    [visiblePaneCount]
  );

  const isPanelExpanded = useCallback((slot: SlotId) => {
    return visibleSlots.includes(slot);
  }, [visibleSlots]);

  const setPanelExpanded = useCallback((slot: SlotId, expanded: boolean) => {
    if (!expanded) {
      return;
    }

    const requiredCount = SLOT_ORDER.indexOf(slot) + 1;
    setVisiblePaneCount((current) => Math.max(current, requiredCount));
  }, [setVisiblePaneCount]);

  const getPanelWeight = useCallback((slot: SlotId) => {
    switch (slot) {
      case 'A':
        return panelAWeight;
      case 'B':
        return panelBWeight;
      case 'C':
        return panelCWeight;
    }
  }, [panelAWeight, panelBWeight, panelCWeight]);

  const setPanelWeight = useCallback((slot: SlotId, weight: number) => {
    const next = Math.max(0.6, Math.min(3, weight));
    switch (slot) {
      case 'A':
        setPanelAWeight(next);
        break;
      case 'B':
        setPanelBWeight(next);
        break;
      case 'C':
        setPanelCWeight(next);
        break;
    }
  }, [setPanelAWeight, setPanelBWeight, setPanelCWeight]);

  const slotStates = useMemo<Record<SlotId, SlotState | null>>(() => ({ A: slotA, B: slotB, C: slotC }), [slotA, slotB, slotC]);

  const allOpenNodeIds = useMemo(() => {
    const ids = new Set<number>();
    (Object.values(slotStates) as Array<SlotState | null>).forEach((state) => {
      getSlotTabsByType(state, 'node').forEach((tab) => {
        if (tab.nodeId != null) ids.add(tab.nodeId);
      });
    });
    return [...ids];
  }, [slotStates]);

  useEffect(() => {
    openNodeIdsRef.current = allOpenNodeIds;
  }, [allOpenNodeIds]);

  useEffect(() => {
    setPanelAExpanded(true);
    setPanelBExpanded(visiblePaneCount >= 2);
    setPanelCExpanded(visiblePaneCount >= 3);
  }, [setPanelAExpanded, setPanelBExpanded, setPanelCExpanded, visiblePaneCount]);

  useEffect(() => {
    if (!visibleSlots.includes(activePane)) {
      setActivePane(visibleSlots[0] ?? 'A');
    }
  }, [activePane, visibleSlots]);

  const activeNodeId = useMemo(() => {
    const activeSlotState = slotStates[activePane];
    const activeTab = activeSlotState ? getActiveTab(activeSlotState) : undefined;
    if (activeTab?.type === 'node' && activeTab.nodeId != null) {
      return activeTab.nodeId;
    }

    for (const slot of ['A', 'B', 'C'] as SlotId[]) {
      const state = slotStates[slot];
      const tab = state ? getActiveTab(state) : undefined;
      if (tab?.type === 'node' && tab.nodeId != null) {
        return tab.nodeId;
      }
    }

    return allOpenNodeIds[0] ?? null;
  }, [activePane, allOpenNodeIds, slotStates]);

  const handleRefreshAll = useCallback(() => {
    setNodesPanelRefresh((prev) => prev + 1);
    setFocusPanelRefresh((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setShowSearchModal(true);
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        if (document.activeElement?.closest('[data-rah-app]')) {
          event.preventDefault();
          setShowAddStuff(true);
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        handleRefreshAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRefreshAll]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');
      eventSource.onmessage = (event) => {
        try {
          const data: DatabaseEvent = JSON.parse(event.data);

          switch (data.type) {
            case 'NODE_CREATED':
              setNodesPanelRefresh((prev) => prev + 1);
              break;
            case 'NODE_UPDATED':
              setNodesPanelRefresh((prev) => prev + 1);
              if (openNodeIdsRef.current.includes(Number(data.data.nodeId))) {
                setFocusPanelRefresh((prev) => prev + 1);
              }
              break;
            case 'NODE_DELETED':
              handleNodeDeletedRef.current(Number(data.data.nodeId));
              setNodesPanelRefresh((prev) => prev + 1);
              break;
            case 'EDGE_CREATED':
            case 'EDGE_DELETED':
              setFocusPanelRefresh((prev) => prev + 1);
              break;
            case 'GUIDE_UPDATED':
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('skills:updated', { detail: data.data }));
              }
              break;
            case 'QUICK_ADD_COMPLETED':
              if (data.data?.quickAddId) {
                setPendingNodes((prev) => prev.filter((item) => item.id !== data.data.quickAddId));
                setNodesPanelRefresh((prev) => prev + 1);
              }
              break;
            case 'QUICK_ADD_FAILED':
              if (data.data?.quickAddId) {
                setPendingNodes((prev) => prev.map((item) => (
                  item.id === data.data.quickAddId
                    ? { ...item, status: 'error', error: data.data.error || 'Unknown error' }
                    : item
                )));
              }
              break;
          }
        } catch (error) {
          console.error('Failed to parse SSE event:', error);
        }
      };
    } catch (error) {
      console.error('Failed to establish SSE connection:', error);
    }

    return () => {
      eventSource?.close();
    };
  }, []);

  useEffect(() => {
    if (pendingNodes.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setPendingNodes((prev) => prev.filter((item) => {
        const age = now - item.submittedAt;
        if (item.status === 'processing' && age > 90_000) return false;
        if (item.status === 'error' && age > 120_000) return false;
        return true;
      }));
    }, 5000);

    return () => clearInterval(timer);
  }, [pendingNodes.length]);

  const upsertSingletonTab = useCallback((slot: SlotId, paneType: Exclude<PaneType, 'node'>) => {
    const tabId = createTabId(paneType);
    const setter = getSlotSetter(slot);

    setter({ tabs: [{ id: tabId, type: paneType }], activeTabId: tabId });

    setPanelExpanded(slot, true);
    setActivePane(slot);
  }, [getSlotSetter, setPanelExpanded]);

  const addNodeTabToSlot = useCallback((slot: SlotId, nodeId: number) => {
    const nodeTabId = createTabId('node', nodeId);
    const setter = getSlotSetter(slot);

    setter((prev) => {
      const current = sanitizeSlotState(prev);
      const nodeTabs = (current?.tabs ?? []).filter((tab) => tab.type === 'node');
      if (nodeTabs.some((tab) => tab.id === nodeTabId)) {
        return { tabs: nodeTabs, activeTabId: nodeTabId };
      }
      return {
        tabs: [...nodeTabs, { id: nodeTabId, type: 'node', nodeId }],
        activeTabId: nodeTabId,
      };
    });

    setPanelExpanded(slot, true);
    setActivePane(slot);
  }, [getSlotSetter, setPanelExpanded]);

  const closeTabInSlot = useCallback((slot: SlotId, tabId: string) => {
    const setter = getSlotSetter(slot);

    setter((prev) => {
      const current = sanitizeSlotState(prev);
      if (!current) return null;

      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      if (tabs.length === 0) {
        return null;
      }

      const activeTabId = current.activeTabId === tabId
        ? tabs[Math.max(0, tabs.length - 1)].id
        : current.activeTabId;

      return { tabs, activeTabId };
    });
  }, [getSlotSetter]);

  const openNodeFromSlot = useCallback((nodeId: number, fromSlot?: SlotId) => {
    const existingTabId = createTabId('node', nodeId);

    for (const slot of visibleSlots) {
      const state = getSlotState(slot);
      if (state?.tabs.some((tab) => tab.id === existingTabId)) {
        getSlotSetter(slot)({ tabs: state.tabs, activeTabId: existingTabId });
        setActivePane(slot);
        return;
      }
    }

    const visibleNodeSlots = visibleSlots.filter((slot) => {
      const state = getSlotState(slot);
      return state?.tabs.some((tab) => tab.type === 'node');
    });

    const preferredNodeTarget = fromSlot && visibleNodeSlots.includes(fromSlot)
      ? fromSlot
      : visibleNodeSlots.includes(activePane)
        ? activePane
        : visibleNodeSlots[0];

    if (preferredNodeTarget) {
      addNodeTabToSlot(preferredNodeTarget, nodeId);
      setActivePane(preferredNodeTarget);
      return;
    }

    const emptyTarget = visibleSlots.find((slot) => {
      const state = getSlotState(slot);
      return !state || state.tabs.length === 0;
    });
    const target = emptyTarget
      ?? (visibleSlots.includes(activePane) ? activePane : null)
      ?? visibleSlots[visibleSlots.length - 1]
      ?? 'A';

    addNodeTabToSlot(target, nodeId);
  }, [activePane, addNodeTabToSlot, getSlotSetter, getSlotState, visibleSlots]);

  const openPaneSingleton = useCallback((paneType: Exclude<PaneType, 'node'>, preferredSlot?: SlotId) => {
    for (const slot of visibleSlots) {
      const state = getSlotState(slot);
      if (state?.tabs.some((tab) => tab.type === paneType)) {
        getSlotSetter(slot)({ tabs: state.tabs, activeTabId: createTabId(paneType) });
        setPanelExpanded(slot, true);
        setActivePane(slot);
        return slot;
      }
    }

    const orderedSlots = preferredSlot && visibleSlots.includes(preferredSlot)
      ? [preferredSlot, ...visibleSlots.filter((slot) => slot !== preferredSlot)]
      : visibleSlots;
    const emptyTarget = orderedSlots.find((slot) => {
      const state = getSlotState(slot);
      return !state || state.tabs.length === 0;
    });
    const target = emptyTarget
      ?? (orderedSlots.includes(activePane) ? activePane : null)
      ?? orderedSlots[orderedSlots.length - 1]
      ?? 'A';

    upsertSingletonTab(target, paneType);
    return target;
  }, [activePane, getSlotSetter, getSlotState, setPanelExpanded, upsertSingletonTab, visibleSlots]);

  const handleTabSelect = useCallback((slot: SlotId, tabId: string) => {
    const state = getSlotState(slot);
    if (!state) return;
    getSlotSetter(slot)({ tabs: state.tabs, activeTabId: tabId });
    setActivePane(slot);
  }, [getSlotSetter, getSlotState]);

  const handleNodeDeleted = useCallback((nodeId: number) => {
    const tabId = createTabId('node', nodeId);
    (['A', 'B', 'C'] as SlotId[]).forEach((slot) => closeTabInSlot(slot, tabId));
  }, [closeTabInSlot]);

  useEffect(() => {
    handleNodeDeletedRef.current = handleNodeDeleted;
  }, [handleNodeDeleted]);

  const handleReorderTabs = useCallback((slot: SlotId, fromIndex: number, toIndex: number) => {
    const state = getSlotState(slot);
    if (!state || fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.tabs.length || toIndex >= state.tabs.length) return;

    const tabs = [...state.tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    getSlotSetter(slot)({ tabs, activeTabId: state.activeTabId });
  }, [getSlotSetter, getSlotState]);

  const handleCrossSlotDrop = useCallback((targetSlot: SlotId, tab: SlotTab, fromSlot: SlotId) => {
    closeTabInSlot(fromSlot, tab.id);
    if (tab.type === 'node' && tab.nodeId != null) {
      addNodeTabToSlot(targetSlot, tab.nodeId);
      return;
    }
    if (tab.type !== 'node') {
      upsertSingletonTab(targetSlot, tab.type);
    }
  }, [addNodeTabToSlot, closeTabInSlot, upsertSingletonTab]);

  const handleContextSelect = useCallback((slot: SlotId, contextId: number | null, _contextName?: string | null) => {
    setBrowseContextFilters((prev) => ({ ...prev, [slot]: contextId }));
    setActiveContextId(contextId);
    if (contextId != null) {
      openPaneSingleton('views', slot);
    }
  }, [openPaneSingleton, setActiveContextId]);

  const handleQuickAddSubmit = useCallback(async ({ input, mode, description }: { input: string; mode: 'link' | 'text'; description?: string }) => {
    try {
      const response = await fetch('/api/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          mode,
          description,
          contextId: activeContextId,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to submit Quick Add');
      }

      const payload = await response.json();
      const result = payload.result as { id?: string; inputType?: string } | undefined;
      if (result?.id) {
        setPendingNodes((prev) => [{
          id: result.id!,
          input: input.trim(),
          inputType: result.inputType || 'note',
          submittedAt: Date.now(),
          status: 'processing',
        }, ...prev]);
      }

      openPaneSingleton('views', 'A');
      setShowAddStuff(false);
    } catch (error) {
      console.error('[ThreePanelLayout] Quick Add failed:', error);
    }
  }, [activeContextId, openPaneSingleton]);

  const handleSlotAction = useCallback((slot: SlotId, action: PaneAction) => {
    switch (action.type) {
      case 'switch-pane-type':
        if (action.paneType !== 'node') {
          upsertSingletonTab(slot, action.paneType);
        }
        break;
      case 'open-context':
        handleContextSelect(action.targetSlot ?? slot, action.contextId, action.contextName);
        break;
      case 'open-node':
        openNodeFromSlot(action.nodeId, action.targetSlot ?? slot);
        break;
      case 'close-pane':
        closeActiveSlot(slot);
        break;
    }
  }, [handleContextSelect, openNodeFromSlot, upsertSingletonTab]);

  const closeActiveSlot = useCallback((slot: SlotId) => {
    getSlotSetter(slot)(null);
    if (activePane === slot) {
      const fallback = visibleSlots.find((candidate) => candidate !== slot) ?? 'A';
      setActivePane(fallback);
    }
  }, [activePane, getSlotSetter, visibleSlots]);

  const handleSwapPanes = useCallback((source: SlotId, target: SlotId) => {
    if (source === target) return;

    const sourceState = getSlotState(source);
    const targetState = getSlotState(target);
    const sourceExpanded = isPanelExpanded(source);
    const targetExpanded = isPanelExpanded(target);
    const sourceWeight = getPanelWeight(source);
    const targetWeight = getPanelWeight(target);

    getSlotSetter(source)(targetState);
    getSlotSetter(target)(sourceState);
    setPanelExpanded(source, targetExpanded);
    setPanelExpanded(target, sourceExpanded);
    setPanelWeight(source, targetWeight);
    setPanelWeight(target, sourceWeight);

    if (activePane === source) setActivePane(target);
    else if (activePane === target) setActivePane(source);
  }, [activePane, getPanelWeight, getSlotSetter, getSlotState, isPanelExpanded, setPanelExpanded, setPanelWeight]);

  const handleSlotDragOver = useCallback((event: React.DragEvent, slot: SlotId) => {
    if (event.dataTransfer.types.includes('application/x-rah-pane') || event.dataTransfer.types.includes('application/x-rah-tab')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverSlot(slot);
    }
  }, []);

  const handleSlotDrop = useCallback((event: React.DragEvent, targetSlot: SlotId) => {
    event.preventDefault();
    setDragOverSlot(null);

    const paneData = event.dataTransfer.getData('application/x-rah-pane');
    if (paneData) {
      handleSwapPanes(paneData as SlotId, targetSlot);
      return;
    }

    const tabData = event.dataTransfer.getData('application/x-rah-tab');
    if (!tabData) return;

    try {
      const parsed = JSON.parse(tabData) as { sourceSlot: SlotId; tab: SlotTab };
      handleCrossSlotDrop(targetSlot, parsed.tab, parsed.sourceSlot);
    } catch (error) {
      console.error('Failed to parse dropped tab payload:', error);
    }
  }, [handleCrossSlotDrop, handleSwapPanes]);

  const handleResizePanels = useCallback((left: SlotId, right: SlotId, clientX: number) => {
    const leftEl = panelRefs.current[left];
    const rightEl = panelRefs.current[right];
    if (!leftEl || !rightEl) return;

    const leftRect = leftEl.getBoundingClientRect();
    const rightRect = rightEl.getBoundingClientRect();
    const combinedWidth = leftRect.width + rightRect.width;
    if (combinedWidth <= 0) return;

    const minWidth = 220;
    const rawLeftWidth = clientX - leftRect.left;
    const nextLeftWidth = Math.max(minWidth, Math.min(combinedWidth - minWidth, rawLeftWidth));
    const nextRightWidth = combinedWidth - nextLeftWidth;
    const totalWeight = getPanelWeight(left) + getPanelWeight(right);

    setPanelWeight(left, (nextLeftWidth / combinedWidth) * totalWeight);
    setPanelWeight(right, (nextRightWidth / combinedWidth) * totalWeight);
  }, [getPanelWeight, setPanelWeight]);

  const renderSlot = (slot: SlotId, state: SlotState) => {
    const activeTab = getActiveTab(state);
    if (!activeTab) return null;

    const tabBar = (
      <SlotTabBar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        slot={slot}
        onTabSelect={(tabId) => handleTabSelect(slot, tabId)}
        onTabClose={(tabId) => closeTabInSlot(slot, tabId)}
        onReorderTabs={(fromIndex, toIndex) => handleReorderTabs(slot, fromIndex, toIndex)}
        onCrossSlotDrop={(tab, fromSlot) => handleCrossSlotDrop(slot, tab, fromSlot)}
      />
    );

    const commonProps = {
      slot,
      isActive: activePane === slot,
      onPaneAction: (action: PaneAction) => handleSlotAction(slot, action),
      onCollapse: () => closeActiveSlot(slot),
      onSwapPanes: handleSwapPanes,
      tabBar,
    };

    switch (activeTab.type) {
      case 'node': {
        const nodeTabs = getSlotTabsByType(state, 'node').map((tab) => tab.nodeId!).filter((id): id is number => typeof id === 'number');
        return (
          <NodePane
            {...commonProps}
            openTabs={nodeTabs}
            activeTab={activeTab.nodeId ?? null}
            onTabSelect={(nodeId) => handleTabSelect(slot, createTabId('node', nodeId))}
            onTabClose={(nodeId) => closeTabInSlot(slot, createTabId('node', nodeId))}
            onNodeClick={(nodeId) => addNodeTabToSlot(slot, nodeId)}
            onReorderTabs={(fromIndex, toIndex) => handleReorderTabs(slot, fromIndex, toIndex)}
            refreshTrigger={focusPanelRefresh}
            onOpenInOtherSlot={(nodeId) => openNodeFromSlot(nodeId, slot)}
            onTextSelect={(nodeId, nodeTitle, text) => setHighlightedPassage({ nodeId, nodeTitle, selectedText: text })}
            highlightedPassage={highlightedPassage}
          />
        );
      }
      case 'contexts':
        return (
          <ContextsPane
            {...commonProps}
            onNodeOpen={(nodeId) => openNodeFromSlot(nodeId, slot)}
            onContextSelect={(contextId, contextName) => handleContextSelect(slot, contextId, contextName)}
          />
        );
      case 'map':
        return (
          <MapPane
            {...commonProps}
            onNodeClick={(nodeId) => openNodeFromSlot(nodeId, slot)}
            activeTabId={activeNodeId}
          />
        );
      case 'views':
        return (
          <ViewsPane
            {...commonProps}
            onNodeClick={(nodeId) => openNodeFromSlot(nodeId, slot)}
            onNodeOpenInOtherPane={(nodeId) => openNodeFromSlot(nodeId, slot)}
            refreshToken={nodesPanelRefresh}
            pendingNodes={pendingNodes}
            onDismissPending={(id) => setPendingNodes((prev) => prev.filter((item) => item.id !== id))}
            externalContextFilterId={browseContextFilters[slot]}
            onContextFilterSelect={(contextId) => {
              setBrowseContextFilters((prev) => ({ ...prev, [slot]: contextId }));
            }}
            onClearExternalContextFilter={() => {
              setBrowseContextFilters((prev) => ({ ...prev, [slot]: null }));
            }}
          />
        );
      case 'table':
        return (
          <TablePane
            {...commonProps}
            onNodeClick={(nodeId) => openNodeFromSlot(nodeId, slot)}
            refreshToken={nodesPanelRefresh}
          />
        );
      case 'skills':
        return <SkillsPane {...commonProps} />;
      default:
        return null;
    }
  };

  const openTabTypes = useMemo(() => {
    const types = new Set<PaneType>();
    (Object.values(slotStates) as Array<SlotState | null>).forEach((state) => {
      state?.tabs.forEach((tab) => types.add(tab.type));
    });
    return types;
  }, [slotStates]);

  const activeTabType = useMemo(() => {
    const state = getSlotState(activePane);
    return state ? getActiveTab(state)?.type ?? null : null;
  }, [activePane, getSlotState]);

  const getSlotContainerStyle = (slot: SlotId) => {
    const state = slotStates[slot];
    const weight = getPanelWeight(slot);

    return {
      flex: `${weight} ${weight} 0`,
      minWidth: 0,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      background: 'var(--rah-bg-surface)',
      borderRadius: '10px',
      border: state ? '1px solid transparent' : '1px dashed var(--rah-border)',
      outline: dragOverSlot === slot ? '2px dashed var(--rah-accent-green)' : 'none',
      outlineOffset: '-4px',
      transition: 'outline 0.15s ease, background 0.15s ease',
    };
  };

  const renderExpandedEmptyPanel = (slot: SlotId) => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rah-text-muted)', fontSize: '13px' }}>
        Select a pane from the nav
      </div>
    </div>
  );

  return (
    <div
      data-rah-app
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        background: 'var(--rah-bg-base)',
        overflow: 'hidden',
      }}
    >
      <LeftToolbar
        onSearchClick={() => setShowSearchModal(true)}
        onAddStuffClick={() => setShowAddStuff(true)}
        onRefreshClick={handleRefreshAll}
        visiblePaneCount={visiblePaneCount as 1 | 2 | 3}
        onVisiblePaneCountChange={setVisiblePaneCount as (count: 1 | 2 | 3) => void}
        onSettingsClick={() => {
          setSettingsInitialTab(undefined);
          setShowSettings(true);
        }}
        onPaneTypeClick={(paneType) => {
          if (paneType !== 'node') {
            openPaneSingleton(paneType, 'A');
          }
        }}
        isExpanded={leftNavExpanded}
        onToggleExpanded={() => setLeftNavExpanded((prev) => !prev)}
        openTabTypes={openTabTypes}
        activeTabType={activeTabType}
        theme={theme}
        onThemeToggle={toggleTheme}
        contexts={availableContexts}
        onContextQuickSelect={(contextId) => {
          const target = openPaneSingleton('views', 'A');
          setBrowseContextFilters((prev) => ({ ...prev, [target]: contextId }));
          setActiveContextId(contextId);
        }}
      />

      <div ref={containerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '8px', gap: '4px' }}>
        {visibleSlots.flatMap((slot, index) => {
          const state = slotStates[slot];
          const items: React.ReactNode[] = [];

          items.push(
            <div
              key={`panel-${slot}`}
              ref={(node) => {
                panelRefs.current[slot] = node;
              }}
              onClick={() => setActivePane(slot)}
              onDragOver={(event) => handleSlotDragOver(event, slot)}
              onDragLeave={() => setDragOverSlot(null)}
              onDrop={(event) => handleSlotDrop(event, slot)}
              style={getSlotContainerStyle(slot)}
            >
              {state ? renderSlot(slot, state) : renderExpandedEmptyPanel(slot)}
            </div>
          );

          const nextSlot = visibleSlots[index + 1];
          if (nextSlot) {
            items.push(
              <SplitHandle
                key={`split-${slot}-${nextSlot}`}
                onResize={(clientX) => handleResizePanels(slot, nextSlot, clientX)}
                title="Drag to resize panels"
              />
            );
          }

          return items;
        })}
      </div>

      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onNodeSelect={(nodeId) => {
          openNodeFromSlot(nodeId);
          setShowSearchModal(false);
        }}
        existingFilters={EMPTY_SEARCH_FILTERS}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={handleCloseSettings}
        initialTab={settingsInitialTab}
      />

      <QuickAddInput
        isOpen={showAddStuff}
        onClose={() => setShowAddStuff(false)}
        onSubmit={handleQuickAddSubmit}
      />
    </div>
  );
}
