/**
 * Mock connector (PR005) — the only IMPLEMENTED adapter.
 *
 * Resolve it through `getConnector(ConnectorPlatform.MOCK)`; the direct
 * export exists for the seed and the tests, which need the raw dataset.
 */
export {
  MockConnector,
  MOCK_EXTERNAL_CONTENT,
  MOCK_CONTENT_SEED,
  MOCK_CONTENT_COUNT,
  MOCK_UNIQUE_CONTENT_COUNT,
  MOCK_DUPLICATE_CONTENT_COUNT,
  MOCK_TYPE_DISTRIBUTION,
} from "./mock.connector";
