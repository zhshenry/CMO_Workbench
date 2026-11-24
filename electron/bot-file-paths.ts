import { isAbsolute, win32 } from 'node:path';

/** Reject Windows path aliases as well as literal traversal before resolving a scoped path. */
export function botFileParts(input: string): string[] {
  const parts = input.replaceAll('\\', '/').split('/');
  if (!input || isAbsolute(input) || win32.isAbsolute(input) || parts.some(part => !part || part === '.' || part === '..'
    || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error('请使用目录内的普通相对路径，不能包含越界或 Windows 特殊文件名');
  }
  return parts;
}
