/**
 * Orius Chrome Extension - Background Service Worker
 * Handles token earning via server heartbeat when popup is closed
 * Uses device-bound wallet security
 * Developed by Orius Team
 */

const CONFIG = {
  alarmName: 'orius-heartbeat',
  alarmPeriodMinutes: 0.167,
  apiUrl: 'https://orius.io',
};

let sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);

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

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('Orius extension installed');
    
    const deviceId = generateDeviceId();
    
    await chrome.storage.local.set({
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
  
  initAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, checking node status');
  checkAndRestartAlarm();
});

async function initAlarm() {
  const data = await chrome.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId']);
  
  if (data.isNodeOn && data.walletAddress && data.deviceId) {
    startAlarm();
    updateBadge(true);
  }
}

async function checkAndRestartAlarm() {
  const data = await chrome.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId']);
  
  if (data.isNodeOn && data.walletAddress && data.deviceId) {
    startAlarm();
    updateBadge(true);
  } else {
    stopAlarm();
    updateBadge(false);
  }
}

function startAlarm() {
  chrome.alarms.create(CONFIG.alarmName, {
    delayInMinutes: 0.167,
    periodInMinutes: CONFIG.alarmPeriodMinutes
  });
  console.log('Orius heartbeat alarm started (10 second intervals)');
}

function stopAlarm() {
  chrome.alarms.clear(CONFIG.alarmName);
  console.log('Orius heartbeat alarm stopped');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CONFIG.alarmName) {
    await sendHeartbeat();
  }
});

async function sendHeartbeat() {
  const data = await chrome.storage.local.get(['isNodeOn', 'walletAddress', 'deviceId', 'onlineSeconds']);
  
  if (!data.isNodeOn || !data.walletAddress || !data.deviceId) {
    stopAlarm();
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
      await chrome.storage.local.set({ isNodeOn: false });
      stopAlarm();
      updateBadge(false);
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      const newOnlineSeconds = (data.onlineSeconds || 0) + 10;
      
      await chrome.storage.local.set({
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
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function processBrowsingActivity(data) {
  const stored = await chrome.storage.local.get(['browsingEnabled', 'browsingStats']);
  
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
  
  await chrome.storage.local.set({ browsingStats: stats });
  console.log('Orius: Browsing activity recorded', data.domain);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'NODE_ON':
      chrome.storage.local.get(['walletAddress', 'deviceId'], (data) => {
        if (data.walletAddress && data.deviceId) {
          startAlarm();
          updateBadge(true);
        }
      });
      sendResponse({ success: true });
      break;
      
    case 'NODE_OFF':
      stopAlarm();
      updateBadge(false);
      sendResponse({ success: true });
      break;
      
    case 'GET_STATUS':
      chrome.storage.local.get(['isNodeOn'], (result) => {
        sendResponse({ isNodeOn: result.isNodeOn || false });
      });
      return true;
      
    case 'BROWSING_ACTIVITY':
      processBrowsingActivity(request);
      sendResponse({ success: true });
      break;
      
    case 'ENABLE_BROWSING':
      chrome.storage.local.set({ browsingEnabled: true });
      sendResponse({ success: true });
      break;
      
    case 'DISABLE_BROWSING':
      chrome.storage.local.set({ browsingEnabled: false });
      sendResponse({ success: true });
      break;
      
    case 'PING':
      sendResponse({ status: 'ok', timestamp: Date.now() });
      break;
  }
});

console.log('Orius background service worker loaded');
