import type { WelinkAuthState } from './welink-auth';

const record = (value: unknown) => (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const accountDigits = (value: string) => /^[a-z]?(\d{4,})$/i.exec(value)?.[1].replace(/^0+/, '');
const identifiers = (row: Record<string, unknown>) =>
  ['welinkId', 'w3Account', 'personAccount', 'loginName', 'account', 'uid'].map(key => text(row[key]).toLowerCase());

function employeeNumber(row: Record<string, unknown>): string {
  for (const value of [row.employeeNumber, row.workId]) {
    const number = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
    if (/^\d{1,20}$/.test(number)) return number;
  }
  return '';
}

function directoryRows(value: unknown) {
  const root = record(value), data = record(root.data);
  return [value, root.data, root.users, data.users, record(root.search_cli_person).data]
    .flatMap(value => Array.isArray(value) ? value.map(record) : []);
}

export class WelinkEmployeeLookup {
  private cache?: { uid: string; until: number; result: Promise<string | undefined> };

  constructor(private readonly run: (args: string[]) => Promise<string>,
    private readonly check: () => Promise<WelinkAuthState>, private readonly now = Date.now) {}

  read(uid: string): Promise<string | undefined> {
    uid = uid.toLowerCase();
    if (this.cache?.uid === uid && this.cache.until > this.now()) return this.cache.result;
    const result = this.lookup(uid).catch(() => undefined);
    this.cache = { uid, until: this.now() + 5 * 60_000, result };
    return result;
  }

  private async lookup(uid: string) {
    const request = async (args: string[]): Promise<unknown> => {
      try {
        const output = (await this.run(args)).trim();
        const json = output.search(/^[ \t]*[{\[]/m);
        return json === -1 ? undefined : JSON.parse(output.slice(json));
      } catch { return undefined; }
    };
    const profile = record(await request(['onebox', 'user-info'])), data = record(profile.data);
    const boxes = [profile, data, record(profile.user), record(data.user)];
    const loginName = boxes
      .flatMap(row => ['loginName', 'w3Account', 'account'].map(key => text(row[key])))
      .find(value => /^[a-z0-9][\w.-]{1,39}$/i.test(value));
    const knownDigits = accountDigits(uid);
    const account = loginName && (boxes.some(row => identifiers(row).includes(uid)) ||
      knownDigits && accountDigits(loginName) === knownDigits) ? loginName : uid;
    const ownAccount = account.toLowerCase();
    const findNumber = (value: unknown) => {
      const rows = directoryRows(value);
      const exact = rows.filter(row => identifiers(row).some(id => id === uid || id === ownAccount));
      const matches = exact.length ? exact : rows.filter(row => knownDigits && employeeNumber(row).replace(/^0+/, '') === knownDigits);
      const numbers = [...new Set(matches.map(employeeNumber).filter(Boolean))];
      return numbers.length === 1 ? numbers[0] : undefined;
    };
    const number = findNumber(await request(['search', 'person', '--text', account]))
      ?? findNumber(await request(['contact', 'detail', account]));
    if (!number) return;
    const current = await this.check();
    if (current.authenticated && current.uid?.toLowerCase() === uid) return number;
  }
}
