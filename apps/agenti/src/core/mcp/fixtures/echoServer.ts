//? A minimal stdio MCP server for the tests: two tools, and it echoes one env
//? var into a tool description so the test can see placeholders were expanded.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'echo', version: '1.0.0' });
const noArgs = async () => ({
  content: [{ type: 'text' as const, text: 'ok' }],
});
server.registerTool('echo', { description: `token=${process.env.ECHO_TOKEN ?? ''}` }, noArgs);
server.registerTool('ping', { description: 'pong' }, noArgs);

await server.connect(new StdioServerTransport());
