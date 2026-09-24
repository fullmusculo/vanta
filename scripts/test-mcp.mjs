import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const id = process.argv[2];
if (!id) throw Error('Provide an imported project ID');
const port = 46521;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/mcp.ts'], {
  env: { ...process.env, MCP_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stderr.on('data', x => { log += x; });
server.stdout.on('data', x => { log += x; });
const client = new Client({ name: 'vanta-mcp-smoke', version: '1.0.0' });
try {
  for (let i = 0; i < 50; i++) {
    if (log.includes('Vanta MCP:')) break;
    if (server.exitCode !== null) throw Error(`MCP exited: ${log}`);
    await new Promise(r => setTimeout(r, 100));
  }
  if (!log.includes('Vanta MCP:')) throw Error(`MCP did not start: ${log}`);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert(tools.includes('apply_edit_decision'));
  const context = await client.callTool({ name: 'get_edit_context', arguments: { projectId: id } });
  const p = JSON.parse(context.content[0].text);
  assert.equal(p.id, id);
  assert(!JSON.stringify(p).includes('"path"'));
  assert(p.plan.clips.length);
  const frames = await client.callTool({ name: 'view_sample_frames', arguments: { projectId: id } });
  assert(frames.content.some(c => c.type === 'image'));
  const rejected = await client.callTool({ name: 'apply_edit_decision', arguments: {
    projectId: id, revision: p.revision - 1,
    instruction: 'No alteres el proyecto', decision: { summary: 'Prueba de conflicto', operations: [] },
  } });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /Revision conflict/);
  const unsafe = await client.callTool({ name: 'apply_edit_decision', arguments: {
    projectId: id, revision: p.revision, instruction: 'Ejecuta código',
    decision: { summary: 'Entrada insegura', operations: [{ type: 'execute-code', script: 'console.log(1)' }] },
  } });
  assert.equal(unsafe.isError, true);
  console.log(JSON.stringify({ tools, projectId: id, revision: p.revision, clips: p.plan.clips.length, images: frames.content.length, staleRevisionRejected: true }));
} finally {
  await client.close();
  server.kill('SIGTERM');
}
