import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import dotenv from 'dotenv';
import * as userFillSchema from '../db/schema';

dotenv.config();

// Create a pg pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: Number(process.env.DB_PORT),
});

// Drizzle ORM instance
export const db = drizzle({
  client: pool,
  schema: {
    ...userFillSchema,
  },
});

// Export raw pool in case you need native pg queries
export const pgPool = pool;
