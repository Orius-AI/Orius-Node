/**
 * Orius Content Script
 * Collects browsing activity data with user permission
 * Developed by Orius Team
 */

(function() {
  let pageStartTime = Date.now();
  let scrollDepth = 0;
  let clickCount = 0;
  let isActive = true;

  function getScrollDepth() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / docHeight) * 100));
  }

  function trackScroll() {
    const depth = getScrollDepth();
    if (depth > scrollDepth) {
      scrollDepth = depth;
    }
  }

  function trackClick() {
    clickCount++;
  }

  function trackVisibility() {
    isActive = !document.hidden;
  }

  function sendActivityData() {
    const timeSpent = Math.round((Date.now() - pageStartTime) / 1000);
    
    const data = {
      type: 'BROWSING_ACTIVITY',
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title,
      timeSpent: timeSpent,
      scrollDepth: scrollDepth,
      clickCount: clickCount,
      timestamp: Date.now()
    };

    try {
      chrome.runtime.sendMessage(data);
    } catch (e) {
    }
  }

  window.addEventListener('scroll', trackScroll, { passive: true });
  document.addEventListener('click', trackClick);
  document.addEventListener('visibilitychange', trackVisibility);

  setInterval(() => {
    if (isActive) {
      sendActivityData();
    }
  }, 30000);

  window.addEventListener('beforeunload', sendActivityData);

  sendActivityData();
})();
