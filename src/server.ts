import app from './app';
import config from './config/config';
import { fillSyncService } from './service/fillSyncService';
import { userFillRepository } from './repository/userFillRepository';
import { LedgerService } from './service/ledgerService';

const ledgerService = new LedgerService();

// Predefined users to always fetch on startup
const STARTUP_USERS = [
  '0x0e09b56ef137f417e424f1265425e93bfff77e17',
  '0x186b7610ff3f2e3fd7985b95f525ee0e37a79a74',
  '0x6c8031a9eb4415284f3f89c0420f697c87168263',
];

// Start fill sync service for all users in database + predefined users
async function startFillSync() {
  try {
    console.log('🔄 Starting fill sync service...');
    
    // Get all distinct users from database
    const dbUsers = await userFillRepository.getDistinctUsers();
    
    // Combine database users with startup users (remove duplicates)
    const allUsers = Array.from(new Set([...dbUsers, ...STARTUP_USERS]));
    
    if (allUsers.length === 0) {
      console.log('ℹ️ No users found. Fill sync will start when users are added.');
      return;
    }

    console.log(`📋 Found ${dbUsers.length} users in database, ${STARTUP_USERS.length} predefined users (${allUsers.length} total unique)`);
    
    // Fetch initial data and start syncing for each user
    for (const user of allUsers) {
      try {
        const normalizedUser = user.toLowerCase();
        const isInDb = dbUsers.includes(normalizedUser);
        
        if (isInDb) {
          // User already in DB - just backfill recent data and start syncing
          console.log(`🔄 Backfilling recent data for ${user}...`);
          await ledgerService.backfillUser(user);
        } else {
          // New user - fetch full initial data
          console.log(`🆕 Fetching initial data for ${user}...`);
          await ledgerService.getTrades({ user });
        }
        
        console.log(`🔄 Ensuring WebSocket sync for ${user}...`);
        await fillSyncService.ensureUserSyncing(user);
      } catch (error) {
        console.error(`Failed to start sync for ${user}:`, error);
      }
    }
    
    console.log(`✅ Fill sync started for ${allUsers.length} users`);
  } catch (error) {
    console.error('❌ Failed to start fill sync service:', error);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, stopping fill sync...');
  fillSyncService.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, stopping fill sync...');
  fillSyncService.stopAll();
  process.exit(0);
});

app.listen(config.port, async () => {
  console.log(`Server running on port ${config.port}`);
  await startFillSync();
});