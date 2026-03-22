import { tool } from 'ai';
import { z } from 'zod';
import { getInternalApiBaseUrl } from '@/services/runtime/apiBase';

export const queryDimensionsTool = tool({
  description: 'List the existing canonical dimensions with node counts. Use this before assigning dimensions to nodes. Do not invent new dimensions without explicit user instruction.',
  inputSchema: z.object({
    filters: z.object({
      search: z.string().describe('Search term to match against dimension names').optional(),
      limit: z.number().min(1).max(100).default(50).describe('Maximum number of results to return')
    }).optional()
  }),
  execute: async ({ filters = {} }) => {
    console.log('📁 QueryDimensions tool called with filters:', JSON.stringify(filters, null, 2));
    try {
      const limit = filters.limit || 50;
      const baseUrl = getInternalApiBaseUrl();

      // Use existing API endpoint for dimension listing
      const response = await fetch(`${baseUrl}/api/dimensions/popular`);

      if (!response.ok) {
        let errorMessage = 'Failed to query dimensions';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || errorMessage;
        } catch {
          errorMessage = `Failed to query dimensions: ${response.status} ${response.statusText}`;
        }
        return {
          success: false,
          error: errorMessage,
          data: { dimensions: [], count: 0 }
        };
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        return {
          success: false,
          error: 'Invalid response from dimensions API',
          data: { dimensions: [], count: 0 }
        };
      }

      // Apply filters
      let dimensions = result.data as Array<{
        dimension: string;
        count: number;
        description: string | null;
      }>;

      // Filter by search term
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        dimensions = dimensions.filter(d =>
          d.dimension.toLowerCase().includes(searchLower)
        );
      }

      // Apply limit
      const limitedDimensions = dimensions.slice(0, limit);

      // Format for display
      const formattedDimensions = limitedDimensions.map(d => ({
        name: d.dimension,
        count: d.count,
        description: d.description
      }));

      // Build message
      const filterParts: string[] = [];
      if (filters.search) filterParts.push(`matching "${filters.search}"`);
      const filterDesc = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

      const dimensionList = formattedDimensions
        .map(d => `• ${d.name} (${d.count} nodes)${d.description ? ` - ${d.description}` : ''}`)
        .join('\n');

      return {
        success: true,
        data: {
          dimensions: formattedDimensions,
          count: formattedDimensions.length,
          total_available: dimensions.length,
          filters_applied: filters
        },
        message: `Found ${formattedDimensions.length} dimensions${filterDesc}:\n${dimensionList || 'No dimensions found'}`
      };
    } catch (error) {
      console.error('QueryDimensions tool error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to query dimensions',
        data: { dimensions: [], count: 0 }
      };
    }
  }
});
