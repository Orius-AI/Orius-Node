/**
 * Orius Firefox Extension - Background Script
 * Handles token earning via server heartbeat when popup is closed
 * Uses device-bound wallet security
 * Developed by Orius Team
 */

const CONFIG = {
  apiUrl: 'https://hexion-goal--canmacth.replit.app',
};

let sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
let heartbeatInterval = null;

function generateDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID() + '-' + Date.now().toString(36);
  }
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id + '-' + Date.now().toString(36);
}

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Orius extension installed');
    
    const deviceId = generateDeviceId();
    
    await browser.storage.local.set({
      isNodeOn: false,
      onlineSeconds: 0,
      serverBalance: 0,
      walletAddress: '',
      isRegistered: false,
      deviceId: deviceId,
      lastActiveDate: new Date().toDateString(),
      tasksCompleted: 0,
      computeScore: 0,
      browsingEnabled: false,
      permissionAsked: false,
      browsingStats: {
        pagesVisited: 0,
        totalTimeSpent: 0,
        domainsVisited: [],
        avgScrollDepth: 0
      }
    });
  }
  
  initHeartbeat();
});

browser.runtime.onStartup.addListener(() => {
  console.log('Browser started, checking node status');
  checkAndRestartHeartbeat();
});

async function initHeartbeat() {
  const data = await browser.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId']);
  
  if (data.isNodeOn && data.walletAddress && data.deviceId) {
    startHeartbeat();
    updateBadge(true);
  }
}

async function checkAndRestartHeartbeat() {
  const data = await browser.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId']);
  
  if (data.isNodeOn && data.walletAddress && data.deviceId) {
    startHeartbeat();
    updateBadge(true);
  } else {
    stopHeartbeat();
    updateBadge(false);
  }
}

function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  heartbeatInterval = setInterval(sendHeartbeat, 10000);
  console.log('Orius heartbeat started (10 second intervals)');
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  console.log('Orius heartbeat stopped');
}

async function sendHeartbeat() {
  const data = await browser.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId', 'onlineSeconds']);
  
  if (!data.isNodeOn || !data.walletAddress || !data.deviceId) {
    stopHeartbeat();
    updateBadge(false);
    return;
  }
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: data.walletAddress,
        deviceId: data.deviceId,
        sessionId: sessionId
      })
    });
    
    if (response.status === 429) {
      console.log('Orius: Rate limited, will retry');
      return;
    }
    
    if (response.status === 403) {
      console.log('Orius: Device mismatch - stopping');
      await browser.storage.local.set({ isNodeOn: false });
      stopHeartbeat();
      updateBadge(false);
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      const newOnlineSeconds = (data.onlineSeconds || 0) + 10;
      
      await browser.storage.local.set({
        serverBalance: result.balance.claimableBalance,
        onlineSeconds: newOnlineSeconds,
        earnedToday: result.balance.earnedToday || 0,
        tasksCompleted: Math.floor(newOnlineSeconds / 60),
        computeScore: Math.floor(800 + Math.random() * 150)
      });
      
      console.log(`Orius: Balance ${result.balance.claimableBalance.toFixed(2)} $Orius`);
    }
  } catch (error) {
    console.log('Orius: Heartbeat failed (offline)', error.message);
  }
}

function updateBadge(isOn) {
  if (isOn) {
    browser.browserAction.setBadgeText({ text: 'ON' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}

async function processBrowsingActivity(data) {
  const stored = await browser.storage.local.get(['browsingEnabled', 'browsingStats']);
  
  if (!stored.browsingEnabled) return;
  
  const stats = stored.browsingStats || {
    pagesVisited: 0,
    totalTimeSpent: 0,
    domainsVisited: [],
    avgScrollDepth: 0
  };
  
  stats.pagesVisited++;
  stats.totalTimeSpent += data.timeSpent || 0;
  
  if (data.domain && !stats.domainsVisited.includes(data.domain)) {
    stats.domainsVisited.push(data.domain);
    if (stats.domainsVisited.length > 100) {
      stats.domainsVisited = stats.domainsVisited.slice(-100);
    }
  }
  
  const prevTotal = stats.avgScrollDepth * (stats.pagesVisited - 1);
  stats.avgScrollDepth = Math.round((prevTotal + (data.scrollDepth || 0)) / stats.pagesVisited);
  
  await browser.storage.local.set({ browsingStats: stats });
  console.log('Orius: Browsing activity recorded', data.domain);
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'NODE_ON':
      browser.storage.local.get(['walletAddress', 'deviceId']).then((data) => {
        if (data.walletAddress && data.deviceId) {
          startHeartbeat();
          updateBadge(true);
        }
      });
      return Promise.resolve({ success: true });
      
    case 'NODE_OFF':
      stopHeartbeat();
      updateBadge(false);
      return Promise.resolve({ success: true });
      
    case 'GET_STATUS':
      return browser.storage.local.get(['isNodeOn']).then((result) => {
        return { isNodeOn: result.isNodeOn || false };
      });
      
    case 'BROWSING_ACTIVITY':
      processBrowsingActivity(request);
      return Promise.resolve({ success: true });
      
    case 'ENABLE_BROWSING':
      browser.storage.local.set({ browsingEnabled: true });
      return Promise.resolve({ success: true });
      
    case 'DISABLE_BROWSING':
      browser.storage.local.set({ browsingEnabled: false });
      return Promise.resolve({ success: true });
      
    case 'PING':
      return Promise.resolve({ status: 'ok', timestamp: Date.now() });
  }
});

console.log('Orius background script loaded');
