"use client";

import { useState, useEffect, type CSSProperties } from 'react';
import { openExternalUrl } from '@/utils/openExternalUrl';

export default function ApiKeysViewer() {
  const [status, setStatus] = useState<'checking' | 'configured' | 'not-set'>('checking');

  useEffect(() => {
    // Check via health endpoint (server-side check of process.env)
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setStatus(data.aiFeatures?.startsWith('enabled') ? 'configured' : 'not-set');
      })
      .catch(() => setStatus('not-set'));
  }, []);

  return (
    <div style={containerStyle}>
      {/* Features explanation */}
      <div style={featuresBoxStyle}>
        <div style={featuresHeaderStyle}>OpenAI API Key enables:</div>
        <ul style={featuresListStyle}>
          <li>Auto-generated descriptions for new nodes</li>
          <li>Edge explanation inference</li>
          <li>Semantic search via embeddings</li>
        </ul>
        <div style={noteStyle}>
          Without a key, you can still create and organise nodes manually.
        </div>
      </div>

      {/* Status */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={cardTitleStyle}>OpenAI API Key</span>
          <span style={{
            fontSize: 12,
            color: status === 'checking'
              ? 'var(--settings-muted)'
              : status === 'configured'
                ? 'var(--settings-text)'
                : 'var(--settings-danger)'
          }}>
            {status === 'configured' ? 'Configured' :
             status === 'checking' ? 'Checking...' : 'Not configured'}
          </span>
        </div>

        <div style={instructionsStyle}>
          <p style={{ margin: 0, marginBottom: 8 }}>
            Add your key to <code style={codeInlineStyle}>.env.local</code> in the project root:
          </p>
          <div style={codeBlockStyle}>
            <code>OPENAI_API_KEY=sk-your-key-here</code>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--settings-muted)' }}>
            Restart the app after changing the key.
          </p>
        </div>
      </div>

      {/* Get key link */}
      <div style={helpStyle}>
        <button
          type="button"
          onClick={() => {
            void openExternalUrl('https://platform.openai.com/api-keys').catch((error) => {
              console.error('[ApiKeysViewer] Failed to open OpenAI API keys page', error);
              window.alert('Unable to open the OpenAI API keys page automatically.');
            });
          }}
          style={linkStyle}
        >
          Get your API key from OpenAI →
        </button>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  padding: 24,
  height: '100%',
  overflow: 'auto',
};

const featuresBoxStyle: CSSProperties = {
  background: 'var(--settings-card-bg)',
  border: '1px solid var(--settings-border)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 20,
};

const featuresHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--settings-text)',
  marginBottom: 8,
};

const featuresListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 13,
  color: 'var(--settings-subtext)',
  lineHeight: 1.6,
};

const noteStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  color: 'var(--settings-muted)',
  fontStyle: 'italic',
};

const cardStyle: CSSProperties = {
  background: 'var(--settings-card-bg)',
  border: '1px solid var(--settings-border)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};

const cardTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--settings-text)',
};

const instructionsStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--settings-subtext)',
  lineHeight: 1.5,
};

const codeInlineStyle: CSSProperties = {
  background: 'var(--settings-code-bg)',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'monospace',
  color: 'var(--settings-text)',
};

const codeBlockStyle: CSSProperties = {
  background: 'var(--settings-code-bg)',
  border: '1px solid var(--settings-border)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: 'var(--settings-text)',
  marginBottom: 8,
};

const helpStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--settings-muted)',
};

const linkStyle: CSSProperties = {
  color: 'var(--settings-text)',
  textDecoration: 'none',
  background: 'transparent',
  border: '1px solid var(--settings-border-strong)',
  borderRadius: 6,
  padding: '10px 14px',
  cursor: 'pointer',
  font: 'inherit',
};
