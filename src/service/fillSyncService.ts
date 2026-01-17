/**
 * Fill Sync Service
 * 
 * Subscribes to real-time user fill events from Hyperliquid WebSocket
 * and automatically syncs them to the database.
 */

import { userFillRepository } from '../repository/userFillRepository';
import type { NewUserFill } from '../db/schema';
import type { Fill } from '../lib/hyperliquidClient';
import { PublicHLDatasource } from '../datasource/hyperliquid';

export class FillSyncService {
  private datasource: PublicHLDatasource;
  private activeSubscriptions: Map<string, () => void> = new Map();

  constructor(datasource?: PublicHLDatasource) {
    this.datasource = datasource || new PublicHLDatasource();
  }

  /**
   * Start syncing fills for a user
   * @param user - User address to sync
   */
  async startSyncingUser(user: string): Promise<void> {
    const normalizedUser = user.toLowerCase();

    // Don't subscribe twice
    if (this.activeSubscriptions.has(normalizedUser)) {
      console.log(`Already syncing fills for ${normalizedUser}`);
      return;
    }

    console.log(`🔄 Starting fill sync for ${normalizedUser}...`);

    // Subscribe to real-time fills
    const unsubscribe = await this.datasource.subscribeToUserFills(
      normalizedUser,
      async (fills: Fill[]) => {
        if (fills.length === 0) return;

        console.log(`💾 Syncing ${fills.length} new fills for ${normalizedUser}...`);

        try {
          // Convert to database format
          const newFills: NewUserFill[] = fills.map((f) => ({
            user: normalizedUser,
            coin: f.coin,
            oid: f.oid,
            tid: f.tid,
            px: f.px,
            sz: f.sz,
            side: f.side,
            time: f.time,
            closedPnl: f.closedPnl || '0',
            fee: f.fee || '0',
            builderFee: f.builderFee || null,
            startPosition: f.startPosition || '0',
            dir: f.dir,
            hash: f.hash,
            crossed: f.crossed || null,
            feeToken: f.feeToken || null,
          }));

          // Upsert to database (will skip duplicates based on user+tid unique constraint)
          await userFillRepository.upsertMany(newFills);

          console.log(`✅ Synced ${fills.length} fills for ${normalizedUser}`);
        } catch (error) {
          console.error(`❌ Error syncing fills for ${normalizedUser}:`, error);
        }
      }
    );

    // Store unsubscribe function
    this.activeSubscriptions.set(normalizedUser, unsubscribe);
  }

  /**
   * Stop syncing fills for a user
   * @param user - User address to stop syncing
   */
  stopSyncingUser(user: string): void {
    const normalizedUser = user.toLowerCase();
    const unsubscribe = this.activeSubscriptions.get(normalizedUser);

    if (unsubscribe) {
      unsubscribe();
      this.activeSubscriptions.delete(normalizedUser);
      console.log(`⏸️ Stopped syncing fills for ${normalizedUser}`);
    }
  }

  /**
   * Stop all active syncs
   */
  stopAll(): void {
    console.log(`⏸️ Stopping all fill syncs (${this.activeSubscriptions.size} users)...`);
    this.activeSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.activeSubscriptions.clear();
  }

  /**
   * Get list of users currently being synced
   */
  getActiveSyncs(): string[] {
    return Array.from(this.activeSubscriptions.keys());
  }

  /**
   * Check if a user is being synced
   */
  isSyncing(user: string): boolean {
    return this.activeSubscriptions.has(user.toLowerCase());
  }
}

/**
 * Singleton instance
 */
export const fillSyncService = new FillSyncService();
