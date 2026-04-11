"use client";

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { RahNodeData } from './utils';
import { getNodeIcon } from '@/utils/nodeIcons';

type RahNodeType = Node<RahNodeData, 'rahNode'>;

function RahNodeComponent({ data, selected }: NodeProps<RahNodeType>) {
  const { label, clusterLabel, edgeCount, isExpanded, dbNode, clusterColor } = data;
  const isTop = !isExpanded && edgeCount > 3;

  return (
    <div
      className={[
        'rah-map-node',
        isExpanded && 'rah-map-node--expanded',
        isTop && 'rah-map-node--top',
        selected && 'rah-map-node--selected',
      ].filter(Boolean).join(' ')}
      style={clusterColor ? { borderLeftColor: clusterColor, borderLeftWidth: 3 } : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="rah-map-handle"
      />
      <div className="rah-map-node__title">
        <span className="rah-map-node__icon">
          {getNodeIcon(dbNode, 14)}
        </span>
        {label.length > 26 ? label.slice(0, 24) + '\u2026' : label}
      </div>
      {(isTop || isExpanded) && clusterLabel && (
        <div className="rah-map-node__dims">
          {clusterLabel.length > 24 ? `${clusterLabel.slice(0, 23)}\u2026` : clusterLabel}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="rah-map-handle"
      />
    </div>
  );
}

export const RahNode = memo(RahNodeComponent);
