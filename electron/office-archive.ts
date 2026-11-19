import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OfficeMaterial, OfficeSearch } from '../shared/office-workbench';
import { dayMillis, nextDay } from '../shared/welink-agenda';

export type ArchivedMaterial = OfficeMaterial & { conversation?: string; mailId?: string };

/** The archive is separate from current mail, reminders, and the shared todo database. */
export class OfficeArchive {
  private db?: DatabaseSync;
  constructor(private dir: string) {}
  private file() { return join(this.dir, 'office-archive.db'); }

  private database() {
    if (this.db) return this.db;
    const db = new DatabaseSync(this.file());
    db.exec(`CREATE TABLE IF NOT EXISTS material (
      owner TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER, conversation TEXT,
      title TEXT NOT NULL, byline TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(owner,id)
    ); CREATE INDEX IF NOT EXISTS material_date ON material(owner,at DESC);`);
    return this.db = db;
  }

  add(owner: string, rows: ArchivedMaterial[]) {
    if (!rows.length) return;
    const db = this.database();
    const write = db.prepare(`INSERT INTO material(owner,id,kind,at,conversation,title,byline,text,payload) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner,id) DO UPDATE SET kind=excluded.kind,at=excluded.at,conversation=excluded.conversation,title=excluded.title,
      byline=excluded.byline,text=excluded.text,payload=excluded.payload WHERE excluded.text<>'' OR material.text=''`);
    db.exec('BEGIN');
    try {
      for (const row of rows) write.run(owner, row.id, row.kind, row.at, row.conversation ?? null,
        row.title.toLowerCase(), row.byline.toLowerCase(), row.text.toLowerCase(), JSON.stringify(row));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  get(owner: string, id: string): ArchivedMaterial | undefined {
    if (!this.db && !existsSync(this.file())) return;
    const row = this.database().prepare('SELECT payload FROM material WHERE owner=? AND id=?').get(owner, id);
    return row ? JSON.parse(String(row.payload)) as ArchivedMaterial : undefined;
  }

  search(owner: string, query: OfficeSearch) {
    if (!this.db && !existsSync(this.file())) return { rows: [], total: 0 };
    const db = this.database(), args: (string | number)[] = [owner], where = ['owner=?'];
    if (query.kind) { where.push('kind=?'); args.push(query.kind); }
    if (query.conversation) { where.push('conversation=?'); args.push(query.conversation); }
    if (query.from) { where.push('at>=?'); args.push(dayMillis(query.from)); }
    if (query.to) { where.push('at<?'); args.push(dayMillis(nextDay(query.to))); }
    if (query.group) { where.push("kind='group' AND instr(title,?)>0"); args.push(query.group.toLowerCase()); }
    if (query.person) { where.push("(instr(byline,?)>0 OR kind='direct' AND instr(title,?)>0)"); args.push(query.person.toLowerCase(), query.person.toLowerCase()); }
    if (query.keyword) { const word = query.keyword.toLowerCase(); where.push('(instr(title,?)>0 OR instr(byline,?)>0 OR instr(text,?)>0)'); args.push(word, word, word); }
    const conditions = where.join(' AND ');
    const total = Number(db.prepare(`SELECT count(*) AS n FROM material WHERE ${conditions}`).get(...args)?.n ?? 0);
    const rows = db.prepare(`SELECT payload FROM material WHERE ${conditions} ORDER BY at DESC,id LIMIT ? OFFSET ?`)
      .all(...args, query.limit ?? 80, query.offset ?? 0).map(row => JSON.parse(String(row.payload)) as ArchivedMaterial);
    return { rows, total };
  }

  close() { this.db?.close(); this.db = undefined; }
}
