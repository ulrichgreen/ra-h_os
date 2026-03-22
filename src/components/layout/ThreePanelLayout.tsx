"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { PanelLeftOpen, GripVertical, X } from 'lucide-react';
import SettingsModal, { SettingsTab } from '../settings/SettingsModal';
import SearchModal from '../nodes/SearchModal';
import { Node } from '@/types/database';
import { DatabaseEvent } from '@/services/events';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useTheme } from '@/hooks/useTheme';

import LeftToolbar from './LeftToolbar';
import SplitHandle from './SplitHandle';

import { NodePane, DimensionsPane, MapPane, ViewsPane, TablePane, SkillsPane } from '../panes';
import QuickAddInput from '../agents/QuickAddInput';
import type { PaneType, SlotState, PaneAction, SlotId } from '../panes/types';

export interface PendingNode {
  id: string;
  input: string;
  inputType: string;
  submittedAt: number;
  status: 'processing' | 'error';
  error?: string;
}

const SLOT_A_KEY = 'ui.slotA.v6';
const SLOT_B_KEY = 'ui.slotB.v6';
const SLOT_C_KEY = 'ui.slotC.v6';
const PANEL_A_EXPANDED_KEY = 'ui.panelA.expanded.v1';
const PANEL_B_EXPANDED_KEY = 'ui.panelB.expanded.v1';
const PANEL_C_EXPANDED_KEY = 'ui.panelC.expanded.v1';
const PANEL_A_WEIGHT_KEY = 'ui.panelA.weight.v1';
const PANEL_B_WEIGHT_KEY = 'ui.panelB.weight.v1';
const PANEL_C_WEIGHT_KEY = 'ui.panelC.weight.v1';
const LEFT_NAV_EXPANDED_KEY = 'ui.leftNavExpanded';
const ACTIVE_DIMENSION_KEY = 'ui.focus.activeDimension';

const DEFAULT_SLOT_A: SlotState = { type: 'views' };
const VALID_PANE_TYPES = new Set<PaneType>(['node', 'dimensions', 'map', 'views', 'table', 'skills']);

function normalizeSlotState(raw: SlotState | null): SlotState | null {
  if (!raw) return null;
  const rawType = raw.type as string;
  if (rawType === 'guides') {
    return { ...raw, type: 'skills' };
  }
  if (!VALID_PANE_TYPES.has(raw.type)) {
    return null;
  }
  return raw;
}

export default function ThreePanelLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<SlotId, HTMLDivElement | null>>({ A: null, B: null, C: null });
  const [theme, toggleTheme] = useTheme();

  const [slotA, setSlotA] = usePersistentState<SlotState | null>(SLOT_A_KEY, DEFAULT_SLOT_A);
  const [slotB, setSlotB] = usePersistentState<SlotState | null>(SLOT_B_KEY, null);
  const [slotC, setSlotC] = usePersistentState<SlotState | null>(SLOT_C_KEY, null);

  const [panelAExpanded, setPanelAExpanded] = usePersistentState<boolean>(PANEL_A_EXPANDED_KEY, true);
  const [panelBExpanded, setPanelBExpanded] = usePersistentState<boolean>(PANEL_B_EXPANDED_KEY, false);
  const [panelCExpanded, setPanelCExpanded] = usePersistentState<boolean>(PANEL_C_EXPANDED_KEY, false);
  const [panelAWeight, setPanelAWeight] = usePersistentState<number>(PANEL_A_WEIGHT_KEY, 1);
  const [panelBWeight, setPanelBWeight] = usePersistentState<number>(PANEL_B_WEIGHT_KEY, 1);
  const [panelCWeight, setPanelCWeight] = usePersistentState<number>(PANEL_C_WEIGHT_KEY, 1);
  const [leftNavExpanded, setLeftNavExpanded] = usePersistentState<boolean>(LEFT_NAV_EXPANDED_KEY, false);

  const [activePane, setActivePane] = useState<SlotId>('A');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>();
  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsInitialTab(undefined);
  }, []);

  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showAddStuff, setShowAddStuff] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set<number>());
  const [openTabsData, setOpenTabsData] = useState<Node[]>([]);
  const [nodesPanelRefresh, setNodesPanelRefresh] = useState(0);
  const [focusPanelRefresh, setFocusPanelRefresh] = useState(0);
  const [folderViewRefresh, setFolderViewRefresh] = useState(0);
  const [activeDimension, setActiveDimension] = usePersistentState<string | null>(ACTIVE_DIMENSION_KEY, null);
  const [browseDimensionFilters, setBrowseDimensionFilters] = useState<Record<SlotId, string | null>>({
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
  const openTabsRef = useRef<number[]>([]);

  useEffect(() => {
    setSlotA((prev) => normalizeSlotState(prev) ?? DEFAULT_SLOT_A);
    setSlotB((prev) => normalizeSlotState(prev));
    setSlotC((prev) => normalizeSlotState(prev));
  }, [setSlotA, setSlotB, setSlotC]);

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

  const isPanelExpanded = useCallback((slot: SlotId) => {
    switch (slot) {
      case 'A':
        return panelAExpanded;
      case 'B':
        return panelBExpanded;
      case 'C':
        return panelCExpanded;
    }
  }, [panelAExpanded, panelBExpanded, panelCExpanded]);

  const setPanelExpanded = useCallback((slot: SlotId, expanded: boolean) => {
    switch (slot) {
      case 'A':
        setPanelAExpanded(expanded);
        break;
      case 'B':
        setPanelBExpanded(expanded);
        break;
      case 'C':
        setPanelCExpanded(expanded);
        break;
    }
  }, [setPanelAExpanded, setPanelBExpanded, setPanelCExpanded]);

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

  const isSlotEmpty = useCallback((slot: SlotId) => {
    return !getSlotState(slot);
  }, [getSlotState]);

  const { openTabs, activeTab } = useMemo(() => {
    const collectTabs = (state: SlotState | null): number[] =>
      state?.type === 'node' ? (state.nodeTabs ?? []) : [];

    const slotStates: Record<SlotId, SlotState | null> = { A: slotA, B: slotB, C: slotC };
    const activeSlotState = slotStates[activePane];
    const activeNodes = collectTabs(activeSlotState);
    const otherNodes = (['A', 'B', 'C'] as SlotId[])
      .filter((slot) => slot !== activePane)
      .flatMap((slot) => collectTabs(slotStates[slot]));
    const allNodes = [...new Set([...activeNodes, ...otherNodes])];

    let active: number | null = null;
    if (activeSlotState?.type === 'node' && activeSlotState.activeNodeTab != null) {
      active = activeSlotState.activeNodeTab;
    }
    if (active == null) {
      for (const slot of ['A', 'B', 'C'] as SlotId[]) {
        const state = slotStates[slot];
        if (slot !== activePane && state?.type === 'node' && state.activeNodeTab != null) {
          active = state.activeNodeTab;
          break;
        }
      }
    }
    if (active == null && allNodes.length > 0) {
      active = allNodes[0];
    }

    return { openTabs: allNodes, activeTab: active };
  }, [slotA, slotB, slotC, activePane]);

  const fetchOpenTabsData = async (tabIds: number[]) => {
    if (tabIds.length === 0) {
      setOpenTabsData([]);
      return;
    }

    try {
      const nodePromises = tabIds.map(async (id) => {
        const response = await fetch(`/api/nodes/${id}`);
        if (response.ok) {
          const data = await response.json();
          return data.node as Node;
        }
        return null;
      });

      const nodes = await Promise.all(nodePromises);
      const validNodes = nodes.filter((node): node is Node => Boolean(node)).map(node => ({
        id: node.id,
        title: node.title,
        link: node.link,
        source: node.source,
        dimensions: node.dimensions,
        created_at: node.created_at,
        updated_at: node.updated_at,
        chunk_status: node.chunk_status,
        metadata: node.metadata,
      }));
      setOpenTabsData(validNodes);
    } catch (error) {
      console.error('Failed to fetch tab data:', error);
      setOpenTabsData([]);
    }
  };

  const openTabsKey = openTabs.join(',');
  useEffect(() => {
    openTabsRef.current = openTabs;
    fetchOpenTabsData(openTabs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabsKey, focusPanelRefresh]);

  const handleRefreshAll = useCallback(() => {
    setNodesPanelRefresh(prev => prev + 1);
    setFolderViewRefresh(prev => prev + 1);
    setFocusPanelRefresh(prev => prev + 1);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearchModal(true);
      }

      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        const collapsed = (['A', 'B', 'C'] as SlotId[]).find((slot) => !isPanelExpanded(slot));
        if (collapsed) {
          setPanelExpanded(collapsed, true);
          setActivePane(collapsed);
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'r') {
        e.preventDefault();
        handleRefreshAll();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        if (document.activeElement?.closest('[data-rah-app]')) {
          e.preventDefault();
          setShowAddStuff(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRefreshAll, isPanelExpanded, setPanelExpanded]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const data: DatabaseEvent = JSON.parse(event.data);

          switch (data.type) {
            case 'NODE_CREATED':
              setNodesPanelRefresh(prev => prev + 1);
              break;
            case 'NODE_UPDATED': {
              const currentOpenTabs = openTabsRef.current;
              const updatedNodeId = Number(data.data.nodeId);
              if (currentOpenTabs.includes(updatedNodeId)) {
                setFocusPanelRefresh(prev => prev + 1);
              }
              setNodesPanelRefresh(prev => prev + 1);
              break;
            }
            case 'NODE_DELETED':
              handleNodeDeleted(data.data.nodeId);
              setNodesPanelRefresh(prev => prev + 1);
              break;
            case 'EDGE_CREATED':
            case 'EDGE_DELETED': {
              const currentOpenTabsForEdge = openTabsRef.current;
              if (currentOpenTabsForEdge.includes(data.data.fromNodeId) ||
                  currentOpenTabsForEdge.includes(data.data.toNodeId)) {
                setFocusPanelRefresh(prev => prev + 1);
              }
              break;
            }
            case 'DIMENSION_UPDATED':
              setNodesPanelRefresh(prev => prev + 1);
              setFolderViewRefresh(prev => prev + 1);
              break;
            case 'HELPER_UPDATED':
            case 'AGENT_UPDATED':
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('agents:updated', { detail: data.data }));
              }
              break;
            case 'GUIDE_UPDATED':
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('guides:updated', { detail: data.data }));
                window.dispatchEvent(new CustomEvent('skills:updated', { detail: data.data }));
              }
              break;
            case 'QUICK_ADD_COMPLETED':
              if (data.data?.quickAddId) {
                setPendingNodes(prev => prev.filter(p => p.id !== data.data.quickAddId));
              }
              break;
            case 'QUICK_ADD_FAILED':
              if (data.data?.quickAddId) {
                setPendingNodes(prev => prev.map(p =>
                  p.id === data.data.quickAddId
                    ? { ...p, status: 'error' as const, error: data.data.error || 'Unknown error' }
                    : p
                ));
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
    const interval = setInterval(() => {
      const now = Date.now();
      setPendingNodes(prev => prev.filter(p => {
        const age = now - p.submittedAt;
        if (p.status === 'processing' && age > 90_000) return false;
        if (p.status === 'error' && age > 120_000) return false;
        return true;
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingNodes.length]);

  const setSingletonPaneInSlot = useCallback((slot: SlotId, paneType: Exclude<PaneType, 'node'>) => {
    setPanelExpanded(slot, true);
    getSlotSetter(slot)({ type: paneType });
  }, [getSlotSetter, setPanelExpanded]);

  const focusPaneIfOpen = useCallback((paneType: Exclude<PaneType, 'node'>): SlotId | null => {
    for (const slot of ['A', 'B', 'C'] as SlotId[]) {
      if (getSlotState(slot)?.type === paneType) {
        setActivePane(slot);
        return slot;
      }
    }
    return null;
  }, [getSlotState]);

  const openPaneSingleton = useCallback((paneType: Exclude<PaneType, 'node'>, preferredSlot?: SlotId) => {
    const existing = focusPaneIfOpen(paneType);
    if (existing) return existing;

    const orderedSlots = preferredSlot
      ? [preferredSlot, ...(['A', 'B', 'C'] as SlotId[]).filter((slot) => slot !== preferredSlot)]
      : (['A', 'B', 'C'] as SlotId[]);

    const expandedEmpty = orderedSlots.find((slot) => isPanelExpanded(slot) && isSlotEmpty(slot));
    if (expandedEmpty) {
      setSingletonPaneInSlot(expandedEmpty, paneType);
      setActivePane(expandedEmpty);
      return expandedEmpty;
    }

    const collapsedFree = orderedSlots.find((slot) => !isPanelExpanded(slot));
    if (collapsedFree) {
      setPanelExpanded(collapsedFree, true);
      setSingletonPaneInSlot(collapsedFree, paneType);
      setActivePane(collapsedFree);
      return collapsedFree;
    }

    const activeHasContext = isPanelExpanded(activePane) && !isSlotEmpty(activePane);
    const replacementTarget = activeHasContext
      ? activePane
      : orderedSlots.find((slot) => isPanelExpanded(slot) && !isSlotEmpty(slot))
        ?? orderedSlots.find((slot) => isPanelExpanded(slot))
        ?? orderedSlots[0];

    setSingletonPaneInSlot(replacementTarget, paneType);
    setActivePane(replacementTarget);
    return replacementTarget;
  }, [activePane, focusPaneIfOpen, isPanelExpanded, isSlotEmpty, setPanelExpanded, setSingletonPaneInSlot]);

  const addNodeTabToSlot = useCallback((slot: SlotId, nodeId: number) => {
    setPanelExpanded(slot, true);
    const state = getSlotState(slot);
    if (state?.type === 'node') {
      const currentTabs = state.nodeTabs || [];
      const newTabs = currentTabs.includes(nodeId) ? currentTabs : [...currentTabs, nodeId];
      getSlotSetter(slot)({
        ...state,
        nodeTabs: newTabs,
        activeNodeTab: nodeId,
      });
      return;
    }

    getSlotSetter(slot)({
      type: 'node',
      nodeTabs: [nodeId],
      activeNodeTab: nodeId,
    });
  }, [getSlotSetter, getSlotState, setPanelExpanded]);

  const openNodeFromSlot = useCallback((nodeId: number, fromSlot?: SlotId) => {
    const targetOrder: SlotId[] = fromSlot === 'A'
      ? ['B', 'C']
      : fromSlot === 'B'
        ? ['C', 'A']
        : fromSlot === 'C'
          ? ['B', 'A']
          : ['B', 'C', 'A'];

    for (const slot of ['A', 'B', 'C'] as SlotId[]) {
      const state = getSlotState(slot);
      if (state?.type === 'node' && (state.nodeTabs || []).includes(nodeId)) {
        getSlotSetter(slot)({ ...state, activeNodeTab: nodeId });
        setSelectedNodes(new Set([nodeId]));
        setActivePane(slot);
        return;
      }
    }

    const emptyTarget = targetOrder.find((slot) => slot !== fromSlot && isSlotEmpty(slot));
    const fallbackTarget = targetOrder.find((slot) => slot !== fromSlot) ?? 'B';
    const target = emptyTarget ?? fallbackTarget;

    addNodeTabToSlot(target, nodeId);
    setSelectedNodes(new Set([nodeId]));
    setActivePane(target);
  }, [addNodeTabToSlot, getSlotSetter, getSlotState, isSlotEmpty]);

  const handleNodeSelect = useCallback((nodeId: number, _multiSelect: boolean) => {
    openNodeFromSlot(nodeId);
  }, [openNodeFromSlot]);

  const handleTabSelect = useCallback((slot: SlotId, tabId: number) => {
    const state = getSlotState(slot);
    if (state?.type !== 'node') return;
    getSlotSetter(slot)({ ...state, activeNodeTab: tabId });
    setSelectedNodes(new Set([tabId]));
    setActivePane(slot);
  }, [getSlotSetter, getSlotState]);

  const handleCloseTab = useCallback((slot: SlotId, tabId: number) => {
    const state = getSlotState(slot);
    if (state?.type !== 'node') return;

    const currentTabs = state.nodeTabs || [];
    const newTabs = currentTabs.filter(id => id !== tabId);
    const newActiveTab = state.activeNodeTab === tabId
      ? (newTabs.length > 0 ? newTabs[Math.min(currentTabs.indexOf(tabId), newTabs.length - 1)] : null)
      : state.activeNodeTab ?? null;

    if (newTabs.length === 0) {
      getSlotSetter(slot)(null);
      return;
    }

    getSlotSetter(slot)({
      ...state,
      nodeTabs: newTabs,
      activeNodeTab: newActiveTab,
    });
  }, [getSlotSetter, getSlotState]);

  const handleNodeDeleted = useCallback((nodeId: number) => {
    for (const slot of ['A', 'B', 'C'] as SlotId[]) {
      handleCloseTab(slot, nodeId);
    }
  }, [handleCloseTab]);

  const handleReorderTabs = useCallback((slot: SlotId, fromIndex: number, toIndex: number) => {
    const state = getSlotState(slot);
    if (state?.type !== 'node') return;
    const currentTabs = state.nodeTabs || [];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= currentTabs.length || toIndex >= currentTabs.length) {
      return;
    }
    const updated = [...currentTabs];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    getSlotSetter(slot)({ ...state, nodeTabs: updated });
  }, [getSlotSetter, getSlotState]);

  const handleFolderViewDataChanged = useCallback(() => {
    setFolderViewRefresh(prev => prev + 1);
    setNodesPanelRefresh(prev => prev + 1);
  }, []);

  const handleNodeOpenFromDimensions = useCallback((nodeId: number) => {
    openNodeFromSlot(nodeId, 'A');
  }, [openNodeFromSlot]);

  const handleDimensionPaneSelect = useCallback((slot: SlotId, dimensionName: string | null) => {
    setBrowseDimensionFilters((prev) => ({ ...prev, [slot]: dimensionName }));
    setActiveDimension(dimensionName);

    if (!dimensionName) return;

    setPanelExpanded(slot, true);
    getSlotSetter(slot)({ type: 'views' });
    setActivePane(slot);
  }, [getSlotSetter, setActiveDimension, setPanelExpanded]);

  const handleQuickAddSubmit = useCallback(async ({ input, mode, description }: { input: string; mode: 'link' | 'text'; description?: string }) => {
    try {
      const response = await fetch('/api/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode, description }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit Quick Add');
      }

      const data = await response.json();
      const result = data.result as { id: string; inputType: string } | undefined;

      if (result?.id) {
        setPendingNodes(prev => [{
          id: result.id,
          input: input.trim(),
          inputType: result.inputType || 'note',
          submittedAt: Date.now(),
          status: 'processing',
        }, ...prev]);
      }

      openPaneSingleton('views', 'A');
      setShowAddStuff(false);
    } catch (error) {
      console.error('[ThreePanelLayout] Quick Add error:', error);
    }
  }, [openPaneSingleton]);

  const handleCloseSlotA = useCallback(() => {
    setSlotA(null);
    setPanelAExpanded(false);
    setActivePane(panelBExpanded ? 'B' : panelCExpanded ? 'C' : 'A');
  }, [panelBExpanded, panelCExpanded, setPanelAExpanded, setSlotA]);

  const handleCloseSlotB = useCallback(() => {
    setSlotB(null);
    setPanelBExpanded(false);
    setActivePane(panelAExpanded ? 'A' : panelCExpanded ? 'C' : 'B');
  }, [panelAExpanded, panelCExpanded, setPanelBExpanded, setSlotB]);

  const handleCloseSlotC = useCallback(() => {
    setSlotC(null);
    setPanelCExpanded(false);
    setActivePane(panelBExpanded ? 'B' : panelAExpanded ? 'A' : 'C');
  }, [panelAExpanded, panelBExpanded, setPanelCExpanded, setSlotC]);

  const handleSlotAction = useCallback((slot: SlotId, action: PaneAction) => {
    switch (action.type) {
      case 'switch-pane-type':
        if (action.paneType !== 'node') {
          setSingletonPaneInSlot(slot, action.paneType);
          setActivePane(slot);
        }
        break;
      case 'open-node':
        openNodeFromSlot(action.nodeId, slot);
        break;
    }
  }, [openNodeFromSlot, setSingletonPaneInSlot]);

  const handleSearchNodeSelect = useCallback((nodeId: number) => {
    handleNodeSelect(nodeId, false);
    setShowSearchModal(false);
  }, [handleNodeSelect]);

  const handleSwapPanes = useCallback((source: SlotId, target: SlotId) => {
    if (source === target) return;

    const sourceState = getSlotState(source);
    const targetState = getSlotState(target);
    const sourceExpanded = isPanelExpanded(source);
    const targetExpanded = isPanelExpanded(target);

    getSlotSetter(source)(targetState);
    getSlotSetter(target)(sourceState);
    setPanelExpanded(source, targetExpanded);
    setPanelExpanded(target, sourceExpanded);

    const sourceWeight = getPanelWeight(source);
    const targetWeight = getPanelWeight(target);
    setPanelWeight(source, targetWeight);
    setPanelWeight(target, sourceWeight);

    if (activePane === source) setActivePane(target);
    else if (activePane === target) setActivePane(source);
  }, [activePane, getPanelWeight, getSlotSetter, getSlotState, isPanelExpanded, setPanelExpanded, setPanelWeight]);

  const [dragOverSlot, setDragOverSlot] = useState<SlotId | null>(null);

  const handleSlotDragOver = useCallback((e: React.DragEvent, slot: SlotId) => {
    if (e.dataTransfer.types.includes('application/x-rah-pane') ||
        e.dataTransfer.types.includes('application/x-rah-tab') ||
        e.dataTransfer.types.includes('application/node-info')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-rah-pane') ? 'move' : 'copy';
      setDragOverSlot(slot);
    }
  }, []);

  const handleSlotDragLeave = useCallback(() => {
    setDragOverSlot(null);
  }, []);

  const handleSlotDrop = useCallback((e: React.DragEvent, targetSlot: SlotId) => {
    setDragOverSlot(null);

    const paneData = e.dataTransfer.getData('application/x-rah-pane');
    if (paneData) {
      const sourceSlot = paneData as SlotId;
      if (sourceSlot !== targetSlot) handleSwapPanes(sourceSlot, targetSlot);
      return;
    }

    let tabData = e.dataTransfer.getData('application/x-rah-tab');
    if (!tabData) {
      tabData = e.dataTransfer.getData('application/node-info');
    }
    if (!tabData) return;

    try {
      const parsed = JSON.parse(tabData);
      const nodeId = parsed.id as number | undefined;
      const sourceSlot = parsed.sourceSlot as SlotId | undefined;
      if (typeof nodeId !== 'number') return;

      if (sourceSlot && sourceSlot === targetSlot) {
        handleTabSelect(targetSlot, nodeId);
        return;
      }

      if (sourceSlot) {
        handleCloseTab(sourceSlot, nodeId);
      }

      addNodeTabToSlot(targetSlot, nodeId);
      setActivePane(targetSlot);
    } catch (err) {
      console.error('Failed to parse dropped tab data:', err);
    }
  }, [addNodeTabToSlot, handleCloseTab, handleSwapPanes, handleTabSelect]);

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
    const isActive = activePane === slot;
    const onCollapse = slot === 'A' ? handleCloseSlotA : slot === 'B' ? handleCloseSlotB : handleCloseSlotC;

    switch (state.type) {
      case 'node':
        return (
          <NodePane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
            openTabs={state.nodeTabs || []}
            activeTab={state.activeNodeTab || null}
            onTabSelect={(tabId) => handleTabSelect(slot, tabId)}
            onTabClose={(tabId) => handleCloseTab(slot, tabId)}
            onNodeClick={(nodeId) => {
              addNodeTabToSlot(slot, nodeId);
              setSelectedNodes(new Set([nodeId]));
              setActivePane(slot);
            }}
            onReorderTabs={(fromIndex, toIndex) => handleReorderTabs(slot, fromIndex, toIndex)}
            refreshTrigger={focusPanelRefresh}
            onOpenInOtherSlot={(nodeId) => openNodeFromSlot(nodeId, slot)}
            onTextSelect={(nodeId, nodeTitle, text) => {
              setHighlightedPassage({ nodeId, nodeTitle, selectedText: text });
            }}
            highlightedPassage={highlightedPassage}
          />
        );

      case 'dimensions':
        return (
          <DimensionsPane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
            onNodeOpen={handleNodeOpenFromDimensions}
            refreshToken={folderViewRefresh}
            onDataChanged={handleFolderViewDataChanged}
            onDimensionSelect={(dimension) => handleDimensionPaneSelect(slot, dimension)}
          />
        );

      case 'map':
        return (
          <MapPane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
            onNodeClick={(nodeId) => openNodeFromSlot(nodeId, slot)}
            activeTabId={activeTab}
          />
        );

      case 'views':
        return (
          <ViewsPane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
            onNodeClick={(nodeId) => {
              openNodeFromSlot(nodeId, slot);
              setActivePane(slot);
            }}
            onNodeOpenInOtherPane={(nodeId) => openNodeFromSlot(nodeId, slot)}
            refreshToken={nodesPanelRefresh}
            pendingNodes={pendingNodes}
            onDismissPending={(id) => setPendingNodes(prev => prev.filter(p => p.id !== id))}
            externalDimensionFilter={browseDimensionFilters[slot]}
            onClearExternalDimensionFilter={() => {
              setBrowseDimensionFilters((prev) => ({ ...prev, [slot]: null }));
              setActiveDimension(null);
            }}
          />
        );

      case 'table':
        return (
          <TablePane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
            onNodeClick={(nodeId) => {
              openNodeFromSlot(nodeId, slot);
              setActivePane(slot);
            }}
            refreshToken={nodesPanelRefresh}
          />
        );

      case 'skills':
        return (
          <SkillsPane
            slot={slot}
            isActive={isActive}
            onPaneAction={(action) => handleSlotAction(slot, action)}
            onCollapse={onCollapse}
            onSwapPanes={handleSwapPanes}
          />
        );

      default:
        return null;
    }
  };

  const slotStates: Record<SlotId, SlotState | null> = { A: slotA, B: slotB, C: slotC };
  const panelExpandedState: Record<SlotId, boolean> = { A: panelAExpanded, B: panelBExpanded, C: panelCExpanded };

  const getSlotContainerStyle = (slot: SlotId) => {
    const state = slotStates[slot];
    const expanded = panelExpandedState[slot];
    const hasContent = Boolean(state);
    const weight = getPanelWeight(slot);

    return {
      flex: expanded ? `${weight} ${weight} 0` : '0 0 44px',
      minWidth: expanded ? 0 : '44px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column' as const,
      background: expanded ? 'var(--rah-bg-surface)' : 'var(--rah-bg-subtle)',
      borderRadius: '10px',
      border: expanded && hasContent ? '1px solid transparent' : '1px dashed var(--rah-border)',
      outline: dragOverSlot === slot ? '2px dashed var(--rah-accent-green)' : 'none',
      outlineOffset: '-4px',
      transition: 'outline 0.15s ease, background 0.15s ease',
    };
  };

  const renderCollapsedPanel = (slot: SlotId) => (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 0',
      }}
    >
      <button
        type="button"
        onClick={() => {
          setPanelExpanded(slot, true);
          setActivePane(slot);
        }}
        title="Expand panel"
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          border: '1px solid var(--rah-border-strong)',
          background: 'var(--rah-bg-elevated)',
          color: 'var(--rah-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <PanelLeftOpen size={14} />
      </button>
    </div>
  );

  const renderExpandedEmptyPanel = (slot: SlotId) => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-rah-pane', slot);
          e.dataTransfer.effectAllowed = 'move';
        }}
        style={{
          minHeight: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'grab',
        }}
      >
        <GripVertical size={14} color="var(--rah-text-muted)" />
        <button
          type="button"
          onClick={() => {
            getSlotSetter(slot)(null);
            setPanelExpanded(slot, false);
          }}
          title="Collapse panel"
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            border: '1px solid var(--rah-border-strong)',
            background: 'var(--rah-bg-elevated)',
            color: 'var(--rah-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={14} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--rah-text-muted)',
          fontSize: '13px',
        }}
      >
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
        onSettingsClick={() => {
          setSettingsInitialTab(undefined);
          setShowSettings(true);
        }}
        onPaneTypeClick={openPaneSingleton}
        isExpanded={leftNavExpanded}
        onToggleExpanded={() => setLeftNavExpanded(prev => !prev)}
        openTabTypes={new Set([slotA?.type, slotB?.type, slotC?.type].filter((t): t is PaneType => t != null))}
        activeTabType={getSlotState(activePane)?.type ?? null}
        onRefreshClick={handleRefreshAll}
        theme={theme}
        onThemeToggle={toggleTheme}
      />

      <div
        ref={containerRef}
        style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '8px', gap: '4px' }}
      >
        {(['A', 'B', 'C'] as SlotId[]).flatMap((slot, index, allSlots) => {
          const state = slotStates[slot];
          const expanded = panelExpandedState[slot];
          const items: React.ReactNode[] = [];

          items.push(
            <div
              key={`panel-${slot}`}
              ref={(node) => {
                panelRefs.current[slot] = node;
              }}
              onClick={() => setActivePane(slot)}
              onDragOver={(e) => handleSlotDragOver(e, slot)}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, slot)}
              style={getSlotContainerStyle(slot)}
            >
              {!expanded ? renderCollapsedPanel(slot) : state ? renderSlot(slot, state) : renderExpandedEmptyPanel(slot)}
            </div>
          );

          const nextSlot = allSlots[index + 1];
          if (nextSlot && expanded && panelExpandedState[nextSlot]) {
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
        onNodeSelect={handleSearchNodeSelect}
        existingFilters={[]}
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
