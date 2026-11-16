import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 构建机使用 Windows 自带的 .NET Framework 编译器；目标电脑只运行随包附带的助手。
export function buildCodeaiNavigation() {
  if (process.platform !== 'win32') return;
  const framework = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const compiler = join(framework, 'csc.exe');
  if (!existsSync(compiler)) throw new Error('构建 CodeAI 导航助手需要 Windows .NET Framework 编译器');
  mkdirSync('dist-electron', { recursive: true });
  mkdirSync('artifacts/native-build', { recursive: true });
  const generator = resolve('artifacts/native-build/uia-interop.exe');
  execFileSync(compiler, ['/nologo', `/out:${generator}`, resolve('tooling/native-uia-interop.cs')], { windowsHide: true, stdio: 'pipe' });
  execFileSync(generator, [resolve('dist-electron/Interop.UIAutomationClient.dll')], { windowsHide: true, stdio: 'pipe' });
  execFileSync(compiler, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output',
    `/out:${resolve('dist-electron/codeai-navigation.exe')}`,
    `/reference:${resolve('dist-electron/Interop.UIAutomationClient.dll')}`,
    '/reference:System.Web.Extensions.dll', resolve('electron/native/codeai-navigation.cs'),
  ], { windowsHide: true, stdio: 'pipe' });
}
