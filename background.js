// github.com/Kvin-21/rv_wellbeing_extension

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz9ChaWlEP6e7KlOr8XYF_z5KhNZNpNnNgx3QZ9ilPqRyBIKxKvBi_3raK9Vu7Oj19v/exec';

chrome.runtime.onInstalled.addListener(() => {
  console.log('River Valley Wellbeing extension installed');
  
  // Initialise default
  chrome.storage.local.get(['dailyReminder'], (res) => {
    if (res.dailyReminder === undefined) {
      chrome.storage.local.set({ dailyReminder: false });
    }
  });
});

// Handle data logging messages from popup — all fetch calls live here
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_DATA') {
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload)
    })
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('Background fetch failed:', err);
        sendResponse({ success: false });
      });
    return true; // keep message channel open for async response
  }
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
    // Clear notif
    chrome.notifications.clear(notificationId);

    // Focus existing window then open popup; fallback to a popup window
    chrome.windows.getAll({ populate: true }, (windows) => {
      if (windows.length > 0) {
        chrome.windows.update(windows[0].id, { focused: true }, () => {
          chrome.action.openPopup().catch(() => {
            chrome.windows.create({
              url: chrome.runtime.getURL('popup.html'),
              type: 'popup',
              width: 380,
              height: 560
            });
          });
        });
      } else {
        chrome.windows.create({
          url: chrome.runtime.getURL('popup.html'),
          type: 'popup',
          width: 380,
          height: 560
        });
      }
    });
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