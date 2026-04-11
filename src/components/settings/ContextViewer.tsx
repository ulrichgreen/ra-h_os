"use client";

import { useEffect, useState, type CSSProperties } from 'react';
import type { Node } from '@/types/database';

interface NodeWithMetrics extends Node {
  edge_count?: number;
}

interface CapsuleData {
  userProfile: string;
  agentProfile: string;
  lastUpdatedAt: string;
}

export default function ContextViewer() {
  const [nodes, setNodes] = useState<NodeWithMetrics[]>([]);
  const [capsule, setCapsule] = useState<CapsuleData | null>(null);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [loadingCapsule, setLoadingCapsule] = useState(true);
  const [resetting, setResetting] = useState(false);

  const loadNodes = async () => {
    try {
      const res = await fetch('/api/nodes?sortBy=edges&limit=5');
      const payload = await res.json();
      setNodes(payload.data || []);
    } catch (error) {
      console.error(error);
      setNodes([]);
    } finally {
      setLoadingNodes(false);
    }
  };

  const loadCapsule = async () => {
    try {
      const res = await fetch('/api/rah/memory');
      const payload = await res.json();
      setCapsule(payload.data?.capsule ?? null);
    } catch (error) {
      console.error(error);
      setCapsule(null);
    } finally {
      setLoadingCapsule(false);
    }
  };

  useEffect(() => {
    void loadNodes();
    void loadCapsule();
  }, []);

  const handleReset = async () => {
    if (!confirm('Reset the context capsule to neutral defaults?')) return;
    try {
      setResetting(true);
      await fetch('/api/rah/memory', { method: 'DELETE' });
      await loadCapsule();
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={containerStyle}>
      <p style={descStyle}>
        RA-H now carries one compact context capsule into every conversation. It stays neutral by default,
        updates only on meaningful changes, and sits alongside hub nodes rather than replacing them.
      </p>

      <div style={capsuleHeaderStyle}>
        <div>
          <div style={labelStyle}>Context Capsule</div>
          <div style={subLabelStyle}>Always injected into the system prompt. Max 200 words total.</div>
        </div>
        <button
          onClick={handleReset}
          disabled={resetting}
          style={resetButtonStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--settings-button-hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {resetting ? 'Resetting...' : 'Reset Capsule'}
        </button>
      </div>

      {loadingCapsule ? (
        <div style={mutedStyle}>Loading capsule...</div>
      ) : capsule ? (
        <div style={capsuleGridStyle}>
          <CapsuleSection
            title="User"
            value={capsule.userProfile}
            footer={capsule.lastUpdatedAt ? `Updated ${new Date(capsule.lastUpdatedAt).toLocaleString()}` : 'Never updated'}
          />
          <CapsuleSection title="Agent" value={capsule.agentProfile} />
        </div>
      ) : (
        <div style={mutedStyle}>Capsule unavailable.</div>
      )}

      <div style={{ ...labelStyle, marginTop: 28 }}>Hub Nodes</div>
      <div style={subLabelStyle}>
        Your 5 most-connected nodes remain the raw graph grounding and are included in every conversation.
      </div>

      {loadingNodes ? (
        <div style={mutedStyle}>Loading hub nodes...</div>
      ) : nodes.length === 0 ? (
        <div style={mutedStyle}>No connected nodes yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {nodes.map((node) => (
            <div key={node.id} style={nodeCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={nodeTitleStyle}>{node.title || 'Untitled'}</span>
                <span style={edgeCountStyle}>{node.edge_count ?? 0}</span>
              </div>
              {node.description && (
                <div style={nodeDescriptionStyle}>{node.description}</div>
              )}
              {node.context?.name && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={contextTagStyle}>{node.context.name}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapsuleSection({
  title,
  value,
  footer,
}: {
  title: string;
  value: string;
  footer?: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{title}</div>
      <div style={capsuleBodyStyle}>{value}</div>
      {footer && <div style={capsuleFooterStyle}>{footer}</div>}
    </div>
  );
}

const containerStyle: CSSProperties = { padding: 24, height: '100%', overflow: 'auto' };
const descStyle: CSSProperties = { fontSize: 13, color: 'var(--settings-muted)', marginBottom: 20, lineHeight: 1.5, maxWidth: 780 };
const capsuleHeaderStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 };
const capsuleGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };
const cardStyle: CSSProperties = {
  background: 'var(--settings-card-bg)',
  border: '1px solid var(--settings-border)',
  borderRadius: 8,
  padding: 16,
  minHeight: 140,
};
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--settings-text)', marginBottom: 8 };
const subLabelStyle: CSSProperties = { fontSize: 12, color: 'var(--settings-muted)' };
const mutedStyle: CSSProperties = { fontSize: 13, color: 'var(--settings-muted)', marginTop: 10 };
const capsuleBodyStyle: CSSProperties = { fontSize: 13, lineHeight: 1.6, color: 'var(--settings-subtext)', whiteSpace: 'pre-wrap' };
const capsuleFooterStyle: CSSProperties = { fontSize: 11, color: 'var(--settings-muted)', marginTop: 12 };
const resetButtonStyle: CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid var(--settings-border-strong)',
  borderRadius: '6px',
  color: 'var(--settings-text)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap',
};
const nodeCardStyle: CSSProperties = {
  padding: '12px 14px',
  background: 'var(--settings-card-bg)',
  border: '1px solid var(--settings-border)',
  borderRadius: 6,
};
const nodeTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--settings-text)' };
const nodeDescriptionStyle: CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--settings-subtext)', marginTop: 8 };
const edgeCountStyle: CSSProperties = { fontSize: 12, color: 'var(--settings-muted)' };
const contextTagStyle: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  background: 'var(--settings-chip-bg)',
  color: 'var(--settings-subtext)',
  border: '1px solid var(--settings-border)',
};
