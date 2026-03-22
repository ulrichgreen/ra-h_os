import { tool } from 'ai';
import { z } from 'zod';
import { getInternalApiBaseUrl } from '@/services/runtime/apiBase';

export const createDimensionTool = tool({
  description: 'Create a new dimension only when the user explicitly instructs you to do so. Always provide a description explaining what belongs in this category.',
  inputSchema: z.object({
    name: z.string().describe('Dimension name'),
    description: z.string().min(1).max(500).describe('Dimension description explaining what content belongs in this dimension (required, max 500 characters)')
  }),
  execute: async (params) => {
    console.log('📁 CreateDimension tool called with params:', JSON.stringify(params, null, 2));
    try {
      const trimmedName = params.name.trim();
      if (!trimmedName) {
        return {
          success: false,
          error: 'Dimension name is required',
          data: null
        };
      }

      // Call POST /api/dimensions
      const response = await fetch(`${getInternalApiBaseUrl()}/api/dimensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: params.description.trim()
        })
      });

      if (!response.ok) {
        let errorMessage = 'Failed to create dimension';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || errorMessage;
        } catch {
          // If response is not JSON (e.g., HTML error page), use status text
          errorMessage = `Failed to create dimension: ${response.status} ${response.statusText}`;
        }
        return {
          success: false,
          error: errorMessage,
          data: null
        };
      }

      const result = await response.json();

      return {
        success: true,
        data: result.data,
        message: `Created dimension "${trimmedName}"${params.description ? ' with description' : ''}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create dimension',
        data: null
      };
    }
  }
});
