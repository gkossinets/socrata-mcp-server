import { describe, test, expect } from 'vitest';
import axios from 'axios';
import { fetchFromSocrataApi, ColumnInfo } from '../utils/api.js';

const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;

// Known stable dataset: NYC 311 Service Requests
const NYC_DOMAIN = 'data.cityofnewyork.us';
const NYC_BASE_URL = `https://${NYC_DOMAIN}`;
const KNOWN_DATASET_ID = 'erm2-nwe9'; // 311 Service Requests

// Direct SODA2 GET helper — avoids the SODA3 POST path in fetchFromSocrataApi
// which requires an app token for unauthenticated requests.
async function queryDataset(datasetId: string, params: Record<string, unknown> = {}, baseUrl = NYC_BASE_URL) {
  const url = `${baseUrl}/resource/${datasetId}.json`;
  const response = await axios.get(url, { params });
  return response.data;
}

describe.skipIf(!RUN_INTEGRATION)('Integration Tests (live Socrata API)', () => {

  test('catalog search returns results for a known query', async () => {
    const response = await fetchFromSocrataApi<{ results: any[] }>(
      '/api/catalog/v1',
      { q: '311', limit: 5, search_context: NYC_DOMAIN },
      NYC_BASE_URL
    );

    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);

    const first = response.results[0];
    expect(first.resource).toBeDefined();
    expect(first.resource.id).toBeDefined();
    expect(first.resource.name).toBeDefined();
  }, 15000);

  test('metadata fetch returns expected fields for known dataset', async () => {
    const metadata = await fetchFromSocrataApi<Record<string, any>>(
      `/api/views/${KNOWN_DATASET_ID}`,
      {},
      NYC_BASE_URL
    );

    expect(metadata.id).toBe(KNOWN_DATASET_ID);
    expect(metadata.name).toBeDefined();
    expect(typeof metadata.name).toBe('string');
    expect(metadata.columns).toBeDefined();
    expect(Array.isArray(metadata.columns)).toBe(true);
  }, 15000);

  test('column info returns columns for known dataset', async () => {
    const columns = await fetchFromSocrataApi<ColumnInfo[]>(
      `/api/views/${KNOWN_DATASET_ID}/columns`,
      {},
      NYC_BASE_URL
    );

    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);

    const col = columns[0];
    expect(col.fieldName).toBeDefined();
    expect(col.dataTypeName).toBeDefined();
  }, 15000);

  test('SoQL query returns data rows', async () => {
    // Use a smaller dataset for reliable SODA2 GET performance.
    // NYC Wi-Fi Hotspot Locations (~4k rows) responds faster than 311 (~30M rows).
    const WIFI_HOTSPOTS = 'yjub-udmw';
    const data = await queryDataset(WIFI_HOTSPOTS, { $limit: 5 });

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(5);

    // Each row should have at least one key
    expect(Object.keys(data[0]).length).toBeGreaterThan(0);
  }, 15000);

  test('enriched search returns columns and preview rows', async () => {
    // Simulate the enriched search pattern: catalog search + parallel enrichment
    const catalogResponse = await fetchFromSocrataApi<{ results: any[] }>(
      '/api/catalog/v1',
      { q: '311 complaints', limit: 3, search_context: NYC_DOMAIN },
      NYC_BASE_URL
    );

    expect(catalogResponse.results.length).toBeGreaterThan(0);

    const firstDatasetId = catalogResponse.results[0].resource.id;

    // Fetch enrichment in parallel (same pattern as handleSearchTool)
    const [columns, previewRows] = await Promise.all([
      fetchFromSocrataApi<ColumnInfo[]>(
        `/api/views/${firstDatasetId}/columns`,
        {},
        NYC_BASE_URL
      ),
      queryDataset(firstDatasetId, { $limit: 5 })
    ]);

    // Columns
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0]).toHaveProperty('fieldName');
    expect(columns[0]).toHaveProperty('dataTypeName');

    // Preview rows
    expect(Array.isArray(previewRows)).toBe(true);
    expect(previewRows.length).toBeGreaterThan(0);
    expect(previewRows.length).toBeLessThanOrEqual(5);
  }, 30000);

  test('search for datasets on a different portal works', async () => {
    const chicagoDomain = 'data.cityofchicago.org';
    const response = await fetchFromSocrataApi<{ results: any[] }>(
      '/api/catalog/v1',
      { q: 'crime', limit: 3, search_context: chicagoDomain },
      `https://${chicagoDomain}`
    );

    expect(response.results).toBeDefined();
    expect(response.results.length).toBeGreaterThan(0);
  }, 15000);
});
