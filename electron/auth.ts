 /**
 * W3 账号凭据存储(主进程)。
 *
 * 默认不强制登录,应用开箱即用;用户在设置页可选填 W3 工号/密码,
 * 供后续内网功能(如 SSO 接口调用)使用。
 *
 * 密码经 Electron safeStorage 加密(Windows 下为 DPAPI,与当前系统用户绑定),
 * 存 userData/auth/credentials.enc;工号明文存 userData/auth/w3uid(仅作展示回显)。
 */
 import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
 import { join } from 'node:path';
 import { safeStorage } from 'electron';

 export class AuthStore {
   private readonly credFile: string;
   private readonly uidFile: string;

   constructor(userDataDir: string) {
     this.credFile = join(userDataDir, 'auth', 'credentials.enc');
     this.uidFile = join(userDataDir, 'auth', 'w3uid');
   }

   /** 保存 W3 凭据:密码加密落盘,工号明文落盘(用于设置页回显) */
   saveCredentials(uid: string, password: string): void {
     if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用,无法安全保存密码');
     const dir = join(this.credFile, '..');
     if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
     writeFileSync(this.credFile, safeStorage.encryptString(password));
     writeFileSync(this.uidFile, uid, 'utf8');
   }

   /** 是否已保存凭据 */
   hasCredentials(): boolean {
     return existsSync(this.credFile);
   }

   /** 读取工号(设置页回显用,不含密码) */
   getUid(): string {
     try {
       if (!existsSync(this.uidFile)) return '';
       return readFileSync(this.uidFile, 'utf8');
     } catch { return ''; }
   }

   /** 读取密码(供后续内网功能使用;调用方需自行保证最小化使用) */
   getPassword(): string | null {
     try {
       if (!existsSync(this.credFile)) return null;
       return safeStorage.decryptString(readFileSync(this.credFile));
     } catch { return null; }
   }

   /** 清除已保存的凭据 */
   clearCredentials(): void {
     try { if (existsSync(this.credFile)) unlinkSync(this.credFile); } catch { /* ignore */ }
     try { if (existsSync(this.uidFile)) unlinkSync(this.uidFile); } catch { /* ignore */ }
   }
 }
