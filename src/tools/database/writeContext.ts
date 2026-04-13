import { tool } from 'ai';
import { z } from 'zod';
import { getInternalApiBaseUrl } from '@/services/runtime/apiBase';
import { formatNodeForChat } from '../infrastructure/nodeFormatter';

export const writeContextTool = tool({
  description: 'Write one atomic durable context node to the graph only after the user has explicitly approved the save. Use this sparingly for unusually valuable context. Never call it unless the user has clearly said yes.',
  inputSchema: z.object({
    title: z.string().min(1).max(160).describe('Clear proposed node title.'),
    description: z.string().min(1).max(500).describe('Natural description of what this context is and why it matters.'),
    source: z.string().optional().describe('Optional source or verbatim user wording to preserve.'),
    context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID.'),
    metadata: z.record(z.any()).optional().describe('Optional metadata patch.'),
    confirmed_by_user: z.boolean().describe('Must be true. Reject the write otherwise.'),
  }),
  execute: async ({ title, description, source, context_id, metadata, confirmed_by_user }) => {
    if (!confirmed_by_user) {
      return {
        success: false,
        error: 'writeContext requires explicit user confirmation before writing to the graph.',
        data: null,
      };
    }

    try {
      const response = await fetch(`${getInternalApiBaseUrl()}/api/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          source: source?.trim() || undefined,
          context_id: context_id ?? null,
          metadata: {
            captured_by: 'human',
            captured_method: 'write_context',
            ...(metadata || {}),
          },
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        return {
          success: false,
          error: result.error || 'Failed to write context node',
          data: null,
        };
      }

      const formattedDisplay = formatNodeForChat({
        id: result.data.id,
        title: result.data.title,
      });

      return {
        success: true,
        data: {
          ...result.data,
          formatted_display: formattedDisplay,
        },
        message: `Saved context as ${formattedDisplay}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write context node',
        data: null,
      };
    }
  },
});
