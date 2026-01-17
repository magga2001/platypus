import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  index,
  unique,
  bigint,
  boolean as pgBoolean,
} from 'drizzle-orm/pg-core';

export const userFillModel = pgTable(
  'user_fills',
  {
    id: varchar('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // User wallet address (indexed)
    user: text('user').notNull(),
    
    // Trade identification
    coin: text('coin').notNull(), // e.g., "BTC", "AVAX", "xyz:XYZ100" (HIP-3), "@107" (spot)
    oid: bigint('oid', { mode: 'number' }).notNull(), // Order ID
    tid: bigint('tid', { mode: 'number' }).notNull(), // Trade ID (unique per fill)
    
    // Trade details
    px: text('px').notNull(), // Price (decimal string)
    sz: text('sz').notNull(), // Size (decimal string)
    side: text('side').notNull(), // "B" (Buy) or "A" (Ask/Sell)
    time: bigint('time', { mode: 'number' }).notNull(), // Timestamp in ms (indexed)
    
    // Position tracking
    startPosition: text('start_position'), // Position before fill (decimal string)
    dir: text('dir'), // Direction: "Open Long", "Close Short", "Sell", etc.
    closedPnl: text('closed_pnl'), // Realized PnL from this fill (decimal string)
    
    // Order flags
    crossed: pgBoolean('crossed'), // Whether order crossed the spread
    
    // Fees
    fee: text('fee').notNull(), // Total trading fee (decimal string)
    feeToken: text('fee_token'), // Fee token (usually "USDC")
    
    // Builder attribution (bonus feature)
    builderFee: text('builder_fee'), // Builder fee if trade attributed to builder (optional)
    
    // Hash for uniqueness
    hash: text('hash').notNull(), // Transaction hash
    
    // Metadata
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // Composite unique constraint: user + tid ensures no duplicate fills
    unique('user_tid_idx').on(
      table.user,
      table.tid,
    ),
    // Index on user (wallet address) for efficient user queries
    index('user_idx').on(table.user),
    // Index on time (ms) for efficient time-range queries
    index('time_idx').on(table.time),
    // Composite index on user + time for efficient user-specific time-range queries
    index('user_time_idx').on(table.user, table.time),
    // Index on user + coin for efficient per-coin queries
    index('user_coin_idx').on(table.user, table.coin),
    // Index on hash for quick lookups
    index('hash_idx').on(table.hash),
  ],
);

export type UserFill = InferSelectModel<typeof userFillModel>;
export type NewUserFill = InferInsertModel<typeof userFillModel>;
