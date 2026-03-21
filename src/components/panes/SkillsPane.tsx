"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import PaneHeader from './PaneHeader';
import type { BasePaneProps } from './types';
import SkillCard from '@/components/skills/SkillCard';
import SkillMarkdown from '@/components/skills/SkillMarkdown';

interface SkillMeta {
  name: string;
  description: string;
  immutable: boolean;
}

interface Skill extends SkillMeta {
  content: string;
}

export default function SkillsPane({
  slot,
  onCollapse,
  onSwapPanes,
  tabBar,
}: BasePaneProps) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchSkills();

    const handleSkillUpdated = () => {
      void fetchSkills();
    };
    window.addEventListener('skills:updated', handleSkillUpdated);
    window.addEventListener('guides:updated', handleSkillUpdated);

    return () => {
      window.removeEventListener('skills:updated', handleSkillUpdated);
      window.removeEventListener('guides:updated', handleSkillUpdated);
    };
  }, []);

  useEffect(() => {
    if (selectedSkill && detailScrollRef.current) {
      detailScrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [selectedSkill?.name]);

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.success) {
        setSkills(data.data);
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSkill = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.success) {
        setSelectedSkill(data.data);
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to fetch skill:', err);
    }
  };

  const handleDeleteSkill = async (name: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!confirm(`Delete skill "${name}"?`)) return;

    setDeleting(name);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        await fetchSkills();
        if (selectedSkill?.name === name) {
          setSelectedSkill(null);
        }
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to delete skill:', err);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar}>
        {selectedSkill ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setSelectedSkill(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <span style={{ color: 'var(--rah-text-base)', fontSize: '13px', fontWeight: 500 }}>{selectedSkill.name}</span>
          </div>
        ) : (
          <span style={{ color: 'var(--rah-text-muted)', fontSize: '11px' }}>{skills.length} skills</span>
        )}
      </PaneHeader>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px' }} ref={detailScrollRef}>
        {loading ? (
          <div style={{ color: 'var(--rah-text-muted)', fontSize: '13px', textAlign: 'center', paddingTop: '24px' }}>Loading...</div>
        ) : selectedSkill ? (
          <div style={{ width: '100%', maxWidth: '980px', margin: '0 auto' }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: 'var(--rah-text-active)', fontSize: '16px', fontWeight: 600 }}>{selectedSkill.name}</div>
              <div style={{ color: 'var(--rah-text-soft)', fontSize: '13px', lineHeight: 1.4, marginTop: '6px' }}>{selectedSkill.description}</div>
            </div>
            <div style={{ borderTop: '1px solid var(--rah-border)', margin: '12px 0' }} />
            <SkillMarkdown content={selectedSkill.content} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {skills.length === 0 ? (
              <div style={{ color: 'var(--rah-text-muted)', fontSize: '13px', textAlign: 'center', paddingTop: '24px' }}>
                No skills found
              </div>
            ) : (
              skills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  onSelect={handleSelectSkill}
                  onDelete={handleDeleteSkill}
                  deleting={deleting}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
