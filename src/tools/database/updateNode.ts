import { tool } from 'ai';
import { z } from 'zod';
import { getInternalApiBaseUrl } from '@/services/runtime/apiBase';

export const updateNodeTool = tool({
  description: 'Update node fields. Use this to enrich or correct nodes without losing canonical source content. Context is preserved unless context_id is supplied explicitly. When fixing a user-authored idea node, source should preserve the user\'s original wording as fully as possible. Never block an update because the description is incomplete. If the new description framing is materially inferred, complete the update and then invite one concise user feedback pass.',
  inputSchema: z.object({
    id: z.number().describe('The ID of the node to update'),
    updates: z.object({
      title: z.string().optional().describe('New title'),
      description: z.string().max(500).optional().describe('Optional natural description. Replace the whole field with one clean description when you are improving context. It should read like normal prose, not labels.'),
      source: z.string().optional().describe('Canonical source content for embedding. Use this to set or correct the raw source text. For user-authored ideas or dictated notes, preserve the user\'s original wording with only minimal cleanup rather than compressing it into a summary.'),
      link: z.string().optional().describe('New link'),
      event_date: z.string().optional().describe('When the thing actually happened (ISO 8601). Not when it was added to the graph.'),
      context_id: z.number().int().positive().nullable().optional().describe('Primary context ID. Omit to preserve the existing context. Use null only to clear it intentionally.'),
      metadata: z.record(z.any()).optional().describe('Metadata patch. It now merges with existing metadata instead of replacing the full blob. Use canonical keys: type, state, captured_method, captured_by, source_metadata.')
    }).describe('Object containing the fields to update. Derived analysis should be stored in a separate linked node, not appended to the source node.')
  }),
  execute: async ({ id, updates }) => {
    try {
      if (!updates || Object.keys(updates).length === 0) {
        return {
          success: false,
          error: 'updateNode requires at least one field in the updates object.',
          data: null
        };
      }

      // Call the nodes API endpoint
      const response = await fetch(`${getInternalApiBaseUrl()}/api/nodes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || 'Failed to update node',
          data: null
        };
      }

      return {
        success: true,
        data: result.node,
        message: `Updated node ID ${id}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update node',
        data: null
        };
    }
  }
});

// Legacy export for backwards compatibility
export const updateItemTool = updateNodeTool;
