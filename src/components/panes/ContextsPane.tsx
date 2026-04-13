"use client";

import { useEffect, useState } from 'react';
import { Folder } from 'lucide-react';
import type { ContextSummary } from '@/types/database';
import PaneHeader from './PaneHeader';
import type { ContextsPaneProps } from './types';

export default function ContextsPane({
  slot,
  onCollapse,
  onSwapPanes,
  tabBar,
  onContextSelect,
}: ContextsPaneProps) {
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/contexts');
        const payload = await response.json();
        if (response.ok && payload.success) {
          setContexts(payload.data || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}>
      <PaneHeader
        slot={slot}
        onCollapse={onCollapse}
        onSwapPanes={onSwapPanes}
        tabBar={tabBar}
        toolbarHostRef={setToolbarHost}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px' }}>
        <div style={{ maxWidth: '980px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading ? (
            <div style={emptyStateStyle}>Loading contexts...</div>
          ) : contexts.length === 0 ? (
            <div style={emptyStateStyle}>No contexts yet. That is optional.</div>
          ) : (
            contexts.map((context) => (
              <button
                key={context.id}
                type="button"
                onClick={() => onContextSelect?.(context.id, context.name)}
                style={rowStyle}
              >
                <div style={iconWrapStyle}>
                  <Folder size={17} />
                </div>
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--rah-text-primary)' }}>{context.name}</span>
                    <span style={countStyle}>{context.count}</span>
                  </div>
                  {context.description ? (
                    <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--rah-text-secondary)', lineHeight: 1.45 }}>
                      {context.description}
                    </div>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px',
  border: '1px solid var(--rah-border)',
  borderRadius: '12px',
  background: 'var(--rah-bg-card)',
  cursor: 'pointer',
};

const iconWrapStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '10px',
  border: '1px solid var(--rah-border)',
  background: 'var(--rah-bg-panel)',
  color: 'var(--rah-text-muted)',
  flexShrink: 0,
};

const countStyle: React.CSSProperties = {
  fontSize: '10px',
  lineHeight: 1.2,
  padding: '3px 7px',
  borderRadius: '999px',
  border: '1px solid var(--rah-border)',
  background: 'var(--rah-bg-panel)',
  color: 'var(--rah-text-muted)',
};

const emptyStateStyle: React.CSSProperties = {
  border: '1px dashed var(--rah-border-strong)',
  borderRadius: '12px',
  padding: '16px',
  color: 'var(--rah-text-muted)',
  fontSize: '13px',
  background: 'var(--rah-bg-card)',
};
