import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { agentProjectKey } from '../shared/agent-message-contracts';

export function isSystemProject(path: string): boolean {
  const root = process.env.SystemRoot || process.env.windir || (process.platform === 'win32' ? 'C:\\Windows' : '');
  if (!root) return false;
  const key = agentProjectKey(path), system = agentProjectKey(root);
  return key === system || key.startsWith(`${system}/`);
}

export function projectPathProblem(path: string): string {
  if (!path) return '路径未知，需手动填写';
  if (!isAbsolute(path)) return '仅支持本机项目的绝对路径';
  if (isSystemProject(path)) return '系统目录不能作为监听项目';
  try { return statSync(path).isDirectory() ? '' : '项目路径不是文件夹'; }
  catch (error) {
    return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? '项目目录已不存在' : '无法访问项目目录，请检查权限';
  }
}
