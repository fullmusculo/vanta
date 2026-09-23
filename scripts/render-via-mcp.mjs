import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const id = process.argv[2];
if (!id) throw Error('Usage: DATA_DIR=... node scripts/render-via-mcp.mjs projectId');
const port = 46523;
const env = { ...process.env, MCP_PORT: String(port) };
const server = spawn(process.execPath, ['--import', 'tsx', 'server/mcp.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stderr.on('data', x => { log += x; });
server.stdout.on('data', x => { log += x; });
const worker = spawn(process.execPath, ['--import', 'tsx', 'server/worker.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
worker.stderr.on('data', x => { process.stderr.write(x); });
worker.stdout.on('data', x => { process.stdout.write(x); });
const client = new Client({ name: 'vanta-render-cli', version: '1.0.0' });
try {
  for (let i = 0; i < 60 && !log.includes('Vanta MCP:'); i++) {
    if (server.exitCode !== null) throw Error(log);
    await new Promise(r => setTimeout(r, 100));
  }
  if (!log.includes('Vanta MCP:')) throw Error(`MCP did not start: ${log}`);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const context = await client.callTool({ name: 'get_edit_context', arguments: { projectId: id } });
  const revision = JSON.parse(context.content[0].text).revision;
  const queued = await client.callTool({ name: 'queue_render', arguments: { projectId: id, revision } });
  if (queued.isError) throw Error(queued.content[0].text);
  const jobId = JSON.parse(queued.content[0].text).jobId;
  console.log(JSON.stringify({ jobId, revision }));
  for (let i = 0; i < 600; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const response = await client.callTool({ name: 'get_render_status', arguments: { projectId: id, jobId } });
    if (response.isError) throw Error(response.content[0].text);
    const state = JSON.parse(response.content[0].text);
    if (i % 10 === 0 || state.job.status !== 'running') console.log(JSON.stringify(state));
    if (state.job.status === 'completed') break;
    if (state.job.status === 'failed') throw Error(state.job.error);
    if (i === 599) throw Error('Render exceeded 30 minutes; job remains in database');
  }
} finally {
  await client.close();
  server.kill('SIGTERM');
  worker.kill('SIGTERM');
  if (worker.exitCode === null) await Promise.race([
    new Promise(resolve => worker.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]);
}
