const REMINDER_TIME = { hour: 08, minute: 15 }; // 8:15 AM

let currentEmotion = null;
let responses = {};
let usedResponseIndices = {}; // Responses shown

document.addEventListener('DOMContentLoaded', async () => {
  // Load
  await loadResponses();
  
  // UI
  initialiseTabs();
  initialiseEmojiButtons();
  initialiseResponseButtons();
  initialiseSettings();
  initialiseFeedback();
  initialiseThemeSwitcher();
  
  // Update streak
  await updateStreakDisplay();
  
  // saved settings
  await loadSettings();
});

async function loadResponses() {
  try {
    const response = await fetch('responses.json');
    responses = await response.json();
  } catch (error) {
    console.error('Failed to load responses:', error);
    // Fallback 
    responses = {
      happy: {
        validations: ["You're in a good place right now!"],
        microActions: { daytime: ["Share your happiness with someone!"], evening: ["Reflect on what made you happy today."] }
      }
    };
  }
}

function getAnonId(callback) {
  chrome.storage.local.get('anonId', (res) => {
    if (res.anonId) {
      return callback(res.anonId);
    }
    
    const id = 'rvhs-' + crypto.randomUUID();
    chrome.storage.local.set({ anonId: id }, () => callback(id));
  });
}

// ===== TIME-AWARE =====
function getTimeOfDay() {
  const hour = new Date().getHours();
  // Evening: 6pm (18:00) - 11pm (23:00)
  // Daytime: Everyth else
  return (hour >= 18 && hour < 23) ? 'evening' : 'daytime';
}

function initialiseTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      
      const tabName = tab.getAttribute('data-tab');
      const content = document.getElementById(`${tabName}-tab`);
      if (content) {
        content.classList.add('active');
      }
      
      // Reset to emoji screen
      if (tabName === 'home') {
        showEmojiScreen();
      }
    });
    
    // Keyboard
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tab.click();
      }
    });
  });
}

function initialiseEmojiButtons() {
  const emojiButtons = document.querySelectorAll('.emoji-btn');
  
  emojiButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const emotion = btn.getAttribute('data-emotion');
      await handleEmotionSelection(emotion);
    });
  });
}

async function handleEmotionSelection(emotion) {
  currentEmotion = emotion;
  
  // Reset used responses for this emotion
  usedResponseIndices[emotion] = usedResponseIndices[emotion] || { validations: [], microActions: [] };
  showResponseCard(emotion);
  
  //(don't await)
  logMood(emotion).catch(err => console.error('Failed to log mood:', err));
  
  await updateStreak();
}

function showResponseCard(emotion) {
  const emojiScreen = document.getElementById('emojiScreen');
  const responseScreen = document.getElementById('responseScreen');
  
  emojiScreen.classList.add('hidden');
  responseScreen.classList.remove('hidden');
  
  // random response
  displayRandomResponse(emotion);
}

function displayRandomResponse(emotion) {
  const emotionData = responses[emotion];
  if (!emotionData) return;
  
  const timeOfDay = getTimeOfDay();
  
  const validationIndex = getRandomIndex(
    emotionData.validations.length,
    usedResponseIndices[emotion].validations
  );
  usedResponseIndices[emotion].validations.push(validationIndex);
  
  // Random action
  const microActions = emotionData.microActions[timeOfDay] || emotionData.microActions.daytime;
  const actionIndex = getRandomIndex(
    microActions.length,
    usedResponseIndices[emotion].microActions
  );
  usedResponseIndices[emotion].microActions.push(actionIndex);
  
  // Reset if used all
  if (usedResponseIndices[emotion].validations.length >= emotionData.validations.length) {
    usedResponseIndices[emotion].validations = [];
  }
  if (usedResponseIndices[emotion].microActions.length >= microActions.length) {
    usedResponseIndices[emotion].microActions = [];
  }
  
  // Disp
  const validation = emotionData.validations[validationIndex];
  const microAction = microActions[actionIndex];
  
  document.getElementById('validationText').textContent = validation;
  document.getElementById('microActionText').textContent = microAction;
}

function getRandomIndex(max, usedIndices) {
  const available = [];
  for (let i = 0; i < max; i++) {
    if (!usedIndices.includes(i)) {
      available.push(i);
    }
  }
  
  if (available.length === 0) {
    // All used, return any random
    return Math.floor(Math.random() * max);
  }
  
  return available[Math.floor(Math.random() * available.length)];
}

function showEmojiScreen() {
  const emojiScreen = document.getElementById('emojiScreen');
  const responseScreen = document.getElementById('responseScreen');
  
  emojiScreen.classList.remove('hidden');
  responseScreen.classList.add('hidden');
}

//Buttons
function initialiseResponseButtons() {
  const tryThisBtn = document.getElementById('tryThisBtn');
  const anotherIdeaBtn = document.getElementById('anotherIdeaBtn');
  
  tryThisBtn.addEventListener('click', () => {
    // Close the popup
    window.close();
  });
  
  anotherIdeaBtn.addEventListener('click', () => {
    if (currentEmotion) {
      displayRandomResponse(currentEmotion);
    }
  });
}

// LOGGING TO SHEETS
async function logMood(mood) {
  return new Promise((resolve, reject) => {
    getAnonId(async (anonId) => {
      try {
        const payload = {
          mood: mood,
          anonId: anonId,
          timestamp: new Date().toISOString()
        };
        
        chrome.runtime.sendMessage({ type: 'LOG_DATA', payload }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to log mood:', chrome.runtime.lastError.message);
            queueFailedRequest('mood', { mood, anonId, timestamp: new Date().toISOString() });
            reject(chrome.runtime.lastError);
          } else {
            console.log('Mood logged successfully');
            resolve();
          }
        });
      } catch (error) {
        console.error('Failed to log mood:', error);
        queueFailedRequest('mood', { mood, anonId, timestamp: new Date().toISOString() });
        reject(error);
      }
    });
  });
}

async function logFeedback(text) {
  return new Promise((resolve, reject) => {
    getAnonId(async (anonId) => {
      try {
        const payload = {
          type: 'feedback',
          text: text,
          anonId: anonId,
          timestamp: new Date().toISOString()
        };
        
        chrome.runtime.sendMessage({ type: 'LOG_DATA', payload }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to log feedback:', chrome.runtime.lastError.message);
            queueFailedRequest('feedback', { text, anonId, timestamp: new Date().toISOString() });
            reject(chrome.runtime.lastError);
          } else {
            console.log('Feedback logged successfully');
            resolve();
          }
        });
      } catch (error) {
        console.error('Failed to log feedback:', error);
        queueFailedRequest('feedback', { text, anonId, timestamp: new Date().toISOString() });
        reject(error);
      }
    });
  });
}

function queueFailedRequest(type, data) {
  chrome.storage.local.get(['failedRequests'], (res) => {
    const queue = res.failedRequests || [];
    queue.push({ type, data, timestamp: Date.now() });
    chrome.storage.local.set({ failedRequests: queue });
  });
}

// Streak
async function updateStreak() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastCheckIn', 'streak'], (res) => {
      const todayStr = new Date().toDateString();
      const lastCheckIn = res.lastCheckIn;
      let streak = res.streak || 0;
      
      if (lastCheckIn) {
        const lastDate = new Date(lastCheckIn);
        const today = new Date();
        // Compare calendar days, not raw ms diff
        const lastMidnight = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
        const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const dayDiff = Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24));
        
        if (dayDiff === 0) {
          // Same day, no change
        } else if (dayDiff === 1) {
          // Consecutive day
          streak++;
        } else {
          // Streak broken — missed one or more days, reset to 1 for today
          streak = 1;
        }
      } else {
        // First check-in
        streak = 1;
      }
      
      chrome.storage.local.set({ lastCheckIn: todayStr, streak: streak }, () => {
        updateStreakDisplay();
        resolve();
      });
    });
  });
}

async function updateStreakDisplay() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['streak'], (res) => {
      const streak = res.streak || 0;
      const streakEl = document.getElementById('streakDisplay');
      const streakText = document.querySelector('.streak-text');
      
      if (streak > 0) {
        // Show streak
        if (streakEl) streakEl.style.display = 'flex';
        if (streakText) {
          streakText.textContent = `${streak} day${streak !== 1 ? 's' : ''} streak`;
        }
      } else {
        // Hide streak entirely when it's 0
        if (streakEl) streakEl.style.display = 'none';
      }
      resolve();
    });
  });
}

function initialiseSettings() {
  const reminderToggleBtn = document.getElementById('reminderToggleBtn');
  const reminderCheckbox = document.getElementById('reminderToggle');
  
  // Reminder liquid toggle
  if (reminderToggleBtn) {
    reminderToggleBtn.addEventListener('click', async () => {
      const isChecked = reminderToggleBtn.getAttribute('aria-checked') === 'true';
      const newState = !isChecked;
      
      reminderToggleBtn.setAttribute('aria-checked', String(newState));
      if (reminderCheckbox) reminderCheckbox.checked = newState;
      
      await chrome.storage.local.set({ dailyReminder: newState });
      
      if (newState) {
        // Alarm
        chrome.alarms.create('dailyReminder', {
          when: getNextReminderTime(),
          periodInMinutes: 24 * 60 // Every day
        });
      } else {
        // Clear alarm
        chrome.alarms.clear('dailyReminder');
      }
    });
  }
}

// Theme switcher pill — tracks previous selection for animation
function initialiseThemeSwitcher() {
  const switcher = document.querySelector('.switcher');
  if (!switcher) return;

  const radios = switcher.querySelectorAll('input[type="radio"]');
  let previousValue = null;

  const initiallyChecked = switcher.querySelector('input[type="radio"]:checked');
  if (initiallyChecked) {
    previousValue = initiallyChecked.getAttribute('c-option');
    switcher.setAttribute('c-previous', previousValue);
  }

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        switcher.setAttribute('c-previous', previousValue ?? '');
        previousValue = radio.getAttribute('c-option');

        // Map radio value to theme name and apply
        const themeMap = { '1': 'glass', '2': 'light', '3': 'dark' };
        const theme = themeMap[previousValue] || 'glass';
        applyTheme(theme);
        chrome.storage.local.set({ theme: theme });
      }
    });
  });
}

function getNextReminderTime() {
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    REMINDER_TIME.hour,
    REMINDER_TIME.minute,
    0
  );
  
  // If time has passed today, set for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  return next.getTime();
}

function applyTheme(theme) {
  // Remove all theme classes
  document.body.classList.remove('theme-glass', 'theme-light', 'theme-dark');
  
  // Apply new theme
  if (theme === 'light') {
    document.body.classList.add('theme-light');
  } else if (theme === 'dark') {
    document.body.classList.add('theme-dark');
  }

  // Sync the switcher pill radio to match
  const themeToOption = { glass: '1', light: '2', dark: '3' };
  const optionVal = themeToOption[theme] || '1';
  const switcher = document.querySelector('.switcher');
  if (switcher) {
    const radio = switcher.querySelector(`input[c-option="${optionVal}"]`);
    if (radio) radio.checked = true;
  }
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyReminder', 'theme'], (res) => {
      // Load reminder setting
      const reminderToggleBtn = document.getElementById('reminderToggleBtn');
      const reminderCheckbox = document.getElementById('reminderToggle');
      const enabled = res.dailyReminder || false;
      if (reminderToggleBtn) {
        reminderToggleBtn.setAttribute('aria-checked', String(enabled));
      }
      if (reminderCheckbox) {
        reminderCheckbox.checked = enabled;
      }
      
      // Load theme settings
      const theme = res.theme || 'glass';
      applyTheme(theme);
      
      resolve();
    });
  });
}

//  FEEDBACK 
function initialiseFeedback() {
  const submitBtn = document.getElementById('submitFeedback');
  const feedbackText = document.getElementById('feedbackText');
  const successMessage = document.getElementById('feedbackSuccess');
  
  submitBtn.addEventListener('click', async () => {
    const text = feedbackText.value.trim();
    
    if (!text) {
      return;
    }
    
    // Disable button during submission
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    
    try {
      await logFeedback(text);
      
      // success message
      successMessage.classList.remove('hidden');
      feedbackText.value = '';
      
      // Hide success message after 2 s
      setTimeout(() => {
        successMessage.classList.add('hidden');
      }, 2000);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      // Still show success (it's queued for retry)
      successMessage.classList.remove('hidden');
      feedbackText.value = '';
      
      setTimeout(() => {
        successMessage.classList.add('hidden');
      }, 2000);
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback';
    }
  });
}