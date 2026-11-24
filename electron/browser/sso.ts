import type { WebContents } from 'electron';

export const HUAWEI_SSO_ORIGIN = 'https://login.huawei.com';
const ssoWorld = 1001;

export function isHuaweiSsoUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.origin === HUAWEI_SSO_ORIGIN && !url.username && !url.password;
}

/** The isolated world binds approval to this document and the exact login form. It returns no field values. */
export async function huaweiSsoForm(guest: WebContents, requestId: string, submit = false): Promise<boolean> {
  if (guest.isDestroyed() || !isHuaweiSsoUrl(guest.getURL()) || guest.isLoadingMainFrame()) return false;
  const expiresAt = Date.now() + 10000;
  const code = String.raw`(() => {
    if (location.origin !== ${JSON.stringify(HUAWEI_SSO_ORIGIN)} || self !== top) return false;
    const requestId = ${JSON.stringify(requestId)};
    const submit = ${submit};
    const approval = globalThis.cmoSsoApproval;
    if (submit) delete globalThis.cmoSsoApproval;
    const username = document.getElementById('username');
    const form = username instanceof HTMLInputElement && username.type !== 'password' && username.form;
    if (!form || form.matches(':invalid')) return false;
    const usable = element => !element.matches(':disabled, [aria-disabled="true"]') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
    const controls = Array.from(form.elements);
    const passwords = controls.filter(element => element instanceof HTMLInputElement && element.type === 'password' && usable(element));
    const buttons = controls.filter(element => (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.type === 'submit' && usable(element) &&
      /^(登录|login|signin)$/i.test((element.getAttribute('aria-label') ?? (element instanceof HTMLInputElement ? element.value : element.textContent || '')).replace(/\s/g, '')));
    const [password] = passwords;
    const [button] = buttons;
    if (passwords.length !== 1 || buttons.length !== 1 || !usable(username) || !username.value.trim() || !password.value) return false;
    const method = button.getAttribute('formmethod') ?? form.method;
    const target = button.getAttribute('formtarget') ?? form.target;
    const action = new URL(button.getAttribute('formaction') ?? form.action, location.href);
    if (method.toLowerCase() !== 'post' || (target && target.toLowerCase() !== '_self') ||
        action.origin !== location.origin || action.username || action.password) return false;
    if (submit) {
      if (Date.now() >= ${expiresAt} || approval?.requestId !== requestId || approval.page !== location.href || approval.action !== action.href || approval.form !== form ||
          approval.username !== username || approval.password !== password || approval.button !== button) return false;
      button.click();
    } else {
      globalThis.cmoSsoApproval = { requestId, page: location.href, action: action.href, form, username, password, button };
    }
    return true;
  })()`;
  return await guest.executeJavaScriptInIsolatedWorld(ssoWorld, [{ code }]) === true;
}

export async function huaweiSsoReturnReady(guest: WebContents, target: URL): Promise<boolean> {
  if (guest.isDestroyed() || guest.isLoadingMainFrame() || !URL.canParse(guest.getURL())) return false;
  const current = new URL(guest.getURL());
  if (current.origin !== target.origin || current.pathname !== target.pathname || current.hash !== target.hash ||
      (target.search && current.search !== target.search)) return false;
  const code = `location.href === ${JSON.stringify(current.href)} && document.readyState === 'complete' && !!document.body`;
  return await guest.executeJavaScriptInIsolatedWorld(ssoWorld, [{ code }]) === true &&
    !guest.isDestroyed() && !guest.isLoadingMainFrame() && guest.getURL() === current.href;
}
