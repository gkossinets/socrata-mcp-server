# Socrata MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects AI tools to open data on any [Socrata](https://www.tylertech.com/products/socrata)-powered portal — including NYC, Chicago, San Francisco, and hundreds of other cities.

> **Formerly known as opengov-mcp-server.** Renamed to avoid confusion with OpenGov Inc.

## What it does

This server gives AI assistants (Claude, Copilot, Cursor) direct access to public datasets via Socrata's open data API. Instead of the AI guessing at data, it can query real civic data in real time.

**Example queries an AI can answer with this server:**
- "What are the top 311 complaint types in Brooklyn this month?"
- "Show me restaurant inspection trends in Manhattan"
- "Compare crime data across Chicago neighborhoods"

## Quick start

```bash
npm install
npm run build
npm run dev   # Starts on http://localhost:10000
```

### Environment variables

```bash
# .env
PORT=10000
DATA_PORTAL_URL=https://data.cityofnewyork.us  # Default portal (optional)
```

## Available tools

| Tool | Description |
|------|-------------|
| `get_data` | Unified data access: catalog search, metadata lookup, SoQL queries, and dataset metrics |
| `search` | Search for datasets or records, returns ID/score pairs |
| `fetch` | Retrieve full dataset metadata or records by ID |

## Supported portals

Works with any Socrata-powered open data portal. Some popular ones:

| City | Portal |
|------|--------|
| New York City | `data.cityofnewyork.us` |
| Chicago | `data.cityofchicago.org` |
| San Francisco | `data.sfgov.org` |
| Seattle | `data.seattle.gov` |
| Los Angeles | `data.lacity.org` |

## Transport

- **stdio** — For local use with Claude Code, Cursor, and VS Code Copilot
- **HTTP (Streamable HTTP)** — For web applications. Endpoint: `POST /mcp`

The deployed instance at `https://socrata-mcp-server.onrender.com` powers [civicaitools.org](https://civicaitools.org).

## Development

```bash
npm test          # Run tests
npm run build     # Build TypeScript
npm run dev       # Start dev server
npm run lint      # Lint
```

## Related projects

| Repository | Description |
|-----------|-------------|
| [civic-ai-tools](https://github.com/npstorey/civic-ai-tools) | Starter project that bundles this server with Data Commons MCP for multi-source civic data queries |
| [civic-ai-tools-website](https://github.com/npstorey/civic-ai-tools-website) | Demo website at [civicaitools.org](https://civicaitools.org) — side-by-side comparison of AI with and without live data |
| [odp-mcp](https://github.com/socrata/odp-mcp) | Socrata's official MCP server (similar functionality, different implementation) |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Disclaimer

This is a personal project and is not affiliated with, endorsed by, or representative of any employer or organization.

## License

MIT
