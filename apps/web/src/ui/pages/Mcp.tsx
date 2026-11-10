import { Table } from "../components.js";

const TOOLS = [
  {
    name: "getDatasetInfo",
    input: "{}",
    output: "{ runId, rootCid, manifestCid, tablesCid?, counts, limitations, syncedAt, source }",
  },
  {
    name: "getSchema",
    input: "{}",
    output: "{ tables: [{ name, columns: [{ name, type }] }], source }",
  },
  {
    name: "queryDataset",
    input: "{ sql: string, limit?: number <= 1000 }",
    output: "{ columns, rows, rowCount, truncated, source }",
  },
  {
    name: "findProperties",
    input:
      "{ lat, lon, radiusMiles, minRoofAge?, openRoofingPermitsOnly?, minOpenDays?, limit? <= 500 }",
    output:
      "{ properties: [property + distance_miles + permits: [permit + contractor?]], total_in_radius, source }",
  },
  {
    name: "getProperty",
    input: "{ pin14: string (14 digits) }",
    output: "{ property: (property + permits) | null, source }",
  },
];

const origin = typeof window === "undefined" ? "" : window.location.origin;
const init = `curl -s ${origin}/mcp -H "Authorization: Bearer $MCP_HTTP_AUTH_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`;
const list = `curl -s ${origin}/mcp -H "Authorization: Bearer $MCP_HTTP_AUTH_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`;
const call = `curl -s ${origin}/mcp -H "Authorization: Bearer $MCP_HTTP_AUTH_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"findProperties","arguments":{"lat":42.0451,"lon":-87.6877,"radiusMiles":2,"minRoofAge":15,"openRoofingPermitsOnly":true,"limit":5}}}'`;

export function Mcp() {
  return (
    <>
      <h1>MCP server</h1>
      <p>
        Streamable HTTP endpoint: <code data-testid="mcp-endpoint">POST {origin}/mcp</code>.
        Stateless (no session id). Every tool response carries a <code>source</code> block{" "}
        <code>{"{ runId, rootCid, manifestCid, tablesCid?, syncedAt }"}</code> so the CRM can pin
        answers to a CID-addressed snapshot. Tools read only the published query tables, never raw
        staging data.
      </p>
      <p className="banner" data-testid="mcp-auth-note">
        Authentication: send <code>Authorization: Bearer &lt;MCP_HTTP_AUTH_TOKEN&gt;</code>. The
        token is configured on the server (<code>.env</code>) and shared out of band with the CRM;
        requests without it get 401.
      </p>
      <h2>Tools</h2>
      <Table
        testId="mcp-tools"
        rows={TOOLS}
        columns={[{ key: "name" }, { key: "input", wrap: true }, { key: "output", wrap: true }]}
      />
      <p className="muted" data-testid="mcp-bbb-note">
        BBB wording for <code>contractor</code> rows: <code>bbb_state=stale</code> → "BBB A+
        (archived copy, &lt;bbb_checked_at date&gt;)", <code>unavailable</code> → "BBB: not
        available (&lt;bbb_reason&gt;)", <code>unknown</code> → "BBB: unknown (not checked)".
      </p>
      <h2>Example calls (curl)</h2>
      <pre>{init}</pre>
      <pre>{list}</pre>
      <pre>{call}</pre>
      <h2>MCP Inspector</h2>
      <pre>{`npx @modelcontextprotocol/inspector --transport http --server-url ${origin}/mcp --header "Authorization: Bearer $MCP_HTTP_AUTH_TOKEN"`}</pre>
      <h2>Claude Desktop / CRM client config</h2>
      <pre>
        {JSON.stringify(
          {
            mcpServers: {
              "cook-il": {
                type: "streamable-http",
                url: `${origin}/mcp`,
                headers: { Authorization: "Bearer <MCP_HTTP_AUTH_TOKEN>" },
              },
            },
          },
          null,
          2,
        )}
      </pre>
    </>
  );
}
