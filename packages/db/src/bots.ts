import { sql } from 'drizzle-orm';
import type { Db } from './index.js';
import { bots } from './schema.js';

type Reader = Pick<Db, 'select'>;

/** A bot exists while its folder does; removed bots cannot be assigned or comment. */
export async function botExists(db: Reader, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: bots.id })
    .from(bots)
    .where(sql`${bots.id} = ${id} AND ${bots.removedAt} IS NULL`);
  return row !== undefined;
}
