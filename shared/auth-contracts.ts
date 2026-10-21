 /** W3 账号凭据契约(可选保存,供后续内网功能使用;应用默认不强制登录) */

 /** WorkbenchApi.auth 子接口 */
 export interface AuthApi {
   /** 保存 W3 账号凭据(密码经 Electron safeStorage 加密存本机) */
   saveCredentials(credentials: { uid: string; password: string }): Promise<void>;
   /** 查询是否已保存凭据(不回传密码) */
   hasCredentials(): Promise<boolean>;
   /** 清除已保存的凭据 */
   clearCredentials(): Promise<void>;
   logout(): Promise<void>;
 }
