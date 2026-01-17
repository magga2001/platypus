/**
 * Example usage of Hyperliquid WebSocket integration.
 * 
 * This demonstrates how to:
 * 1. Connect to WebSocket
 * 2. Subscribe to user fills
 * 3. Handle real-time updates
 * 4. Use REST as fallback
 * 
 * Run with: tsx src/examples/websocketExample.ts
 */

import { PublicHLDatasource } from '../datasource/hyperliquid';

async function main() {
  const datasource = new PublicHLDatasource();
  const testUser = '0x0e09b56ef137f417e424f1265425e93bfff77e17';

  console.log('🚀 WebSocket Example');
  console.log('===================\n');

  // 1. Check connection status
  console.log('WebSocket connected:', datasource.isWebSocketConnected());

  // 2. Subscribe to real-time fills
  console.log(`\n📡 Subscribing to fills for ${testUser}...`);
  
  const unsubscribe = await datasource.subscribeToUserFills(testUser, (fills) => {
    console.log(`\n✨ Received ${fills.length} fill(s):`);
    fills.forEach(fill => {
      console.log(`  - ${fill.coin} ${fill.side === 'B' ? 'BUY' : 'SELL'} ${fill.sz} @ ${fill.px} (${new Date(fill.time).toISOString()})`);
    });
  });

  console.log('✅ Subscribed! Listening for fills...');
  console.log('Connection status:', datasource.isWebSocketConnected());

  // 3. Wait for updates
  console.log('\n⏳ Waiting 30 seconds for real-time updates...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // 4. Check cached fills
  const cached = datasource.getCachedFills(testUser);
  console.log(`\n📦 Cached fills: ${cached.length}`);

  // 5. Compare with REST API
  console.log('\n🔄 Fetching from REST API for comparison...');
  const restFills = await datasource.getFills({ user: testUser });
  console.log(`📥 REST API fills: ${restFills.length}`);

  // 6. Unsubscribe
  console.log('\n🛑 Unsubscribing...');
  unsubscribe();

  // 7. Disconnect
  console.log('Disconnecting WebSocket...');
  datasource.disconnectWebSocket();

  console.log('\n✅ Example complete!');
  console.log('\nKey takeaways:');
  console.log('- WebSocket provides real-time updates');
  console.log('- REST API serves as reliable fallback');
  console.log('- Cached fills available instantly');
  console.log('- Auto-reconnection handles disconnects');
}

main().catch(console.error);
