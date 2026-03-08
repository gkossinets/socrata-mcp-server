import { fetchFromSocrataApi } from '../utils/api.js';

// Constants for Socrata API limits
export const MAX_ROWS = 50000; // Socrata per-request hard limit
export const DEFAULT_PREVIEW_ROWS = 1000; // Default preview size for large datasets
export const ROW_FETCH_CAP = parseInt(process.env.ROW_FETCH_CAP || '100000', 10); // Configurable cap for "all" requests
export const MAX_RAW_ROWS = parseInt(process.env.MAX_RAW_ROWS || '10000', 10); // Max rows for non-aggregation queries

// Detect whether a SoQL query uses aggregation (GROUP BY or aggregate functions)
const AGGREGATION_PATTERN = /\b(GROUP\s+BY|COUNT\s*\(|SUM\s*\(|AVG\s*\(|MIN\s*\(|MAX\s*\()\b/i;

function isAggregationQuery(soql: string): boolean {
  return AGGREGATION_PATTERN.test(soql);
}

// Parse the LIMIT value from a SoQL query string, returns undefined if no LIMIT clause
function parseSoqlLimit(soql: string): number | undefined {
  const match = soql.match(/\bLIMIT\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

// Replace or append a LIMIT clause in a SoQL query
function setSoqlLimit(soql: string, limit: number): string {
  if (/\bLIMIT\s+\d+/i.test(soql)) {
    return soql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${limit}`);
  }
  return `${soql.trimEnd()} LIMIT ${limit}`;
}

// Clamp a raw (non-aggregation) SoQL query's LIMIT to MAX_RAW_ROWS.
// Returns { query, clamped } where clamped is true if the limit was reduced or added.
function clampRawQueryLimit(soql: string): { query: string; clamped: boolean; originalLimit?: number } {
  if (isAggregationQuery(soql)) {
    return { query: soql, clamped: false };
  }

  const existingLimit = parseSoqlLimit(soql);

  if (existingLimit === undefined) {
    // No LIMIT on a raw query — add safety default
    return { query: setSoqlLimit(soql, MAX_RAW_ROWS), clamped: true };
  }

  if (existingLimit > MAX_RAW_ROWS) {
    return { query: setSoqlLimit(soql, MAX_RAW_ROWS), clamped: true, originalLimit: existingLimit };
  }

  return { query: soql, clamped: false };
}

// Response type with metadata
export interface SearchResponse {
  data: any[];
  is_sample: boolean;
  returned_rows: number;
  total_rows: number;
  has_more?: boolean;
  next_offset?: number;
}

// Helper function to get total row count for a dataset
export async function getRowCount(params: {
  datasetId: string;
  domain: string;
  where?: string;
  q?: string;
}): Promise<number> {
  const { datasetId, domain, where, q } = params;
  
  const apiParams: Record<string, unknown> = {
    $select: 'count(*)',
    $limit: 1
  };
  
  if (where) apiParams.$where = where;
  if (q) apiParams.$q = q;
  
  const baseUrl = `https://${domain}`;
  const response = await fetchFromSocrataApi<Array<{ count: string }>>(
    `/resource/${datasetId}.json`,
    apiParams,
    baseUrl
  );
  
  return parseInt(response[0]?.count || '0', 10);
}

// Enhanced search handler with pagination and metadata
export async function handleSearch(params: {
  datasetId: string;
  domain: string;
  soqlQuery?: string;
  limit?: number | 'all';
  offset?: number;
  select?: string;
  where?: string;
  order?: string;
  group?: string;
  having?: string;
  q?: string;
}): Promise<SearchResponse> {
  const {
    datasetId,
    domain,
    soqlQuery,
    limit,
    offset = 0,
    select,
    where,
    order,
    group,
    having,
    q
  } = params;

  // If a full SoQL query is provided, we can't easily determine row count
  // So we'll fetch with the query and check results
  if (soqlQuery && soqlQuery.trim().length > 0) {
    // Clamp raw (non-aggregation) queries to MAX_RAW_ROWS
    const { query: clampedQuery, clamped, originalLimit } = clampRawQueryLimit(soqlQuery);

    const apiParams: Record<string, unknown> = {
      $query: clampedQuery
    };

    const baseUrl = `https://${domain}`;
    const data = await fetchFromSocrataApi<Record<string, unknown>[]>(
      `/resource/${datasetId}.json`,
      apiParams,
      baseUrl
    );

    const result: SearchResponse = {
      data,
      is_sample: false,
      returned_rows: data.length,
      total_rows: data.length, // Can't determine total with custom query
      has_more: data.length === MAX_ROWS // Might have more if we hit the limit
    };

    if (clamped) {
      (result as any).limit_note = originalLimit
        ? `Results limited to ${MAX_RAW_ROWS.toLocaleString()} rows (requested ${originalLimit.toLocaleString()}). Use aggregation (GROUP BY) to analyze the full dataset.`
        : `Results limited to ${MAX_RAW_ROWS.toLocaleString()} rows (safety default). Use aggregation (GROUP BY) to analyze the full dataset, or add an explicit LIMIT if you need fewer rows.`;
    }

    return result;
  }

  // Get total row count first
  const totalRows = await getRowCount({ datasetId, domain, where, q });
  
  // Determine fetch strategy
  const requestAll = limit === 'all';
  const userLimit = typeof limit === 'number' ? limit : undefined;
  
  // Case 1: Small dataset or specific limit within MAX_ROWS
  if (totalRows <= MAX_ROWS && (!requestAll && (userLimit ?? totalRows) <= MAX_ROWS)) {
    const apiParams: Record<string, unknown> = {
      $limit: userLimit ?? totalRows,
      $offset: offset
    };
    
    if (select) apiParams.$select = select;
    if (where) apiParams.$where = where;
    if (order) apiParams.$order = order;
    if (group) apiParams.$group = group;
    if (having) apiParams.$having = having;
    if (q) apiParams.$q = q;
    
    const baseUrl = `https://${domain}`;
    const data = await fetchFromSocrataApi<Record<string, unknown>[]>(
      `/resource/${datasetId}.json`,
      apiParams,
      baseUrl
    );
    
    return {
      data,
      is_sample: false,
      returned_rows: data.length,
      total_rows: totalRows
    };
  }
  
  // Case 2: User explicitly requested "all" data
  if (requestAll) {
    const allData: Record<string, unknown>[] = [];
    let currentOffset = offset;
    const maxToFetch = Math.min(totalRows, ROW_FETCH_CAP);
    
    while (allData.length < maxToFetch && currentOffset < totalRows) {
      const batchSize = Math.min(MAX_ROWS, maxToFetch - allData.length);
      const apiParams: Record<string, unknown> = {
        $limit: batchSize,
        $offset: currentOffset
      };
      
      if (select) apiParams.$select = select;
      if (where) apiParams.$where = where;
      if (order) apiParams.$order = order;
      if (group) apiParams.$group = group;
      if (having) apiParams.$having = having;
      if (q) apiParams.$q = q;
      
      const baseUrl = `https://${domain}`;
      const batch = await fetchFromSocrataApi<Record<string, unknown>[]>(
        `/resource/${datasetId}.json`,
        apiParams,
        baseUrl
      );
      
      if (batch.length === 0) break; // No more data
      
      allData.push(...batch);
      currentOffset += batch.length;
    }
    
    const hasMore = totalRows > ROW_FETCH_CAP;
    
    return {
      data: allData,
      is_sample: false,
      returned_rows: allData.length,
      total_rows: totalRows,
      has_more: hasMore,
      next_offset: hasMore ? currentOffset : undefined
    };
  }
  
  // Case 3: Large dataset, no explicit "all" - return preview
  const previewLimit = userLimit ?? DEFAULT_PREVIEW_ROWS;
  const apiParams: Record<string, unknown> = {
    $limit: Math.min(previewLimit, MAX_ROWS),
    $offset: offset
  };
  
  if (select) apiParams.$select = select;
  if (where) apiParams.$where = where;
  if (order) apiParams.$order = order;
  if (group) apiParams.$group = group;
  if (having) apiParams.$having = having;
  if (q) apiParams.$q = q;
  
  const baseUrl = `https://${domain}`;
  const data = await fetchFromSocrataApi<Record<string, unknown>[]>(
    `/resource/${datasetId}.json`,
    apiParams,
    baseUrl
  );
  
  return {
    data,
    is_sample: true,
    returned_rows: data.length,
    total_rows: totalRows,
    has_more: offset + data.length < totalRows,
    next_offset: offset + data.length < totalRows ? offset + data.length : undefined
  };
}