import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock modules before importing
vi.mock('axios');
vi.mock('../utils/api.js', () => ({
  fetchFromSocrataApi: vi.fn()
}));

import { handleSearchTool } from '../tools/socrata-tools.js';
import { fetchFromSocrataApi } from '../utils/api.js';

const mockedFetch = vi.mocked(fetchFromSocrataApi);

// Helper to build a catalog API response
function catalogResponse(datasets: { id: string; name: string; description?: string }[]) {
  return {
    results: datasets.map(d => ({
      resource: { id: d.id, name: d.name, description: d.description ?? '' }
    }))
  };
}

// Helper to build column metadata
function columnsResponse(cols: { fieldName: string; dataTypeName: string; description?: string; flags?: string[] }[]) {
  return cols.map(c => ({
    fieldName: c.fieldName,
    dataTypeName: c.dataTypeName,
    description: c.description,
    flags: c.flags
  }));
}

describe('Enriched Search (handleSearchTool)', () => {
  beforeEach(() => {
    process.env.DATA_PORTAL_URL = 'https://data.cityofnewyork.us';
    vi.clearAllMocks();
  });

  test('search results include columns and preview_rows when available', async () => {
    // Catalog search
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'abcd-1234', name: 'Test Dataset', description: 'A test dataset' }
    ]));

    // Columns for abcd-1234
    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'complaint_type', dataTypeName: 'text', description: 'Type of complaint' },
      { fieldName: 'created_date', dataTypeName: 'calendar_date' }
    ]));

    // Preview rows for abcd-1234
    mockedFetch.mockResolvedValueOnce([
      { complaint_type: 'Noise', created_date: '2025-01-01' },
      { complaint_type: 'Heat', created_date: '2025-01-02' }
    ]);

    const result = await handleSearchTool({ query: 'complaints' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results).toHaveLength(1);
    const r = payload.results[0];

    expect(r.id).toBe('dataset:data.cityofnewyork.us:abcd-1234');
    expect(r.title).toBe('Test Dataset');
    expect(r.columns).toEqual([
      { fieldName: 'complaint_type', dataTypeName: 'text', description: 'Type of complaint' },
      { fieldName: 'created_date', dataTypeName: 'calendar_date' }
    ]);
    expect(r.preview_rows).toEqual([
      { complaint_type: 'Noise', created_date: '2025-01-01' },
      { complaint_type: 'Heat', created_date: '2025-01-02' }
    ]);
  });

  test('failed enrichment for one result does not break others', async () => {
    // Catalog returns two datasets
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'good-1111', name: 'Good Dataset' },
      { id: 'bad0-2222', name: 'Bad Dataset' }
    ]));

    // good-1111 columns: success
    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'col_a', dataTypeName: 'number' }
    ]));
    // good-1111 preview: success
    mockedFetch.mockResolvedValueOnce([{ col_a: 42 }]);

    // bad0-2222 columns: failure
    mockedFetch.mockRejectedValueOnce(new Error('API error'));
    // bad0-2222 preview: failure
    mockedFetch.mockRejectedValueOnce(new Error('API error'));

    const result = await handleSearchTool({ query: 'test' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results).toHaveLength(2);

    // First result is enriched
    expect(payload.results[0].columns).toEqual([
      { fieldName: 'col_a', dataTypeName: 'number' }
    ]);
    expect(payload.results[0].preview_rows).toEqual([{ col_a: 42 }]);

    // Second result has no enrichment but is still present
    expect(payload.results[1].id).toBe('dataset:data.cityofnewyork.us:bad0-2222');
    expect(payload.results[1].title).toBe('Bad Dataset');
    expect(payload.results[1].columns).toBeUndefined();
    expect(payload.results[1].preview_rows).toBeUndefined();
  });

  test('preview rows are capped at 5', async () => {
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'many-rows', name: 'Many Rows' }
    ]));

    // Columns
    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'id', dataTypeName: 'number' }
    ]));

    // Preview returns more than 5 rows (shouldn't happen due to LIMIT, but test the cap)
    const manyRows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    mockedFetch.mockResolvedValueOnce(manyRows);

    const result = await handleSearchTool({ query: 'many' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results[0].preview_rows).toHaveLength(5);
  });

  test('hidden columns are filtered out', async () => {
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'hide-cols', name: 'Hidden Cols' }
    ]));

    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'visible_col', dataTypeName: 'text' },
      { fieldName: ':hidden_col', dataTypeName: 'text', flags: ['hidden'] }
    ]));

    mockedFetch.mockResolvedValueOnce([{ visible_col: 'hello' }]);

    const result = await handleSearchTool({ query: 'hide' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results[0].columns).toHaveLength(1);
    expect(payload.results[0].columns[0].fieldName).toBe('visible_col');
  });

  test('partial enrichment: columns succeed but preview fails', async () => {
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'part-enri', name: 'Partial' }
    ]));

    // Columns succeed
    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'name', dataTypeName: 'text' }
    ]));

    // Preview fails
    mockedFetch.mockRejectedValueOnce(new Error('Timeout'));

    const result = await handleSearchTool({ query: 'partial' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.results[0].columns).toBeDefined();
    expect(payload.results[0].preview_rows).toBeUndefined();
  });

  test('column descriptions are omitted when not present', async () => {
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'no-d-1234', name: 'No Desc Cols' }
    ]));

    mockedFetch.mockResolvedValueOnce(columnsResponse([
      { fieldName: 'amount', dataTypeName: 'number' }
    ]));

    mockedFetch.mockResolvedValueOnce([{ amount: 100 }]);

    const result = await handleSearchTool({ query: 'no desc' });
    const payload = JSON.parse(result.content[0].text);

    const col = payload.results[0].columns[0];
    expect(col.fieldName).toBe('amount');
    expect(col.dataTypeName).toBe('number');
    expect(col).not.toHaveProperty('description');
  });

  test('preview rows request uses LIMIT 5', async () => {
    mockedFetch.mockResolvedValueOnce(catalogResponse([
      { id: 'limi-t500', name: 'Limit Check' }
    ]));

    mockedFetch.mockResolvedValueOnce(columnsResponse([]));
    mockedFetch.mockResolvedValueOnce([]);

    await handleSearchTool({ query: 'limit check' });

    // Find the preview rows call (the one to /resource/)
    const previewCall = mockedFetch.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].startsWith('/resource/')
    );
    expect(previewCall).toBeDefined();
    expect(previewCall![1]).toEqual({ $limit: 5 });
  });
});
