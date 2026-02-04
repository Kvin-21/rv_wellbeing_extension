
chrome.runtime.onInstalled.addListener(() => {
  console.log('River Valley Wellbeing extension installed');
  
  // Initialise default
  chrome.storage.local.get(['dailyReminder'], (res) => {
    if (res.dailyReminder === undefined) {
      chrome.storage.local.set({ dailyReminder: false });
    }
  });
});

// (daily reminders)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReminder') {
    showDailyReminder();
  }
});

// Show notif
function showDailyReminder() {
  chrome.notifications.create('dailyCheckIn', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '💙 River Valley Wellbeing',
    message: 'How are you feeling today? Take a moment to check in with yourself!',
    priority: 2,
    requireInteraction: false
  });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'dailyCheckIn') {
    chrome.windows.getCurrent((window) => {
      chrome.action.openPopup();
    });
    
    // Clear notif
    chrome.notifications.clear(notificationId);
  }
});

// Retry failed requests on startup
chrome.runtime.onStartup.addListener(() => {
  retryFailedRequests();
});

async function retryFailedRequests() {
  chrome.storage.local.get(['failedRequests'], async (res) => {
    const queue = res.failedRequests || [];
    
    if (queue.length === 0) return;
    
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz9ChaWlEP6e7KlOr8XYF_z5KhNZNpNnNgx3QZ9ilPqRyBIKxKvBi_3raK9Vu7Oj19v/exec';
    const successfulRequests = [];
    
    for (let i = 0; i < queue.length; i++) {
      const request = queue[i];
      
      try {
        let payload;
        if (request.type === 'mood') {
          payload = {
            mood: request.data.mood,
            anonId: request.data.anonId,
            timestamp: request.data.timestamp
          };
        } else if (request.type === 'feedback') {
          payload = {
            type: 'feedback',
            text: request.data.text,
            anonId: request.data.anonId,
            timestamp: request.data.timestamp
          };
        }
        
        await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });
        
        successfulRequests.push(i);
      } catch (error) {
        console.error('Retry failed for request:', error);
      }
    }
    
    // Remove successful requests from queue
    const remainingQueue = queue.filter((_, index) => !successfulRequests.includes(index));
    chrome.storage.local.set({ failedRequests: remainingQueue });
  });
}