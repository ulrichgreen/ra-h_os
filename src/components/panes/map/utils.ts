import type { Node as DbNode, Edge as DbEdge } from '@/types/database';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';

const CLUSTER_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
  '#a855f7',
];

export type MapViewMode = 'context' | 'hub';

function hashClusterColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length];
}

export function getNodeClusterLabel(node: DbNode): string {
  return node.context?.name?.trim() || 'Unscoped';
}

export function getClusterColor(label: string): string {
  return label === 'Unscoped' ? '#4b5563' : hashClusterColor(label);
}

export interface RahNodeData {
  label: string;
  clusterLabel: string;
  edgeCount: number;
  isExpanded: boolean;
  dbNode: DbNode;
  clusterColor?: string;
  clusterKey?: string;
  [key: string]: unknown;
}

export const NODE_LIMIT = 200;
export const LABEL_THRESHOLD = 15;

export function getSavedMapPosition(
  node: DbNode,
  viewMode: MapViewMode,
): { x: number; y: number } | null {
  const metadata = typeof node.metadata === 'string'
    ? safeParseJSON(node.metadata)
    : node.metadata;

  const nested = metadata?.map_positions as Record<string, { x?: number; y?: number }> | undefined;
  const scoped = metadata?.[`map_position_${viewMode}`] as { x?: number; y?: number } | undefined;
  const saved = nested?.[viewMode] || scoped;

  if (saved?.x !== undefined && saved?.y !== undefined) {
    return { x: saved.x, y: saved.y };
  }

  return null;
}

function getAllNodes(baseNodes: DbNode[], expandedNodes: DbNode[]): DbNode[] {
  const baseIds = new Set(baseNodes.map((node) => node.id));
  return [...baseNodes, ...expandedNodes.filter((node) => !baseIds.has(node.id))];
}

function buildContextLayout(nodes: DbNode[], centerX: number, centerY: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const groups = new Map<string, DbNode[]>();

  for (const node of nodes) {
    const key = getNodeClusterLabel(node);
    const existing = groups.get(key) || [];
    existing.push(node);
    groups.set(key, existing);
  }

  const clusterKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(clusterKeys.length || 1)));
  const clusterGapX = 360;
  const clusterGapY = 280;
  const originX = centerX - ((columns - 1) * clusterGapX) / 2;
  const rows = Math.max(1, Math.ceil(clusterKeys.length / columns));
  const originY = centerY - ((rows - 1) * clusterGapY) / 2;

  clusterKeys.forEach((clusterKey, clusterIndex) => {
    const clusterNodes = (groups.get(clusterKey) || []).sort((a, b) => {
      return (b.edge_count ?? 0) - (a.edge_count ?? 0);
    });

    const clusterColumn = clusterIndex % columns;
    const clusterRow = Math.floor(clusterIndex / columns);
    const clusterCenterX = originX + clusterColumn * clusterGapX;
    const clusterCenterY = originY + clusterRow * clusterGapY;
    const clusterCols = Math.max(1, Math.ceil(Math.sqrt(clusterNodes.length)));

    clusterNodes.forEach((node, index) => {
      const col = index % clusterCols;
      const row = Math.floor(index / clusterCols);
      const x = clusterCenterX + (col - (clusterCols - 1) / 2) * 120 + (row % 2 === 0 ? 0 : 18);
      const y = clusterCenterY + row * 96;
      positions.set(String(node.id), { x, y });
    });
  });

  return positions;
}

function buildHubLayout(
  nodes: DbNode[],
  dbEdges: DbEdge[],
  centerX: number,
  centerY: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const sortedNodes = [...nodes].sort((a, b) => (b.edge_count ?? 0) - (a.edge_count ?? 0));
  const hubCount = Math.max(1, Math.min(10, Math.ceil(Math.sqrt(sortedNodes.length || 1))));
  const hubs = sortedNodes.slice(0, hubCount);
  const hubIds = new Set(hubs.map((node) => node.id));

  const adjacency = new Map<number, number[]>();
  for (const edge of dbEdges) {
    const from = adjacency.get(edge.from_node_id) || [];
    from.push(edge.to_node_id);
    adjacency.set(edge.from_node_id, from);

    const to = adjacency.get(edge.to_node_id) || [];
    to.push(edge.from_node_id);
    adjacency.set(edge.to_node_id, to);
  }

  const clusterMembers = new Map<number, DbNode[]>();
  for (const hub of hubs) {
    clusterMembers.set(hub.id, [hub]);
  }

  const orphanNodes: DbNode[] = [];
  for (const node of sortedNodes) {
    if (hubIds.has(node.id)) continue;

    const neighbours = adjacency.get(node.id) || [];
    const connectedHub = hubs
      .filter((hub) => neighbours.includes(hub.id))
      .sort((a, b) => (b.edge_count ?? 0) - (a.edge_count ?? 0))[0];

    if (connectedHub) {
      const members = clusterMembers.get(connectedHub.id) || [connectedHub];
      members.push(node);
      clusterMembers.set(connectedHub.id, members);
    } else {
      orphanNodes.push(node);
    }
  }

  const hubRadius = Math.max(160, hubCount * 42);
  hubs.forEach((hub, index) => {
    const angle = (index / hubCount) * Math.PI * 2 - Math.PI / 2;
    const hubX = centerX + Math.cos(angle) * hubRadius;
    const hubY = centerY + Math.sin(angle) * hubRadius;
    positions.set(String(hub.id), { x: hubX, y: hubY });

    const members = (clusterMembers.get(hub.id) || []).filter((member) => member.id !== hub.id);
    members.forEach((member, memberIndex) => {
      const memberAngle = (memberIndex / Math.max(members.length, 1)) * Math.PI * 2;
      const ringRadius = 115 + Math.floor(memberIndex / 10) * 46;
      positions.set(String(member.id), {
        x: hubX + Math.cos(memberAngle) * ringRadius,
        y: hubY + Math.sin(memberAngle) * ringRadius,
      });
    });
  });

  orphanNodes.forEach((node, index) => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(orphanNodes.length)));
    const col = index % columns;
    const row = Math.floor(index / columns);
    positions.set(String(node.id), {
      x: centerX - 220 + col * 110,
      y: centerY + hubRadius + 140 + row * 90,
    });
  });

  return positions;
}

export function getClusterKey(node: DbNode, viewMode: MapViewMode, dbEdges: DbEdge[]): string {
  if (viewMode === 'context') {
    return getNodeClusterLabel(node);
  }

  return `hub:${node.id}`;
}

export function toRFNodes(
  baseNodes: DbNode[],
  expandedNodes: DbNode[],
  centerX: number,
  centerY: number,
  selectedNodeId: number | null,
  connectedNodeIds: Set<number>,
  existingPositions: Map<string, { x: number; y: number }>,
  viewMode: MapViewMode,
  dbEdges: DbEdge[],
): RFNode<RahNodeData>[] {
  const allNodes = getAllNodes(baseNodes, expandedNodes);
  const hasSelection = selectedNodeId !== null;
  const clusterLayout = viewMode === 'context'
    ? buildContextLayout(allNodes, centerX, centerY)
    : buildHubLayout(allNodes, dbEdges, centerX, centerY);
  const baseNodeIds = new Set(baseNodes.map((node) => node.id));

  return allNodes.map((node) => {
    const id = String(node.id);
    const existingPos = existingPositions.get(id);
    const savedPos = getSavedMapPosition(node, viewMode);
    const fallbackPos = clusterLayout.get(id) || { x: centerX, y: centerY };
    const pos = existingPos || savedPos || fallbackPos;
    const isDimmed = hasSelection && node.id !== selectedNodeId && !connectedNodeIds.has(node.id);
    const clusterLabel = getNodeClusterLabel(node);

    return {
      id,
      type: 'rahNode',
      position: pos,
      className: isDimmed ? 'dimmed' : undefined,
      data: {
        label: node.title || 'Untitled',
        clusterLabel,
        edgeCount: node.edge_count ?? 0,
        isExpanded: !baseNodeIds.has(node.id),
        dbNode: node,
        clusterColor: getClusterColor(clusterLabel),
        clusterKey: viewMode === 'context' ? clusterLabel : undefined,
      },
    };
  });
}

export function toRFEdges(
  dbEdges: DbEdge[],
  nodeIds: Set<string>,
  selectedNodeId: number | null,
): RFEdge[] {
  const hasSelection = selectedNodeId !== null;

  return dbEdges
    .filter((edge) => nodeIds.has(String(edge.from_node_id)) && nodeIds.has(String(edge.to_node_id)))
    .map((edge) => {
      const isConnected = hasSelection && (
        edge.from_node_id === selectedNodeId || edge.to_node_id === selectedNodeId
      );
      const isDimmed = hasSelection && !isConnected;
      const explanation = typeof edge.context?.explanation === 'string' ? edge.context.explanation : '';

      return {
        id: String(edge.id),
        source: String(edge.from_node_id),
        target: String(edge.to_node_id),
        type: 'rahEdge',
        animated: isConnected,
        data: { explanation },
        style: isConnected
          ? { stroke: '#22c55e', strokeWidth: 2.5, opacity: 1 }
          : isDimmed
            ? { stroke: '#374151', strokeWidth: 1, opacity: 0.15 }
            : undefined,
        zIndex: isConnected ? 10 : 0,
      };
    });
}

function safeParseJSON(str: string | null | undefined): Record<string, any> | null {
  if (!str || str === 'null') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
