/**
 * Orius Network - Firefox Extension
 * Compute Node Controller with Device-Bound Wallet Security
 * Developed by Orius Team
 */

const CONFIG = {
  dashboardUrl: 'https://orius.io',
  updateInterval: 1000,
  heartbeatInterval: 10000,
  loadingDuration: 800,
  geoApiUrl: 'https://ipinfo.io/json',
  minClaimAmount: 100,
  apiUrl: 'https://hexion-goal--canmacth.replit.app',
};

let heartbeatTimer = null;
let sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
let deviceId = null;

const storage = {
  async get(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.get(keys);
    }
    const result = {};
    keys.forEach(key => {
      const val = localStorage.getItem(key);
      if (val !== null) {
        try { result[key] = JSON.parse(val); } catch { result[key] = val; }
      }
    });
    return result;
  },
  async set(data) {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.set(data);
    }
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  },
  async clear() {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      return browser.storage.local.clear();
    }
    localStorage.clear();
  }
};

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

let state = {
  isNodeOn: false,
  onlineSeconds: 0,
  tokensToday: 0,
  totalTokens: 0,
  walletAddress: '',
  computeScore: 0,
  tasksCompleted: 0,
  location: null,
  locationGranted: false,
  browsingEnabled: false,
  browsingStats: null,
  permissionAsked: false,
  isRegistered: false,
  serverBalance: 0,
  earnedToday: 0,
};

let updateInterval = null;
let computeWorker = null;
let activityLogs = [];

const el = {
  loadingScreen: document.getElementById('loadingScreen'),
  app: document.getElementById('app'),
  navTabs: document.querySelectorAll('.nav-tab'),
  pages: document.querySelectorAll('.page'),
  nodeSection: document.getElementById('nodeHero'),
  powerBtn: document.getElementById('powerBtn'),
  statusText: document.getElementById('statusText'),
  locationText: document.getElementById('locationText'),
  totalTokens: document.getElementById('totalTokens'),
  todayTokens: document.getElementById('todayTokens'),
  sessionTime: document.getElementById('sessionTime'),
  computeScore: document.getElementById('computeScore'),
  cpuCores: document.getElementById('cpuCores'),
  memoryInfo: document.getElementById('memoryInfo'),
  regionInfo: document.getElementById('regionInfo'),
  tasksDone: document.getElementById('tasksDone'),
  activityLog: document.getElementById('activityLog'),
  walletInput: document.getElementById('walletInput'),
  saveWalletBtn: document.getElementById('saveWalletBtn'),
  walletMessage: document.getElementById('walletMessage'),
  locationPermBtn: document.getElementById('locationPermBtn'),
  browsingPermBtn: document.getElementById('browsingPermBtn'),
  pagesVisited: document.getElementById('pagesVisited'),
  browseTime: document.getElementById('browseTime'),
  domainsCount: document.getElementById('domainsCount'),
  avgScroll: document.getElementById('avgScroll'),
  browseHint: document.getElementById('browseHint'),
  dashboardBtn: document.getElementById('dashboardBtn'),
  permissionModal: document.getElementById('permissionModal'),
  permAllowBtn: document.getElementById('permAllowBtn'),
  permDenyBtn: document.getElementById('permDenyBtn'),
  claimSection: document.getElementById('claimSection'),
  claimableAmount: document.getElementById('claimableAmount'),
  claimBtn: document.getElementById('claimBtn'),
  claimBtnText: document.getElementById('claimBtnText'),
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadState();
  
  const isPreview = !window.browser?.storage;
  const loadTime = isPreview ? 100 : CONFIG.loadingDuration;
  
  setTimeout(async () => {
    el.loadingScreen.classList.add('fade-out');
    el.app.classList.add('visible');
    setTimeout(() => el.loadingScreen.style.display = 'none', 400);
    
    if (!state.permissionAsked) {
      setTimeout(() => showPermissionModal(), 300);
    }
  }, loadTime);

  await getSystemInfo();
  await getLocation();
  
  setupListeners();
  
  updateUI();
  
  if (state.isNodeOn && state.walletAddress) {
    startNode();
  }
}

function showPermissionModal() {
  el.permissionModal.classList.add('visible');
}

function hidePermissionModal() {
  el.permissionModal.classList.remove('visible');
}

async function handlePermissionAllow() {
  state.browsingEnabled = true;
  state.permissionAsked = true;
  
  notifyBackground('ENABLE_BROWSING');
  await storage.set({ 
    browsingEnabled: true, 
    permissionAsked: true 
  });
  
  hidePermissionModal();
  updateBrowsingUI();
}

async function handlePermissionDeny() {
  state.permissionAsked = true;
  
  await storage.set({ permissionAsked: true });
  
  hidePermissionModal();
}

async function loadState() {
  try {
    const data = await storage.get([
      'isNodeOn', 'onlineSeconds', 'tokensToday', 'totalTokens', 
      'walletAddress', 'lastActiveDate', 'computeScore', 'tasksCompleted',
      'location', 'locationGranted', 'browsingEnabled', 'browsingStats', 'permissionAsked',
      'isRegistered', 'serverBalance', 'deviceId', 'earnedToday'
    ]);
    
    const today = new Date().toDateString();
    const isNewDay = data.lastActiveDate !== today;
    
    if (data.deviceId) {
      deviceId = data.deviceId;
    } else {
      deviceId = generateDeviceId();
      await storage.set({ deviceId });
    }
    
    state.isNodeOn = data.isNodeOn || false;
    state.onlineSeconds = isNewDay ? 0 : (data.onlineSeconds || 0);
    state.tokensToday = isNewDay ? 0 : (data.tokensToday || 0);
    state.totalTokens = data.totalTokens || 0;
    state.computeScore = data.computeScore || 0;
    state.tasksCompleted = data.tasksCompleted || 0;
    state.location = data.location || null;
    state.locationGranted = data.locationGranted || false;
    state.browsingEnabled = data.browsingEnabled || false;
    state.browsingStats = data.browsingStats || null;
    state.permissionAsked = data.permissionAsked || false;
    state.earnedToday = isNewDay ? 0 : (data.earnedToday || 0);
    
    await storage.set({ lastActiveDate: today });
    
    await checkDeviceBinding();
    
  } catch (e) {
    console.error('Load error:', e);
  }
}

async function checkDeviceBinding() {
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/device/${deviceId}`);
    const result = await response.json();
    
    if (result.success && result.bound) {
      state.walletAddress = result.wallet;
      state.isRegistered = true;
      state.serverBalance = result.balance?.claimableBalance || 0;
      state.earnedToday = result.balance?.earnedToday || 0;
      
      await storage.set({
        walletAddress: state.walletAddress,
        isRegistered: true,
        serverBalance: state.serverBalance
      });
      
      console.log('Device bound to wallet:', state.walletAddress);
    } else {
      state.walletAddress = '';
      state.isRegistered = false;
      state.serverBalance = 0;
      
      await storage.set({
        walletAddress: '',
        isRegistered: false,
        serverBalance: 0
      });
    }
  } catch (error) {
    console.log('Device check failed (offline):', error.message);
    const data = await storage.get(['walletAddress', 'isRegistered', 'serverBalance']);
    state.walletAddress = data.walletAddress || '';
    state.isRegistered = data.isRegistered || false;
    state.serverBalance = data.serverBalance || 0;
  }
}

async function saveState() {
  await storage.set({
    isNodeOn: state.isNodeOn,
    onlineSeconds: state.onlineSeconds,
    tokensToday: state.tokensToday,
    totalTokens: state.totalTokens,
    walletAddress: state.walletAddress,
    computeScore: state.computeScore,
    tasksCompleted: state.tasksCompleted,
    location: state.location,
    locationGranted: state.locationGranted,
    isRegistered: state.isRegistered,
    serverBalance: state.serverBalance,
    deviceId: deviceId,
    earnedToday: state.earnedToday,
  });
}

async function getSystemInfo() {
  try {
    el.cpuCores.textContent = `${navigator.hardwareConcurrency || 4} cores`;
    if (navigator.deviceMemory) {
      el.memoryInfo.textContent = `${navigator.deviceMemory} GB`;
    } else {
      el.memoryInfo.textContent = '-- GB';
    }
  } catch (e) {
    console.error('System info error:', e);
  }
}

async function getLocation() {
  if (state.location && state.location.city !== 'Unknown') {
    updateLocationUI();
    return;
  }
  
  try {
    const response = await fetch(CONFIG.geoApiUrl);
    const data = await response.json();
    
    if (data.city) {
      state.location = {
        city: data.city,
        country: data.country || 'Unknown',
        countryCode: data.country || '--',
        region: data.region || 'Unknown'
      };
      
      updateLocationUI();
      saveState();
    } else {
      el.locationText.textContent = 'Location: Unknown';
      el.regionInfo.textContent = 'Unknown';
    }
  } catch (e) {
    console.error('Location error:', e);
    el.locationText.textContent = 'Location: Unknown';
    el.regionInfo.textContent = 'Unknown';
  }
}

function updateLocationUI() {
  if (state.location) {
    el.locationText.textContent = `${state.location.city}, ${state.location.countryCode}`;
    el.regionInfo.textContent = `${state.location.city}`;
  }
}

function requestLocationPermission() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        state.locationGranted = true;
        el.locationPermBtn.textContent = 'Granted';
        el.locationPermBtn.classList.add('granted');
        
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${position.coords.latitude}&lon=${position.coords.longitude}&format=json`
          );
          const data = await response.json();
          
          state.location = {
            city: data.address?.city || data.address?.town || 'Unknown',
            country: data.address?.country || 'Unknown',
            countryCode: data.address?.country_code?.toUpperCase() || '--',
            region: data.address?.state || 'Unknown'
          };
          
          updateLocationUI();
          saveState();
        } catch (e) {
          console.error('Geocoding error:', e);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Location permission denied. Using IP-based location instead.');
      }
    );
  }
}

function setupListeners() {
  el.navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  el.powerBtn.addEventListener('click', toggleNode);
  el.saveWalletBtn.addEventListener('click', saveWallet);
  el.walletInput.addEventListener('keypress', e => e.key === 'Enter' && saveWallet());
  el.locationPermBtn.addEventListener('click', requestLocationPermission);
  el.browsingPermBtn.addEventListener('click', toggleBrowsingPermission);
  el.permAllowBtn.addEventListener('click', handlePermissionAllow);
  el.permDenyBtn.addEventListener('click', handlePermissionDeny);
  el.claimBtn.addEventListener('click', handleClaim);
  
  el.dashboardBtn.addEventListener('click', () => {
    if (typeof browser !== 'undefined' && browser.tabs) {
      browser.tabs.create({ url: CONFIG.dashboardUrl });
    } else {
      window.open(CONFIG.dashboardUrl, '_blank');
    }
  });
}

function switchTab(tabId) {
  el.navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  el.pages.forEach(p => p.classList.toggle('active', p.id === `page-${tabId}`));
  
  if (tabId === 'settings') {
    el.walletInput.value = state.walletAddress;
    if (state.walletAddress) {
      fetchBalance();
    }
  }
}

async function fetchBalance() {
  if (!state.walletAddress || !deviceId) return;
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/balance/${state.walletAddress}?deviceId=${deviceId}`);
    const result = await response.json();
    
    if (result.success && result.balance) {
      state.serverBalance = result.balance.claimableBalance || 0;
      state.earnedToday = result.balance.earnedToday || 0;
      await saveState();
      updateStatsUI();
      updateClaimUI();
    } else if (response.status === 403) {
      console.log('Device mismatch - refreshing binding');
      await checkDeviceBinding();
      updateUI();
    }
  } catch (error) {
    console.log('Balance fetch skipped:', error.message);
  }
}

function toggleNode() {
  if (!state.walletAddress) {
    alert('Please set your wallet address first in Settings');
    switchTab('settings');
    return;
  }
  
  state.isNodeOn = !state.isNodeOn;
  
  if (state.isNodeOn) {
    startNode();
    notifyBackground('NODE_ON');
  } else {
    stopNode();
    notifyBackground('NODE_OFF');
  }
  
  saveState();
}

function notifyBackground(type) {
  if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
    browser.runtime.sendMessage({ type, deviceId }).catch(() => {
      console.log('Background notification skipped (preview mode)');
    });
  }
}

function startNode() {
  el.nodeSection.classList.add('active');
  el.statusText.textContent = 'ACTIVE';
  
  startComputeWorker();
  startInterval();
  startHeartbeat();
}

function stopNode() {
  el.nodeSection.classList.remove('active');
  el.statusText.textContent = 'OFFLINE';
  
  stopComputeWorker();
  stopInterval();
  stopHeartbeat();
}

function startHeartbeat() {
  if (!state.walletAddress || !deviceId) return;
  
  sendHeartbeat();
  
  heartbeatTimer = setInterval(sendHeartbeat, CONFIG.heartbeatInterval);
}

async function sendHeartbeat() {
  if (!state.isNodeOn || !state.walletAddress || !deviceId) return;
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: state.walletAddress,
        deviceId: deviceId,
        sessionId: sessionId
      })
    });
    
    if (response.status === 429) {
      console.log('Rate limited, will retry on next interval');
      return;
    }
    
    if (response.status === 403) {
      console.log('Device mismatch - stopping node');
      state.isNodeOn = false;
      stopNode();
      notifyBackground('NODE_OFF');
      alert('Device mismatch detected. This wallet is bound to another device.');
      await checkDeviceBinding();
      updateUI();
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      state.serverBalance = result.balance.claimableBalance;
      state.earnedToday = result.balance.earnedToday || 0;
      await saveState();
      updateStatsUI();
      updateClaimUI();
      console.log('Heartbeat success, balance:', result.balance.claimableBalance.toFixed(2));
    }
  } catch (error) {
    console.log('Heartbeat failed (offline mode):', error.message);
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startComputeWorker() {
  try {
    computeWorker = new Worker('compute-worker.js');
    
    computeWorker.onmessage = function(e) {
      const { type, data } = e.data;
      
      if (type === 'taskComplete') {
        state.tasksCompleted = data.taskId;
        state.computeScore = data.computeScore;
        
        addActivityLog(data);
        updateStatsUI();
        saveState();
      }
    };
    
    computeWorker.postMessage({ command: 'start' });
  } catch (e) {
    console.error('Worker error:', e);
    state.computeScore = Math.floor(800 + Math.random() * 100);
  }
}

function stopComputeWorker() {
  if (computeWorker) {
    computeWorker.postMessage({ command: 'stop' });
    computeWorker.terminate();
    computeWorker = null;
  }
}

function addActivityLog(data) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  
  activityLogs.unshift({
    time: timeStr,
    taskId: data.taskId,
    duration: data.duration,
    score: data.computeScore
  });
  
  if (activityLogs.length > 20) {
    activityLogs.pop();
  }
  
  renderActivityLog();
}

function renderActivityLog() {
  if (activityLogs.length === 0) {
    el.activityLog.innerHTML = '<div class="log-empty">No activity yet. Start the node to begin computing.</div>';
    return;
  }
  
  el.activityLog.innerHTML = activityLogs.map(log => `
    <div class="log-entry">
      <span class="log-task">Task #${log.taskId}</span>
      <span class="log-result">${log.duration}ms | Score: ${log.score}</span>
      <span class="log-time">${log.time}</span>
    </div>
  `).join('');
}

function startInterval() {
  if (updateInterval) return;
  
  updateInterval = setInterval(() => {
    state.onlineSeconds++;
    updateStatsUI();
    saveState();
  }, CONFIG.updateInterval);
}

function stopInterval() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

async function saveWallet() {
  const addr = el.walletInput.value.trim();
  
  el.walletMessage.className = 'wallet-hint';
  
  if (!addr) {
    el.walletMessage.textContent = 'Please enter a wallet address';
    el.walletMessage.classList.add('error');
    return;
  }
  
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
    el.walletMessage.textContent = 'Invalid Solana address format';
    el.walletMessage.classList.add('error');
    return;
  }
  
  el.walletMessage.textContent = 'Registering wallet...';
  el.saveWalletBtn.disabled = true;
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        walletAddress: addr,
        deviceId: deviceId
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      state.walletAddress = addr;
      state.isRegistered = true;
      state.serverBalance = result.user.claimableBalance || 0;
      await saveState();
      
      el.walletMessage.textContent = 'Wallet registered successfully!';
      el.walletMessage.classList.add('success');
      
      updateClaimUI();
      updateStatsUI();
      
      setTimeout(() => {
        el.walletMessage.textContent = 'Your $Orius tokens will be sent here';
        el.walletMessage.className = 'wallet-hint';
      }, 2500);
    } else if (response.status === 409) {
      if (result.boundWallet) {
        el.walletMessage.textContent = `Device already bound to ${result.boundWallet}`;
      } else {
        el.walletMessage.textContent = result.error || 'Wallet bound to another device';
      }
      el.walletMessage.classList.add('error');
      
      await checkDeviceBinding();
      el.walletInput.value = state.walletAddress;
    } else {
      throw new Error(result.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Register error:', error);
    el.walletMessage.textContent = error.message || 'Registration failed';
    el.walletMessage.classList.add('error');
  }
  
  el.saveWalletBtn.disabled = false;
}

async function toggleBrowsingPermission() {
  state.browsingEnabled = !state.browsingEnabled;
  
  const type = state.browsingEnabled ? 'ENABLE_BROWSING' : 'DISABLE_BROWSING';
  notifyBackground(type);
  
  await storage.set({ browsingEnabled: state.browsingEnabled });
  updateBrowsingUI();
}

function updateBrowsingUI() {
  if (state.browsingEnabled) {
    el.browsingPermBtn.textContent = 'Enabled';
    el.browsingPermBtn.classList.add('granted');
    el.browseHint.textContent = 'Tracking active';
    el.browseHint.classList.add('active');
  } else {
    el.browsingPermBtn.textContent = 'Enable';
    el.browsingPermBtn.classList.remove('granted');
    el.browseHint.textContent = 'Enable in Settings to track';
    el.browseHint.classList.remove('active');
  }
  
  if (state.browsingStats) {
    el.pagesVisited.textContent = state.browsingStats.pagesVisited || 0;
    el.domainsCount.textContent = state.browsingStats.domainsVisited?.length || 0;
    el.avgScroll.textContent = (state.browsingStats.avgScrollDepth || 0) + '%';
    
    const mins = Math.floor((state.browsingStats.totalTimeSpent || 0) / 60);
    if (mins >= 60) {
      el.browseTime.textContent = Math.floor(mins / 60) + 'h';
    } else {
      el.browseTime.textContent = mins + 'm';
    }
  }
}

function updateUI() {
  el.walletInput.value = state.walletAddress;
  el.tasksDone.textContent = state.tasksCompleted;
  
  if (state.isRegistered && state.walletAddress) {
    el.walletInput.disabled = true;
    el.walletInput.style.opacity = '0.7';
    el.saveWalletBtn.style.display = 'none';
    el.walletMessage.textContent = 'Wallet bound to this device';
    el.walletMessage.classList.remove('error');
    el.walletMessage.classList.add('success');
  } else {
    el.walletInput.disabled = false;
    el.walletInput.style.opacity = '1';
    el.saveWalletBtn.style.display = '';
  }
  
  if (state.locationGranted) {
    el.locationPermBtn.textContent = 'Granted';
    el.locationPermBtn.classList.add('granted');
  }
  
  if (state.isNodeOn && state.walletAddress) {
    el.nodeSection.classList.add('active');
    el.statusText.textContent = 'ACTIVE';
  }
  
  updateStatsUI();
  updateLocationUI();
  updateBrowsingUI();
  updateClaimUI();
}

function updateStatsUI() {
  const totalEarned = typeof state.serverBalance === 'number' ? state.serverBalance : 0;
  const todayEarned = typeof state.earnedToday === 'number' ? state.earnedToday : totalEarned;
  
  el.totalTokens.textContent = formatTokens(totalEarned, 2);
  el.todayTokens.textContent = formatTokens(todayEarned, 2);
  el.sessionTime.textContent = formatTime(state.onlineSeconds);
  el.computeScore.textContent = state.computeScore || '--';
  el.tasksDone.textContent = state.tasksCompleted;
}

function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatTokens(n, decimals = 6) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
  return n.toFixed(decimals);
}

function updateClaimUI() {
  const claimable = typeof state.serverBalance === 'number' ? state.serverBalance : 0;
  el.claimableAmount.textContent = claimable.toFixed(2);
  
  const canClaim = claimable >= CONFIG.minClaimAmount && state.walletAddress && state.isRegistered;
  el.claimBtn.disabled = !canClaim;
  
  if (!state.walletAddress) {
    el.claimBtnText.textContent = 'Set wallet first';
  } else if (!state.isRegistered) {
    el.claimBtnText.textContent = 'Register wallet';
  } else if (claimable < CONFIG.minClaimAmount) {
    const needed = Math.ceil(CONFIG.minClaimAmount - claimable);
    el.claimBtnText.textContent = `Need ${needed} more`;
  } else {
    el.claimBtnText.textContent = 'Claim Tokens';
  }
}

async function handleClaim() {
  if (el.claimBtn.disabled) return;
  
  const wallet = state.walletAddress;
  
  if (!wallet || !state.isRegistered || !deviceId) {
    alert('Please register your wallet first');
    return;
  }
  
  el.claimBtn.disabled = true;
  el.claimBtn.classList.add('loading');
  el.claimBtnText.textContent = 'Processing...';
  
  try {
    const response = await fetch(`${CONFIG.apiUrl}/api/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        walletAddress: wallet,
        deviceId: deviceId
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      state.serverBalance = result.newBalance;
      await saveState();
      
      el.claimBtn.classList.remove('loading');
      el.claimBtn.classList.add('success');
      el.claimBtnText.textContent = `Claimed ${result.amount.toFixed(2)} $Orius!`;
      
      updateStatsUI();
      updateClaimUI();
      
      setTimeout(async () => {
        el.claimBtn.classList.remove('success');
        await fetchBalance();
        updateClaimUI();
      }, 3000);
      
      if (result.explorerUrl) {
        setTimeout(() => {
          if (confirm('View transaction on Solscan?')) {
            window.open(result.explorerUrl, '_blank');
          }
        }, 500);
      }
    } else {
      throw new Error(result.error || 'Claim failed');
    }
  } catch (error) {
    console.error('Claim error:', error);
    el.claimBtn.classList.remove('loading');
    el.claimBtnText.textContent = 'Failed - Retry';
    
    setTimeout(() => updateClaimUI(), 3000);
    
    alert('Claim failed: ' + error.message);
  }
}
