/** Send a locally prepared editorial decision through the same MCP contract ChatGPT uses. */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const file = process.argv[2];
if (!file) throw Error('Usage: DATA_DIR=... node scripts/apply-mcp-decision.mjs decision.json');
const request = JSON.parse(await readFile(file, 'utf8'));
const port = 46522;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/mcp.ts'], {
  env: { ...process.env, MCP_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stderr.on('data', x => { log += x; });
server.stdout.on('data', x => { log += x; });
const client = new Client({ name: 'vanta-editor-cli', version: '1.0.0' });
try {
  for (let i = 0; i < 60 && !log.includes('Vanta MCP:'); i++) {
    if (server.exitCode !== null) throw Error(log);
    await new Promise(r => setTimeout(r, 100));
  }
  if (!log.includes('Vanta MCP:')) throw Error(`MCP did not start: ${log}`);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const res = await client.callTool({ name: 'apply_edit_decision', arguments: request });
  if (res.isError) throw Error(res.content[0].text);
  console.log(res.content[0].text);
} finally {
  await client.close();
  server.kill('SIGTERM');
}
