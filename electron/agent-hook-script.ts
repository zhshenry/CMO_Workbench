// CodeAI(Claude Code)Stop hook 的落盘中继脚本生成器。
// 生成一段 node 脚本(非 PowerShell):读 stdin 的 Stop 事件 JSON,取 session_id/cwd/transcript_path,
// 写一条事件到 inbox 目录(时间戳+随机数命名,原子 rename)。不读 transcript 内容——后端 poll 时再读尾部取摘要。
// 脚本只需 node,不依赖工作台进程,打包版也能跑。
export function agentHookScript(inbox: string): string {
  // inbox 路径里的反斜杠在 JS 字符串字面量里要转义;单引号也要转义防截断。
  const escaped = inbox.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(raw);
    const sessionId = String(e.session_id || '');
    const cwd = String(e.cwd || '');
    const transcript = String(e.transcript_path || '');
    const turnId = String(e.turn_id || sessionId);
    if (!sessionId) { process.stdout.write('{}'); process.exit(0); }
    const record = {
      provider: 'codeai',
      sessionId: sessionId,
      turnId: turnId,
      kind: 'reply',
      requestKey: '',
      workspace: cwd,
      title: '',
      detail: '',
      occurredAt: Date.now(),
      transcriptPath: transcript,
    };
    const inbox = '${escaped}';
    fs.mkdirSync(inbox, { recursive: true });
    const name = String(Date.now()).padStart(13, '0') + '-' + crypto.randomBytes(8).toString('hex') + '.json';
    const file = path.join(inbox, name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(record));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    process.stderr.write('CodeAI island relay could not save this event: ' + (err && err.message || err) + '\\n');
  }
  process.stdout.write('{}');
  process.exit(0);
});
`;
}
