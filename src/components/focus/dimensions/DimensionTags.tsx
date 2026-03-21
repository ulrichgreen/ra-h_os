"use client";

import { useState, useEffect, useRef } from 'react';
import DimensionSearchModal from './DimensionSearchModal';

interface DimensionTagsProps {
  dimensions: string[];
  onUpdate: (dimensions: string[]) => Promise<void>;
  disabled?: boolean;
}

interface DimensionSuggestion {
  dimension: string;
  count: number;
}

export default function DimensionTags({
  dimensions,
  onUpdate,
  disabled = false
}: DimensionTagsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DimensionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedDimensions = [...dimensions];

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (searchQuery.length > 0) {
      fetchSuggestions(searchQuery);
    } else if (isAdding) {
      // Load popular dimensions when field is empty
      fetchPopularDimensions();
    } else {
      setSuggestions([]);
    }
  }, [searchQuery, isAdding]);

  const fetchSuggestions = async (query: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/dimensions/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.success) {
        setSuggestions(data.data);
      }
    } catch (error) {
      console.error('Error fetching dimension suggestions:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPopularDimensions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/dimensions/popular');
      const data = await response.json();
      if (data.success) {
        setSuggestions(data.data);
      }
    } catch (error) {
      console.error('Error fetching popular dimensions:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const addDimension = async (dimension: string, description?: string) => {
    if (!dimension.trim() || dimensions.includes(dimension.trim())) {
      return;
    }

    // If description is provided, create/update the dimension in the database first
    if (description) {
      try {
        await fetch('/api/dimensions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: dimension.trim(),
            description: description.trim(),
            isPriority: false
          })
        });
      } catch (error) {
        console.error('Error creating dimension with description:', error);
      }
    }

    const newDimensions = [...dimensions, dimension.trim()];
    await onUpdate(newDimensions);

    setSearchQuery('');
    setSuggestions([]);
    setIsAdding(false);
  };

  const removeDimension = async (index: number) => {
    const dimension = sortedDimensions[index];
    const newDimensions = dimensions.filter(d => d !== dimension);
    await onUpdate(newDimensions);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const draggedDimension = sortedDimensions[draggedIndex];
    const targetDimension = sortedDimensions[index];
    
    // Find original positions in unsorted array
    const draggedOrigIndex = dimensions.indexOf(draggedDimension);
    const targetOrigIndex = dimensions.indexOf(targetDimension);
    
    const newDimensions = [...dimensions];
    newDimensions.splice(draggedOrigIndex, 1);
    newDimensions.splice(targetOrigIndex, 0, draggedDimension);
    
    onUpdate(newDimensions);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const moveDimension = async (fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= sortedDimensions.length) return;

    const fromDimension = sortedDimensions[fromIndex];
    const toDimension = sortedDimensions[toIndex];
    
    // Find original positions in unsorted array
    const fromOrigIndex = dimensions.indexOf(fromDimension);
    const toOrigIndex = dimensions.indexOf(toDimension);
    
    const newDimensions = [...dimensions];
    [newDimensions[fromOrigIndex], newDimensions[toOrigIndex]] = [newDimensions[toOrigIndex], newDimensions[fromOrigIndex]];
    await onUpdate(newDimensions);
  };

  // Check if dimensions overflow 2 lines (approximate)
  const shouldShowExpandButton = sortedDimensions.length > 6; // Rough estimate for 2 lines
  const displayedDimensions = (!isExpanded && shouldShowExpandButton) 
    ? sortedDimensions.slice(0, 6) 
    : sortedDimensions;
  const hiddenCount = sortedDimensions.length - 6;

  return (
    <div>
      <div 
        ref={containerRef}
        onClick={() => {
          if (shouldShowExpandButton && !isExpanded) {
            setIsExpanded(true);
          }
        }}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: '8px',
          cursor: (shouldShowExpandButton && !isExpanded) ? 'pointer' : 'default',
          position: 'relative',
          minHeight: dimensions.length === 0 ? '24px' : 'auto'
        }}
      >
        {/* Show placeholder when no dimensions */}
        {dimensions.length === 0 && !disabled && (
          <span style={{
            fontSize: '11px',
            color: 'var(--rah-text-muted)',
            fontStyle: 'italic',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            No dimensions
          </span>
        )}

        {displayedDimensions.map((dimension, index) => {
          return (
            <div
              key={`${dimension}-${index}`}
              draggable={!disabled}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '10px',
                color: 'var(--rah-text-base)',
                background: 'var(--rah-bg-active)',
                border: '1px solid var(--rah-border-strong)',
                borderRadius: '8px',
                padding: '2px 6px',
                cursor: disabled ? 'default' : 'grab',
                opacity: draggedIndex === index ? 0.5 : 1,
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                if (!disabled) {
                  e.currentTarget.style.borderColor = 'var(--rah-border-stronger)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--rah-border-strong)';
              }}
            >
              <span>{dimension}</span>
              
              {/* Reorder buttons removed - no longer needed */}
              
              {/* Remove button */}
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDimension(index);
                  }}
                  style={{
                    padding: '0 2px',
                    fontSize: '14px',
                    color: 'var(--rah-text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    marginLeft: '2px'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ff6b6b'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--rah-text-muted)'; }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        
        {/* Show "+X more" indicator */}
        {shouldShowExpandButton && !isExpanded && hiddenCount > 0 && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: '11px',
              color: 'var(--rah-text-muted)',
              background: 'transparent',
              border: '1px dashed var(--rah-border-strong)',
              borderRadius: '12px',
              padding: '2px 8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-soft)';
              e.currentTarget.style.borderColor = 'var(--rah-border-stronger)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-muted)';
              e.currentTarget.style.borderColor = 'var(--rah-border-strong)';
            }}
          >
            +{hiddenCount} more
          </div>
        )}
        
        {/* Collapse button when expanded */}
        {isExpanded && shouldShowExpandButton && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(false);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: '11px',
              color: 'var(--rah-text-muted)',
              background: 'transparent',
              border: '1px dashed var(--rah-border-strong)',
              borderRadius: '12px',
              padding: '2px 8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-soft)';
              e.currentTarget.style.borderColor = 'var(--rah-border-stronger)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-muted)';
              e.currentTarget.style.borderColor = 'var(--rah-border-strong)';
            }}
          >
            show less
          </div>
        )}
        
        {/* Add dimension button */}
        {!disabled && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsAdding(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              fontSize: '14px',
              lineHeight: 1,
              color: 'var(--rah-text-muted)',
              background: 'transparent',
              border: '1px dashed var(--rah-border-strong)',
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'color 120ms ease, border-color 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-soft)';
              e.currentTarget.style.borderColor = 'var(--rah-border-stronger)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--rah-text-muted)';
              e.currentTarget.style.borderColor = 'var(--rah-border-strong)';
            }}
            title="Add dimension"
          >
            +
          </button>
        )}
      </div>

      {/* Dimension Search Modal */}
      <DimensionSearchModal
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        onDimensionSelect={(dim, description) => {
          addDimension(dim, description);
        }}
        existingDimensions={dimensions}
      />
    </div>
  );
}
