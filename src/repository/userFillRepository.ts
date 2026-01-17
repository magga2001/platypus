import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';
import { userFillModel } from '../db/schema';
import type { UserFill, NewUserFill } from '../db/schema';
import { db } from '../config/db';

export class UserFillRepository {
  /**
   * Create a single fill
   */
  async create(fill: NewUserFill): Promise<UserFill> {
    const [created] = await db.insert(userFillModel).values(fill).returning();
    if (!created) throw new Error('Failed to create fill');
    return created;
  }

  /**
   * Bulk create fills (for batch inserts)
   */
  async createMany(fills: NewUserFill[]): Promise<UserFill[]> {
    if (fills.length === 0) return [];
    const created = await db.insert(userFillModel).values(fills).returning();
    return created;
  }

  /**
   * Find fill by ID
   */
  async findById(id: string): Promise<UserFill | undefined> {
    const [fill] = await db
      .select()
      .from(userFillModel)
      .where(eq(userFillModel.id, id))
      .limit(1);
    return fill;
  }

  /**
   * Find fill by transaction hash
   */
  async findByHash(hash: string): Promise<UserFill | undefined> {
    const [fill] = await db
      .select()
      .from(userFillModel)
      .where(eq(userFillModel.hash, hash))
      .limit(1);
    return fill;
  }

  /**
   * Find fill by user and trade ID (tid)
   */
  async findByUserAndTid(user: string, tid: number): Promise<UserFill | undefined> {
    const [fill] = await db
      .select()
      .from(userFillModel)
      .where(and(eq(userFillModel.user, user), eq(userFillModel.tid, tid)))
      .limit(1);
    return fill;
  }

  /**
   * Find all fills for a user
   */
  async findByUser(
    user: string,
    options?: {
      coin?: string;
      fromMs?: number;
      toMs?: number;
      limit?: number;
      offset?: number;
      orderBy?: 'asc' | 'desc';
    }
  ): Promise<UserFill[]> {
    const conditions = [eq(userFillModel.user, user)];

    if (options?.coin) {
      conditions.push(eq(userFillModel.coin, options.coin));
    }

    if (options?.fromMs) {
      conditions.push(gte(userFillModel.time, options.fromMs));
    }

    if (options?.toMs) {
      conditions.push(lte(userFillModel.time, options.toMs));
    }

    const query = db
      .select()
      .from(userFillModel)
      .where(and(...conditions))
      .orderBy(
        options?.orderBy === 'asc' 
          ? asc(userFillModel.time) 
          : desc(userFillModel.time)
      )
      .$dynamic();

    if (options?.limit) {
      return await query.limit(options.limit).offset(options?.offset || 0);
    }

    if (options?.offset) {
      return await query.offset(options.offset);
    }

    return await query;
  }

  /**
   * Find all fills for a coin
   */
  async findByCoin(
    coin: string,
    options?: {
      fromMs?: number;
      toMs?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<UserFill[]> {
    const conditions = [eq(userFillModel.coin, coin)];

    if (options?.fromMs) {
      conditions.push(gte(userFillModel.time, options.fromMs));
    }

    if (options?.toMs) {
      conditions.push(lte(userFillModel.time, options.toMs));
    }

    const query = db
      .select()
      .from(userFillModel)
      .where(and(...conditions))
      .orderBy(desc(userFillModel.time))
      .$dynamic();

    if (options?.limit) {
      return await query.limit(options.limit).offset(options?.offset || 0);
    }

    if (options?.offset) {
      return await query.offset(options.offset);
    }

    return await query;
  }

  /**
   * Find fills with builder attribution
   */
  async findWithBuilderFee(
    user: string,
    options?: {
      coin?: string;
      fromMs?: number;
      toMs?: number;
    }
  ): Promise<UserFill[]> {
    const conditions = [
      eq(userFillModel.user, user),
      // Only fills with builderFee > 0
    ];

    if (options?.coin) {
      conditions.push(eq(userFillModel.coin, options.coin));
    }

    if (options?.fromMs) {
      conditions.push(gte(userFillModel.time, options.fromMs));
    }

    if (options?.toMs) {
      conditions.push(lte(userFillModel.time, options.toMs));
    }

    const fills = await db
      .select()
      .from(userFillModel)
      .where(and(...conditions))
      .orderBy(desc(userFillModel.time));

    // Filter in-memory for builderFee > 0 (since we can't do this in SQL with text field)
    return fills.filter((fill: UserFill) => 
      fill.builderFee && parseFloat(fill.builderFee) > 0
    );
  }

  /**
   * Update a fill by ID
   */
  async update(id: string, data: Partial<NewUserFill>): Promise<UserFill | undefined> {
    const [updated] = await db
      .update(userFillModel)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userFillModel.id, id))
      .returning();
    return updated;
  }

  /**
   * Delete a fill by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(userFillModel)
      .where(eq(userFillModel.id, id))
      .returning();
    return result.length > 0;
  }

  /**
   * Delete all fills for a user
   */
  async deleteByUser(user: string): Promise<number> {
    const result = await db
      .delete(userFillModel)
      .where(eq(userFillModel.user, user))
      .returning();
    return result.length;
  }

  /**
   * Count fills for a user
   */
  async countByUser(
    user: string,
    options?: {
      coin?: string;
      fromMs?: number;
      toMs?: number;
    }
  ): Promise<number> {
    const conditions = [eq(userFillModel.user, user)];

    if (options?.coin) {
      conditions.push(eq(userFillModel.coin, options.coin));
    }

    if (options?.fromMs) {
      conditions.push(gte(userFillModel.time, options.fromMs));
    }

    if (options?.toMs) {
      conditions.push(lte(userFillModel.time, options.toMs));
    }

    const result = await db
      .select()
      .from(userFillModel)
      .where(and(...conditions));

    return result.length;
  }

  /**
   * Check if fill exists by user and tid
   */
  async exists(user: string, tid: number): Promise<boolean> {
    const fill = await this.findByUserAndTid(user, tid);
    return !!fill;
  }

  /**
   * Upsert fill (insert or update if exists)
   * Useful for syncing data from Hyperliquid API
   */
  async upsert(fill: NewUserFill): Promise<UserFill> {
    const existing = await this.findByUserAndTid(fill.user, fill.tid);
    
    if (existing) {
      return await this.update(existing.id, fill) as UserFill;
    } else {
      return await this.create(fill);
    }
  }

  /**
   * Bulk upsert fills
   * Efficiently sync large batches of fills from API
   */
  async upsertMany(fills: NewUserFill[]): Promise<UserFill[]> {
    const results: UserFill[] = [];

    // Process in chunks to avoid overwhelming the DB
    const chunkSize = 100;
    for (let i = 0; i < fills.length; i += chunkSize) {
      const chunk = fills.slice(i, i + chunkSize);
      
      for (const fill of chunk) {
        const result = await this.upsert(fill);
        results.push(result);
      }
    }

    return results;
  }
}

// Export singleton instance
export const userFillRepository = new UserFillRepository();
