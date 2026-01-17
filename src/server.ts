import app from './app';
import config from './config/config';
import { fillSyncService } from './service/fillSyncService';
import { userFillRepository } from './repository/userFillRepository';

// Start fill sync service for all users in database
async function startFillSync() {
  try {
    console.log('🔄 Starting fill sync service...');
    
    // Get all distinct users from database
    const users = await userFillRepository.getDistinctUsers();
    
    if (users.length === 0) {
      console.log('ℹ️ No users found in database. Fill sync will start when users are added.');
      return;
    }

    console.log(`📋 Found ${users.length} users in database`);
    
    // Start syncing for each user
    for (const user of users) {
      try {
        await fillSyncService.startSyncingUser(user);
      } catch (error) {
        console.error(`Failed to start sync for ${user}:`, error);
      }
    }
    
    console.log(`✅ Fill sync started for ${users.length} users`);
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