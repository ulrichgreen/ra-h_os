"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeMouseHandler,
  type Node as RFNode,
  type Edge as RFEdge,
  ReactFlowProvider,
  useReactFlow,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Edge as DbEdge, Node as DbNode } from '@/types/database';
import PaneHeader from './PaneHeader';
import type { MapPaneProps } from './types';
import { RahNode } from './map/RahNode';
import { RahEdge } from './map/RahEdge';
import EdgeExplanationModal from './map/EdgeExplanationModal';
import { toRFNodes, toRFEdges, NODE_LIMIT, type MapViewMode, type RahNodeData } from './map/utils';
import { useTheme } from '@/hooks/useTheme';
import './map/map-styles.css';

const nodeTypes = { rahNode: RahNode };
const edgeTypes = { rahEdge: RahEdge };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function MapPaneInner({
  slot,
  onCollapse,
  onSwapPanes,
  tabBar,
  onNodeClick,
  activeTabId,
}: MapPaneProps) {
  const reactFlowInstance = useReactFlow();
  const [theme] = useTheme();

  const [baseNodes, setBaseNodes] = useState<DbNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<DbNode[]>([]);
  const [dbEdges, setDbEdges] = useState<DbEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<MapViewMode>('context');

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode<RahNodeData>>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);

  const rfPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hasInitialFitRef = useRef(false);

  const allDbNodes = useMemo(() => {
    const baseIds = new Set(baseNodes.map((node) => node.id));
    return [...baseNodes, ...expandedNodes.filter((node) => !baseIds.has(node.id))];
  }, [baseNodes, expandedNodes]);

  const selectedDbNode = useMemo(
    () => allDbNodes.find((node) => node.id === selectedNodeId) ?? null,
    [allDbNodes, selectedNodeId],
  );

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<number>();
    const connected = new Set<number>();
    dbEdges.forEach((edge) => {
      if (edge.from_node_id === selectedNodeId) connected.add(edge.to_node_id);
      if (edge.to_node_id === selectedNodeId) connected.add(edge.from_node_id);
    });
    return connected;
  }, [selectedNodeId, dbEdges]);

  const clusterLabels = useMemo(() => {
    if (viewMode !== 'context') return [];

    const grouped = new Map<string, { x: number; y: number; count: number }>();
    for (const node of rfNodes) {
      const clusterLabel = (node.data as RahNodeData).clusterLabel;
      const current = grouped.get(clusterLabel) || { x: 0, y: 0, count: 0 };
      current.x += node.position.x;
      current.y += node.position.y;
      current.count += 1;
      grouped.set(clusterLabel, current);
    }

    return [...grouped.entries()].map(([clusterLabel, totals]) => ({
      clusterLabel,
      x: totals.x / totals.count,
      y: totals.y / totals.count - 84,
    }));
  }, [rfNodes, viewMode]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [nodesRes, edgesRes] = await Promise.all([
          fetch(`/api/nodes?limit=${NODE_LIMIT}&sortBy=edges`),
          fetch('/api/edges'),
        ]);

        if (!nodesRes.ok || !edgesRes.ok) throw new Error('Failed to load map data');

        const nodesPayload = await nodesRes.json();
        const edgesPayload = await edgesRes.json();

        setBaseNodes(nodesPayload.data || []);
        setDbEdges(edgesPayload.data || []);
        setExpandedNodes([]);
        setSelectedNodeId(null);
        rfPositionsRef.current.clear();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, []);

  useEffect(() => {
    if (allDbNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    rfNodes.forEach((node) => {
      rfPositionsRef.current.set(node.id, node.position);
    });

    const centerX = 600;
    const centerY = 400;

    const newRfNodes = toRFNodes(
      baseNodes,
      expandedNodes,
      centerX,
      centerY,
      selectedNodeId,
      connectedNodeIds,
      rfPositionsRef.current,
      viewMode,
      dbEdges,
    );

    const nodeIdSet = new Set(newRfNodes.map((node) => node.id));
    const newRfEdges = toRFEdges(dbEdges, nodeIdSet, selectedNodeId);

    setRfNodes(newRfNodes);
    setRfEdges(newRfEdges);
  }, [allDbNodes, baseNodes, expandedNodes, dbEdges, selectedNodeId, connectedNodeIds, viewMode, rfNodes, setRfEdges, setRfNodes]);

  useEffect(() => {
    if (hasInitialFitRef.current || rfNodes.length === 0 || loading) return;
    hasInitialFitRef.current = true;

    const hubNodeIds = [...baseNodes]
      .sort((a, b) => (b.edge_count ?? 0) - (a.edge_count ?? 0))
      .slice(0, 25)
      .map((node) => String(node.id));

    setTimeout(() => {
      if (hubNodeIds.length > 0) {
        reactFlowInstance.fitView({
          nodes: hubNodeIds.map((id) => ({ id })),
          padding: 0.3,
          duration: 300,
        });
      }
    }, 100);
  }, [rfNodes, loading, baseNodes, reactFlowInstance]);

  useEffect(() => {
    hasInitialFitRef.current = false;
  }, [viewMode]);

  const fitAllNodes = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
  }, [reactFlowInstance]);

  const fitHubNodes = useCallback(() => {
    const hubNodeIds = [...baseNodes]
      .sort((a, b) => (b.edge_count ?? 0) - (a.edge_count ?? 0))
      .slice(0, 25)
      .map((node) => String(node.id));
    if (hubNodeIds.length > 0) {
      reactFlowInstance.fitView({
        nodes: hubNodeIds.map((id) => ({ id })),
        padding: 0.3,
        duration: 300,
      });
    }
  }, [baseNodes, reactFlowInstance]);

  const fetchConnectedNodes = useCallback(async (nodeId: number) => {
    try {
      const edgesRes = await fetch(`/api/nodes/${nodeId}/edges`);
      let nodeEdges: DbEdge[] = [];

      if (edgesRes.ok) {
        const edgesData = await edgesRes.json();
        nodeEdges = edgesData.data || [];

        if (nodeEdges.length > 0) {
          setDbEdges((prev) => {
            const existing = new Set(prev.map((edge) => edge.id));
            const fresh = nodeEdges.filter((edge) => !existing.has(edge.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
        }
      }

      const connectedIds = new Set<number>();
      dbEdges.forEach((edge) => {
        if (edge.from_node_id === nodeId) connectedIds.add(edge.to_node_id);
        if (edge.to_node_id === nodeId) connectedIds.add(edge.from_node_id);
      });
      nodeEdges.forEach((edge) => {
        if (edge.from_node_id === nodeId) connectedIds.add(edge.to_node_id);
        if (edge.to_node_id === nodeId) connectedIds.add(edge.from_node_id);
      });

      const existingIds = new Set(allDbNodes.map((node) => node.id));
      const missingIds = Array.from(connectedIds).filter((id) => !existingIds.has(id));
      if (missingIds.length === 0) return;

      const fetched = (
        await Promise.all(
          missingIds.slice(0, 50).map(async (id) => {
            try {
              const res = await fetch(`/api/nodes/${id}`);
              if (res.ok) {
                const data = await res.json();
                return data.node as DbNode;
              }
            } catch {
              return null;
            }
            return null;
          }),
        )
      ).filter((node): node is DbNode => node !== null);

      if (fetched.length > 0) {
        setExpandedNodes((prev) => {
          const ids = new Set(prev.map((node) => node.id));
          const fresh = fetched.filter((node) => !ids.has(node.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    } catch (err) {
      console.error('Failed to fetch connected nodes:', err);
    }
  }, [dbEdges, allDbNodes]);

  useEffect(() => {
    if (selectedNodeId) {
      void fetchConnectedNodes(selectedNodeId);
    }
  }, [selectedNodeId, fetchConnectedNodes]);

  useEffect(() => {
    if (!activeTabId) return;
    const existing = allDbNodes.find((node) => node.id === activeTabId);
    if (existing) {
      setSelectedNodeId(activeTabId);
      const rfNode = rfNodes.find((node) => node.id === String(activeTabId));
      if (rfNode) {
        reactFlowInstance.setCenter(rfNode.position.x, rfNode.position.y, { duration: 400, zoom: 1.5 });
      }
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`/api/nodes/${activeTabId}`);
        if (!res.ok) return;
        const data = await res.json();
        const node = data.node as DbNode;
        if (!node) return;
        setExpandedNodes((prev) => (prev.some((existingNode) => existingNode.id === node.id) ? prev : [...prev, node]));
        setSelectedNodeId(node.id);
        setTimeout(() => {
          reactFlowInstance.setCenter(600, 400, { duration: 400, zoom: 1.5 });
        }, 100);
      } catch (err) {
        console.error('Failed to fetch focused node:', err);
      }
    })();
  }, [activeTabId, allDbNodes, rfNodes, reactFlowInstance]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          switch (payload.type) {
            case 'NODE_UPDATED': {
              const node = payload.data?.node as DbNode | undefined;
              if (node?.id) {
                const updater = (prev: DbNode[]) =>
                  prev.map((existingNode) => (existingNode.id === node.id ? { ...existingNode, ...node } : existingNode));
                setBaseNodes(updater);
                setExpandedNodes(updater);
              }
              break;
            }
            case 'NODE_DELETED': {
              const deletedId = payload.data?.nodeId;
              if (deletedId) {
                setBaseNodes((prev) => prev.filter((node) => node.id !== deletedId));
                setExpandedNodes((prev) => prev.filter((node) => node.id !== deletedId));
                setDbEdges((prev) => prev.filter((edge) => edge.from_node_id !== deletedId && edge.to_node_id !== deletedId));
                setSelectedNodeId((prev) => (prev === deletedId ? null : prev));
              }
              break;
            }
            case 'EDGE_CREATED': {
              const edge = payload.data?.edge as DbEdge | undefined;
              if (edge?.id) {
                setDbEdges((prev) => (prev.some((existingEdge) => existingEdge.id === edge.id) ? prev : [...prev, edge]));
              }
              break;
            }
            case 'EDGE_DELETED': {
              const edgeId = payload.data?.edgeId;
              if (edgeId) {
                setDbEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
              }
              break;
            }
            default:
              break;
          }
        } catch {
          // Ignore keep-alives and malformed payloads.
        }
      };

      eventSource.onerror = () => {
        console.error('Map SSE connection error');
      };
    } catch {
      console.error('Failed to establish Map SSE connection');
    }

    return () => {
      eventSource?.close();
    };
  }, []);

  const savePositionRef = useRef(
    debounce(async (nodeId: number, x: number, y: number, mode: MapViewMode) => {
      try {
        const res = await fetch(`/api/nodes/${nodeId}`);
        if (!res.ok) return;
        const { node: existing } = await res.json();
        const existingMetadata = existing?.metadata ?? {};
        const mergedMeta = typeof existingMetadata === 'string'
          ? (() => {
              try {
                return JSON.parse(existingMetadata);
              } catch {
                return {};
              }
            })()
          : existingMetadata;

        await fetch(`/api/nodes/${nodeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metadata: {
              ...mergedMeta,
              map_positions: {
                ...(mergedMeta.map_positions || {}),
                [mode]: { x, y },
              },
              [`map_position_${mode}`]: { x, y },
            },
          }),
        });
      } catch (err) {
        console.error('Failed to save node position:', err);
      }
    }, 400),
  );

  const onNodeDragStop: NodeMouseHandler<RFNode<RahNodeData>> = useCallback((_event, node) => {
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      rfPositionsRef.current.set(node.id, node.position);
      savePositionRef.current(nodeId, node.position.x, node.position.y, viewMode);
    }
  }, [viewMode]);

  useEffect(() => {
    rfPositionsRef.current.clear();
  }, [viewMode]);

  useEffect(() => {
    if (loading || rfNodes.length === 0) return;

    const timeout = setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.22, duration: 300 });
    }, 80);

    return () => clearTimeout(timeout);
  }, [viewMode, loading, rfNodes, reactFlowInstance]);

  const onNodeClickHandler: NodeMouseHandler<RFNode<RahNodeData>> = useCallback((_event, node) => {
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
    }
  }, []);

  const onNodeDoubleClick: NodeMouseHandler<RFNode<RahNodeData>> = useCallback((_event, node) => {
    const nodeId = parseInt(node.id, 10);
    if (!Number.isNaN(nodeId)) {
      onNodeClick?.(nodeId);
    }
  }, [onNodeClick]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return;
    setPendingConnection(connection);
  }, []);

  const handleEdgeCreate = useCallback(async (explanation: string) => {
    if (!pendingConnection?.source || !pendingConnection?.target) return;

    const fromId = parseInt(pendingConnection.source, 10);
    const toId = parseInt(pendingConnection.target, 10);

    try {
      const res = await fetch('/api/edges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_node_id: fromId,
          to_node_id: toId,
          source: 'user',
          explanation,
          created_via: 'ui',
        }),
      });

      if (res.ok) {
        const payload = await res.json();
        const edge = payload.data;
        if (edge?.id) {
          setDbEdges((prev) => (prev.some((existingEdge) => existingEdge.id === edge.id) ? prev : [...prev, edge]));
        }
      }
    } catch (err) {
      console.error('Failed to create edge:', err);
    }

    setPendingConnection(null);
  }, [pendingConnection]);

  const handleEdgeCancel = useCallback(() => {
    setPendingConnection(null);
  }, []);

  const pendingSourceTitle = pendingConnection?.source
    ? allDbNodes.find((node) => node.id === parseInt(pendingConnection.source, 10))?.title || 'Unknown'
    : '';
  const pendingTargetTitle = pendingConnection?.target
    ? allDbNodes.find((node) => node.id === parseInt(pendingConnection.target, 10))?.title || 'Unknown'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setViewMode('context')}
            style={{
              padding: '6px 10px',
              background: viewMode === 'context' ? 'var(--rah-accent-green-soft)' : 'transparent',
              border: '1px solid',
              borderColor: viewMode === 'context' ? 'var(--rah-accent-green-soft-strong)' : 'var(--rah-border-strong)',
              borderRadius: '6px',
              color: viewMode === 'context' ? 'var(--rah-accent-green)' : 'var(--rah-text-muted)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Context View
          </button>
          <button
            onClick={() => setViewMode('hub')}
            style={{
              padding: '6px 10px',
              background: viewMode === 'hub' ? 'var(--rah-accent-green-soft)' : 'transparent',
              border: '1px solid',
              borderColor: viewMode === 'hub' ? 'var(--rah-accent-green-soft-strong)' : 'var(--rah-border-strong)',
              borderRadius: '6px',
              color: viewMode === 'hub' ? 'var(--rah-accent-green)' : 'var(--rah-text-muted)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Hub View
          </button>
        </div>
      </PaneHeader>

      <div style={{ position: 'relative', flex: 1, background: 'var(--rah-bg-base)' }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rah-text-muted)' }}>
            Loading map...
          </div>
        ) : error ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
            {error}
          </div>
        ) : rfNodes.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rah-text-muted)' }}>
            No nodes to display
          </div>
        ) : (
          <div className="rah-map-wrapper" style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClickHandler}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              minZoom={0.1}
              maxZoom={3}
              defaultEdgeOptions={{ type: 'rahEdge' }}
              proOptions={{ hideAttribution: true }}
              colorMode={theme}
            >
              <Background color="var(--rah-border)" gap={40} size={1} />
              <MiniMap
                style={{ background: 'var(--rah-bg-panel)', border: '1px solid var(--rah-border)', borderRadius: 6 }}
                maskColor={theme === 'light' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(0, 0, 0, 0.7)'}
                nodeColor={(node) => {
                  const data = node.data as RahNodeData | undefined;
                  return data?.clusterColor || '#2a2a2a';
                }}
                pannable
                zoomable
              />
            </ReactFlow>

            {viewMode === 'context' && clusterLabels.map((label) => (
              <div
                key={label.clusterLabel}
                style={{
                  position: 'absolute',
                  transform: `translate(${label.x}px, ${label.y}px)`,
                  pointerEvents: 'none',
                  color: 'var(--rah-text-muted)',
                  fontSize: '11px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  textShadow: theme === 'light' ? '0 1px 3px rgba(255,255,255,0.95)' : '0 1px 6px rgba(0,0,0,0.45)',
                }}
              >
                {label.clusterLabel}
              </div>
            ))}

            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                display: 'flex',
                gap: 4,
                zIndex: 10,
              }}
            >
              <button
                onClick={fitAllNodes}
                style={{
                  padding: '4px 8px',
                  fontSize: 10,
                  background: 'var(--rah-bg-panel)',
                  border: '1px solid var(--rah-border-strong)',
                  borderRadius: 4,
                  color: 'var(--rah-text-muted)',
                  cursor: 'pointer',
                }}
                title="Fit all nodes"
              >
                Fit
              </button>
              {viewMode === 'hub' && (
                <button
                  onClick={fitHubNodes}
                  style={{
                    padding: '4px 8px',
                    fontSize: 10,
                    background: 'var(--rah-bg-panel)',
                    border: '1px solid var(--rah-border-strong)',
                    borderRadius: 4,
                    color: 'var(--rah-text-muted)',
                    cursor: 'pointer',
                  }}
                  title="Fit to hub nodes"
                >
                  Hubs
                </button>
              )}
            </div>

            {selectedDbNode && (
              <div style={infoPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--rah-text-base)' }}>
                    {selectedDbNode.title || 'Untitled'}
                  </div>
                  <button
                    onClick={() => setSelectedNodeId(null)}
                    style={{ background: 'none', border: 'none', color: 'var(--rah-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--rah-text-muted)', marginBottom: 8 }}>
                  {connectedNodeIds.size} connected nodes
                </div>
                <div style={{ fontSize: 11, color: 'var(--rah-accent-green)', marginBottom: 8 }}>
                  Click a connected node to traverse &middot; Double-click to open
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      background: selectedDbNode.context?.name ? 'var(--rah-accent-green-soft)' : 'var(--rah-bg-active)',
                      color: selectedDbNode.context?.name ? 'var(--rah-accent-green)' : 'var(--rah-text-muted)',
                    }}
                  >
                    {selectedDbNode.context?.name || 'Unscoped'}
                  </span>
                </div>
                <button
                  onClick={() => onNodeClick?.(selectedDbNode.id)}
                  style={{
                    marginTop: 4,
                    padding: '8px 12px',
                    background: 'var(--rah-accent-green)',
                    color: 'var(--rah-text-inverse)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  Open Node
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {pendingConnection && (
        <EdgeExplanationModal
          sourceTitle={pendingSourceTitle}
          targetTitle={pendingTargetTitle}
          onSubmit={handleEdgeCreate}
          onCancel={handleEdgeCancel}
        />
      )}
    </div>
  );
}

export default function MapPane(props: MapPaneProps) {
  return (
    <ReactFlowProvider>
      <MapPaneInner {...props} />
    </ReactFlowProvider>
  );
}

const infoPanel: CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  width: 260,
  background: 'var(--rah-bg-modal)',
  border: '1px solid var(--rah-border)',
  borderRadius: 8,
  padding: 14,
  zIndex: 10,
  boxShadow: 'var(--rah-shadow-floating)',
};
