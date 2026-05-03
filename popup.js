const REMINDER_TIME = { hour: 8, minute: 15 };
const FOCUS_DURATION_MS = 25 * 60 * 1000;
const BREAK_DURATION_MS = 5 * 60 * 1000;
const URGENCY_THRESHOLD_MS = 60 * 1000;
const REWARD_ANIMATION_DURATION_MS = 2600;

const MASCOT_BLINK_INTERVAL_MS = 30000;
const MASCOT_CORNER_PAUSE_MS = 1200;
const MASCOT_IDLE_SWAP_MIN_MS = 5000;
const MASCOT_IDLE_SWAP_MAX_MS = 9000;
const MASCOT_IDLE_SWAP_TRANSITION_MS = 520;

const OPEN_INTENT_MAX_AGE_MS = 5000;
const MASCOT_SIZE_PX = 68;
const MASCOT_EDGE_PADDING_PX = 4;
const MASCOT_ROAM_MIN_Y = 6;
const MASCOT_ROAM_MAX_Y = 22;
const MASCOT_SPEED_MIN = 14;
const MASCOT_SPEED_MAX = 22;
const MASCOT_FRAME_MIN_MS = 12;
const MASCOT_FRAME_MAX_MS = 48;
const POPUP_WIDTH_PX = 360;
const BUBBLE_MAX_WIDTH_PX = 180;
const BUBBLE_EDGE_PADDING_PX = 8;
const BUBBLE_VERTICAL_GAP_PX = 10;
const BUBBLE_TAIL_EDGE_MIN_PX = 18;
const CLOCK_SVG_CENTER = 100;
const CLOCK_RING_RADIUS = 84;
const CLOCK_RING_CIRCUMFERENCE = 2 * Math.PI * CLOCK_RING_RADIUS;
const MIN_STROKE_DASH = 0.0001;

let currentEmotion = null;
let responses = {};
let usedResponseIndices = {};

let pomodoroTick = null;
let mascotController = null;
let pomodoroState = {
  mode: 'focus',
  running: false,
  endAt: null,
  remainingMs: FOCUS_DURATION_MS,
  totalMs: FOCUS_DURATION_MS,
  sessionsCompleted: 0,
  treats: 0,
  rewardPending: false
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadResponses();

  await initialiseTabs();
  initialiseEmojiButtons();
  initialiseResponseButtons();
  initialiseSettings();
  initialiseFeedback();
  initialiseThemePalette();
  initialiseMascotOrb();

  await updateStreakDisplay();
  await loadSettings();

  await initialisePomodoro();
});

async function loadResponses() {
  try {
    const response = await fetch('responses.json');
    responses = await response.json();
  } catch (error) {
    console.error('Failed to load responses:', error);
    responses = {
      happy: {
        validations: ["You're in a good place right now!"],
        microActions: {
          daytime: ['Share your happiness with someone!'],
          evening: ['Reflect on what made you happy today.']
        }
      }
    };
  }
}

function getAnonId(callback) {
  chrome.storage.local.get('anonId', (res) => {
    if (res.anonId) {
      callback(res.anonId);
      return;
    }

    const id = 'rvhs-' + crypto.randomUUID();
    chrome.storage.local.set({ anonId: id }, () => callback(id));
  });
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  return (hour >= 18 && hour < 23) ? 'evening' : 'daytime';
}

async function initialiseTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  const activateTab = (tabName, persist = true) => {
    const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const content = document.getElementById(`${tabName}-tab`);
    if (!tab || !content) return;

    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tabContents.forEach(tc => tc.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    content.classList.add('active');

    if (tabName === 'home') showEmojiScreen();
    if (persist) setStorage({ activeTab: tabName });
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      activateTab(tabName, true);
    });

    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tab.click();
      }
    });
  });

  const stored = await getStorage(['activeTab', 'openIntent']);
  const intent = stored.openIntent;
  const hasHomeIntent = intent?.tab === 'home'
    && typeof intent.timestamp === 'number'
    && (Date.now() - intent.timestamp) <= OPEN_INTENT_MAX_AGE_MS;

  if (hasHomeIntent) {
    await setStorage({ openIntent: null, activeTab: 'home' });
    activateTab('home', false);
    return;
  }

  if (intent?.tab === 'home') {
    setStorage({ openIntent: null });
  }

  const restoreTab = typeof stored.activeTab === 'string' ? stored.activeTab : 'home';
  activateTab(restoreTab, false);
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
  usedResponseIndices[emotion] = usedResponseIndices[emotion] || { validations: [], microActions: [] };
  showResponseCard(emotion);
  mascotController?.reactToMood?.(emotion);

  logMood(emotion).catch(err => console.error('Failed to log mood:', err));
  await updateStreak();
}

function showResponseCard(emotion) {
  const emojiScreen = document.getElementById('emojiScreen');
  const responseScreen = document.getElementById('responseScreen');

  emojiScreen.classList.add('hidden');
  responseScreen.classList.remove('hidden');
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

  const microActions = emotionData.microActions[timeOfDay] || emotionData.microActions.daytime;
  const actionIndex = getRandomIndex(
    microActions.length,
    usedResponseIndices[emotion].microActions
  );
  usedResponseIndices[emotion].microActions.push(actionIndex);

  if (usedResponseIndices[emotion].validations.length >= emotionData.validations.length) {
    usedResponseIndices[emotion].validations = [];
  }
  if (usedResponseIndices[emotion].microActions.length >= microActions.length) {
    usedResponseIndices[emotion].microActions = [];
  }

  document.getElementById('validationText').textContent = emotionData.validations[validationIndex];
  document.getElementById('microActionText').textContent = microActions[actionIndex];
}

function getRandomIndex(max, usedIndices) {
  const available = [];
  for (let i = 0; i < max; i++) {
    if (!usedIndices.includes(i)) available.push(i);
  }

  if (available.length === 0) return Math.floor(Math.random() * max);
  return available[Math.floor(Math.random() * available.length)];
}

function showEmojiScreen() {
  const emojiScreen = document.getElementById('emojiScreen');
  const responseScreen = document.getElementById('responseScreen');

  emojiScreen.classList.remove('hidden');
  responseScreen.classList.add('hidden');
}

function initialiseResponseButtons() {
  const tryThisBtn = document.getElementById('tryThisBtn');
  const anotherIdeaBtn = document.getElementById('anotherIdeaBtn');

  tryThisBtn.addEventListener('click', () => {
    window.close();
  });

  anotherIdeaBtn.addEventListener('click', () => {
    if (currentEmotion) displayRandomResponse(currentEmotion);
  });
}

async function logMood(mood) {
  return new Promise((resolve, reject) => {
    getAnonId(async (anonId) => {
      try {
        const payload = {
          mood,
          anonId,
          timestamp: new Date().toISOString()
        };

        chrome.runtime.sendMessage({ type: 'LOG_DATA', payload }, () => {
          if (chrome.runtime.lastError) {
            queueFailedRequest('mood', { mood, anonId, timestamp: new Date().toISOString() });
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (error) {
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
          text,
          anonId,
          timestamp: new Date().toISOString()
        };

        chrome.runtime.sendMessage({ type: 'LOG_DATA', payload }, () => {
          if (chrome.runtime.lastError) {
            queueFailedRequest('feedback', { text, anonId, timestamp: new Date().toISOString() });
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (error) {
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

async function updateStreak() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastCheckIn', 'streak'], (res) => {
      const todayStr = new Date().toDateString();
      const lastCheckIn = res.lastCheckIn;
      let streak = res.streak || 0;

      if (lastCheckIn) {
        const lastDate = new Date(lastCheckIn);
        const today = new Date();
        const lastMidnight = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
        const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const dayDiff = Math.round((todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24));

        if (dayDiff === 1) {
          streak++;
        } else if (dayDiff > 1) {
          streak = 1;
        }
      } else {
        streak = 1;
      }

      chrome.storage.local.set({ lastCheckIn: todayStr, streak }, () => {
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
        if (streakEl) streakEl.style.display = 'flex';
        if (streakText) streakText.textContent = `${streak} day${streak !== 1 ? 's' : ''} streak`;
      } else {
        if (streakEl) streakEl.style.display = 'none';
      }
      resolve();
    });
  });
}

function initialiseSettings() {
  const reminderToggleBtn = document.getElementById('reminderToggleBtn');
  const reminderCheckbox = document.getElementById('reminderToggle');

  if (reminderToggleBtn) {
    const animateToggle = async () => {
      const isChecked = reminderToggleBtn.getAttribute('aria-checked') === 'true';
      const next = !isChecked;

      reminderToggleBtn.dataset.pressed = 'true';

      await new Promise(r => setTimeout(r, 180));

      const from = isChecked ? 100 : 0;
      const to = next ? 100 : 0;
      const duration = 120;
      const start = performance.now();

      await new Promise(resolve => {
        const tick = (now) => {
          const elapsed = now - start;
          const t = Math.min(elapsed / duration, 1);
          const val = from + (to - from) * t;
          reminderToggleBtn.style.setProperty('--complete', val);
          if (t < 1) {
            requestAnimationFrame(tick);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(tick);
      });

      await new Promise(r => setTimeout(r, 50));
      reminderToggleBtn.dataset.active = 'false';
      reminderToggleBtn.dataset.pressed = 'false';
      reminderToggleBtn.setAttribute('aria-checked', String(next));
      if (reminderCheckbox) reminderCheckbox.checked = next;

      await setStorage({ dailyReminder: next });

      if (next) {
        chrome.alarms.create('dailyReminder', {
          when: getNextReminderTime(),
          periodInMinutes: 24 * 60
        });
      } else {
        chrome.alarms.clear('dailyReminder');
      }
    };

    reminderToggleBtn.addEventListener('click', () => {
      reminderToggleBtn.dataset.active = 'true';
      animateToggle();
    });
  }
}

function initialiseThemePalette() {
  const radios = document.querySelectorAll('input[name="theme-choice"]');

  radios.forEach(radio => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      const theme = radio.value;
      applyTheme(theme);
      await setStorage({ theme });
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

  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function applyTheme(theme) {
  document.body.classList.remove(
    'theme-glass',
    'theme-light',
    'theme-dark',
    'theme-sunset',
    'theme-ocean',
    'theme-grape'
  );

  document.body.classList.add(`theme-${theme}`);

  const radio = document.querySelector(`input[name="theme-choice"][value="${theme}"]`);
  if (radio) radio.checked = true;
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['dailyReminder', 'theme'], (res) => {
      const reminderToggleBtn = document.getElementById('reminderToggleBtn');
      const reminderCheckbox = document.getElementById('reminderToggle');
      const enabled = res.dailyReminder || false;

      if (reminderToggleBtn) {
        reminderToggleBtn.setAttribute('aria-checked', String(enabled));
        reminderToggleBtn.style.setProperty('--complete', enabled ? 100 : 0);
      }
      if (reminderCheckbox) reminderCheckbox.checked = enabled;

      const theme = res.theme || 'glass';
      applyTheme(theme);

      resolve();
    });
  });
}

function initialiseFeedback() {
  const submitBtn = document.getElementById('submitFeedback');
  const feedbackText = document.getElementById('feedbackText');
  const successMessage = document.getElementById('feedbackSuccess');

  submitBtn.addEventListener('click', async () => {
    const text = feedbackText.value.trim();
    if (!text) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      await logFeedback(text);
      successMessage.classList.remove('hidden');
      feedbackText.value = '';
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      successMessage.classList.remove('hidden');
      feedbackText.value = '';
    } finally {
      setTimeout(() => successMessage.classList.add('hidden'), 2000);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback';
    }
  });
}

function initialiseMascotOrb() {
  const orb = document.getElementById('mascotOrb');
  const pop = document.getElementById('mascotPop');
  const stateImages = Array.from(document.querySelectorAll('.mascot-orb-img'));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let bubbleFollowFrame = null;

  const idleLines = [
    'Yawn~😴',
    'Zzz...',
    'Psst... hello!👋',
    'Hmm~💭'
  ];
  const studyLines = [
    'Focused!',
    'You\'ve got this!',
    'Keep going~🎯'
  ];
  const breakLines = [
    'Break time!',
    'Recharging~🔋',
    'Breathe...😌'
  ];

  // keep last shown bubble index per state to avoid immediate repeats
  const lastBubbleIndex = { idle: -1, study: -1, break: -1 };

  const bounds = {
    minX: MASCOT_EDGE_PADDING_PX,
    minY: MASCOT_ROAM_MIN_Y,
    maxX: POPUP_WIDTH_PX - MASCOT_SIZE_PX - MASCOT_EDGE_PADDING_PX,
    maxY: MASCOT_ROAM_MAX_Y
  };
  const corners = [
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY }
  ];

  const mascot = {
    state: 'idle',
    visualState: 'idle',
    idlePose: 'idle',
    x: bounds.maxX,
    y: bounds.minY,
    cornerIndex: 0,
    targetX: bounds.maxX,
    targetY: bounds.minY,
    speed: MASCOT_SPEED_MIN,
    pauseUntil: 0,
    lastPoseSwitchAt: Date.now(),
    lastTickAt: performance.now(),
    animFrame: null,
    moodEnterTimer: null,
    moodExitTimer: null,
    moodActive: false,
    idleSwapTimer: null
  };

  const applyPosition = () => {
    orb.style.setProperty('--orb-x', `${mascot.x.toFixed(2)}px`);
    orb.style.setProperty('--orb-y', `${mascot.y.toFixed(2)}px`);
  };

  const applyStateVisual = (nextState, visualState = nextState) => {
    mascot.state = nextState;
    mascot.visualState = visualState;
    stateImages.forEach(img => img.classList.toggle('active', img.dataset.state === visualState));
    orb.classList.toggle('state-study', nextState === 'study');
    orb.classList.toggle('state-break', nextState === 'break');
    orb.classList.toggle('state-reward', nextState === 'reward' || nextState === 'celebrate');
    orb.classList.toggle('state-idle-variant', nextState === 'idle' && visualState === 'celebrate');
    
    if (nextState !== 'idle' && mascot.idleSwapTimer) {
      clearTimeout(mascot.idleSwapTimer);
      mascot.idleSwapTimer = null;
    }
  };

  const setIdlePose = (pose) => {
    mascot.idlePose = pose;
    applyStateVisual('idle', pose);
  };

  const scheduleIdleSwap = () => {
    if (prefersReducedMotion) return;
    if (mascot.idleSwapTimer) clearTimeout(mascot.idleSwapTimer);
    const delay = MASCOT_IDLE_SWAP_MIN_MS
      + Math.random() * (MASCOT_IDLE_SWAP_MAX_MS - MASCOT_IDLE_SWAP_MIN_MS);
    mascot.idleSwapTimer = setTimeout(() => {
      if (mascot.state === 'idle' && !mascot.moodActive) {
        let nextPose;
        if (mascot.idlePose === 'celebrate') {
          nextPose = 'idle';
        } else {
          nextPose = Math.random() < 0.30 ? 'celebrate' : 'idle';
        }
        if (nextPose !== mascot.idlePose) {
          orb.classList.add('idling-swap');
          setIdlePose(nextPose);
          setTimeout(() => orb.classList.remove('idling-swap'), MASCOT_IDLE_SWAP_TRANSITION_MS);
        }
      }
      scheduleIdleSwap();
    }, delay);
  };

  const updateBubblePosition = () => {
    if (pop.classList.contains('hidden')) return;
    const bubbleWidth = pop.offsetWidth || BUBBLE_MAX_WIDTH_PX;
    const bubbleHeight = pop.offsetHeight || 42;
    const centreX = mascot.x + (MASCOT_SIZE_PX / 2) + 14;
    const orbTopEdge = mascot.y;
    const isLower = mascot.y > ((bounds.minY + bounds.maxY) / 2);
    pop.style.setProperty('--bubble-body-shift-x', isLower ? '4px' : '2px');
    const bubbleLeft = Math.min(
      Math.max(centreX - (bubbleWidth / 2), BUBBLE_EDGE_PADDING_PX),
      POPUP_WIDTH_PX - bubbleWidth - BUBBLE_EDGE_PADDING_PX
    );
    const tailX = Math.min(
      Math.max(centreX - bubbleLeft, BUBBLE_TAIL_EDGE_MIN_PX),
      bubbleWidth - BUBBLE_TAIL_EDGE_MIN_PX
    );
    const bubbleTop = isLower
      ? orbTopEdge - bubbleHeight - BUBBLE_VERTICAL_GAP_PX - 42
      : orbTopEdge + MASCOT_SIZE_PX + BUBBLE_VERTICAL_GAP_PX;
    const clampedTop = Math.max(bubbleTop, BUBBLE_EDGE_PADDING_PX);
    pop.classList.toggle('bubble-up', isLower);
    pop.classList.toggle('bubble-down', !isLower);
    pop.style.setProperty('--bubble-tail-x', `${tailX.toFixed(1)}px`);
    pop.style.left = `${bubbleLeft.toFixed(1)}px`;
    pop.style.top = `${clampedTop.toFixed(1)}px`;
  };

  const startBubbleFollow = () => {
    if (bubbleFollowFrame) return;
    const follow = () => {
      if (pop.classList.contains('hidden')) {
        bubbleFollowFrame = null;
        return;
      }
      updateBubblePosition();
      bubbleFollowFrame = requestAnimationFrame(follow);
    };
    bubbleFollowFrame = requestAnimationFrame(follow);
  };

  const stopBubbleFollow = () => {
    if (!bubbleFollowFrame) return;
    cancelAnimationFrame(bubbleFollowFrame);
    bubbleFollowFrame = null;
  };

  const showBubble = (text) => {
    const textEl = document.getElementById('mascotPopText');
    if (textEl) textEl.textContent = text;
    pop.style.right = 'auto';
    pop.classList.remove('hidden');
    requestAnimationFrame(() => {
      updateBubblePosition();
      pop.classList.add('show');
      startBubbleFollow();
    });

    setTimeout(() => {
      pop.classList.remove('show');
      setTimeout(() => {
        pop.classList.add('hidden');
        stopBubbleFollow();
      }, 300);
    }, 2200);
  };

  // pick the next roam destination — mix of corners and random edge points
  const pickNextDest = () => {
    if (Math.random() < 0.55) {
      mascot.cornerIndex = (mascot.cornerIndex + 1) % corners.length;
      mascot.targetX = corners[mascot.cornerIndex].x;
      mascot.targetY = corners[mascot.cornerIndex].y;
    } else {
      const edge = Math.floor(Math.random() * 4);
      const randX = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const randY = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      switch (edge) {
        case 0: mascot.targetX = randX;        mascot.targetY = bounds.minY; break;
        case 1: mascot.targetX = bounds.maxX;  mascot.targetY = randY;       break;
        case 2: mascot.targetX = randX;        mascot.targetY = bounds.maxY; break;
        default: mascot.targetX = bounds.minX; mascot.targetY = randY;       break;
      }
    }
    mascot.speed = MASCOT_SPEED_MIN + Math.random() * (MASCOT_SPEED_MAX - MASCOT_SPEED_MIN);
  };

  const tickRoam = (frameTime) => {
    if (prefersReducedMotion || mascot.state === 'break') {
      mascot.lastTickAt = frameTime || performance.now();
      mascot.animFrame = requestAnimationFrame(tickRoam);
      return;
    }

    const now = Date.now();
    const tickAt = frameTime || performance.now();
    const frameDelta = tickAt - mascot.lastTickAt;
    const deltaMs = Math.max(MASCOT_FRAME_MIN_MS, Math.min(MASCOT_FRAME_MAX_MS, frameDelta));
    mascot.lastTickAt = tickAt;
    if (mascot.pauseUntil > now) {
      updateBubblePosition();
      mascot.animFrame = requestAnimationFrame(tickRoam);
      return;
    }

    if (now - mascot.lastPoseSwitchAt > MASCOT_BLINK_INTERVAL_MS) {
      orb.classList.add('blink');
      mascot.lastPoseSwitchAt = now;
    }

    const dx = mascot.targetX - mascot.x;
    const dy = mascot.targetY - mascot.y;
    const distance = Math.hypot(dx, dy);

    const step = mascot.speed * (deltaMs / 1000);
    if (distance <= step) {
      mascot.x = mascot.targetX;
      mascot.y = mascot.targetY;
      const isCorner = corners.some(c => Math.abs(c.x - mascot.targetX) < 1 && Math.abs(c.y - mascot.targetY) < 1);
      mascot.pauseUntil = now + (isCorner
        ? MASCOT_CORNER_PAUSE_MS + Math.random() * 400
        : 180 + Math.random() * 360);
      pickNextDest();
      applyPosition();
      updateBubblePosition();
      mascot.animFrame = requestAnimationFrame(tickRoam);
      return;
    }

    mascot.x += (dx / distance) * step;
    mascot.y += (dy / distance) * step;
    applyPosition();
    updateBubblePosition();
    mascot.animFrame = requestAnimationFrame(tickRoam);
  };

  // autonomous thought bubbles — random interval between 25-45 s
  const scheduleNextBubble = () => {
    const delay = 25000 + Math.random() * 20000;
    setTimeout(() => {
      const stateKey = mascot.state === 'study' ? 'study' : (mascot.state === 'break' ? 'break' : 'idle');
      const pool = stateKey === 'study' ? studyLines : (stateKey === 'break' ? breakLines : idleLines);
      // pick random index different from last one for that state
      if (pool.length === 0) {
        scheduleNextBubble();
        return;
      }
      let idx = Math.floor(Math.random() * pool.length);
      if (pool.length > 1 && idx === lastBubbleIndex[stateKey]) {
        idx = (idx + 1) % pool.length;
      }
      lastBubbleIndex[stateKey] = idx;
      showBubble(pool[idx]);
      scheduleNextBubble();
    }, delay);
  };

  orb.addEventListener('animationend', (e) => {
    if (e.animationName === 'mascotBlink') {
      orb.classList.remove('blink');
    }
  });

  pickNextDest();
  applyPosition();
  setIdlePose('idle');
  scheduleIdleSwap();
  if (!prefersReducedMotion) {
    mascot.animFrame = requestAnimationFrame(tickRoam);
    scheduleNextBubble();
  }

  mascotController = {
    setState(nextState) {
      if (nextState === 'idle') {
        if (mascot.state === 'idle') return;
        setIdlePose(mascot.idlePose);
        scheduleIdleSwap();
        return;
      }
      applyStateVisual(nextState);
    },
    resetToStart() {
      mascot.x = bounds.maxX;
      mascot.y = bounds.minY;
      mascot.targetX = mascot.x;
      mascot.targetY = mascot.y;
      applyPosition();
      updateBubblePosition();
    },
    reactToMood(emotion) {
      // mood reaction — no visual change, just log
    },
    showRewardBubble(text) {
      showBubble(text);
    },
    getPosition() {
      return { x: mascot.x, y: mascot.y };
    },
    triggerFishCatch() {
      mascot.pauseUntil = Date.now() + 2400;
      applyStateVisual('reward');
      setTimeout(() => {
        if (mascot.state === 'reward') setIdlePose(mascot.idlePose);
      }, 2400);
    },
    dispose() {
      if (mascot.animFrame) cancelAnimationFrame(mascot.animFrame);
      if (mascot.moodEnterTimer) clearTimeout(mascot.moodEnterTimer);
      if (mascot.moodExitTimer) clearTimeout(mascot.moodExitTimer);
      if (mascot.idleSwapTimer) clearTimeout(mascot.idleSwapTimer);
      stopBubbleFollow();
    }
  };

  window.addEventListener('beforeunload', () => mascotController?.dispose(), { once: true });
}


async function initialisePomodoro() {
  const startPauseBtn = document.getElementById('startPausePomodoroBtn');
  const resetBtn = document.getElementById('resetPomodoroBtn');
  const breakBtn = document.getElementById('breakPomodoroBtn');

  startPauseBtn.addEventListener('click', togglePomodoro);
  resetBtn.addEventListener('click', resetPomodoro);
  breakBtn.addEventListener('click', toggleBreakMode);

  const stored = await getStorage(['pomodoroState']);
  pomodoroState = sanitisePomodoroState(stored.pomodoroState);

  await reconcilePomodoroState();
  syncPomodoroUi();
  startPomodoroTicker();
}

function togglePomodoro() {
  if (pomodoroState.running) {
    pausePomodoro();
    return;
  }
  startPomodoro();
}

function sanitisePomodoroState(raw) {
  if (!raw || typeof raw !== 'object') return { ...pomodoroState };

  const mode = raw.mode === 'break' ? 'break' : 'focus';
  const totalMs = mode === 'focus' ? FOCUS_DURATION_MS : BREAK_DURATION_MS;

  return {
    mode,
    running: Boolean(raw.running),
    endAt: typeof raw.endAt === 'number' ? raw.endAt : null,
    remainingMs: Number.isFinite(raw.remainingMs) ? Math.max(0, raw.remainingMs) : totalMs,
    totalMs,
    sessionsCompleted: Number.isFinite(raw.sessionsCompleted) ? Math.max(0, raw.sessionsCompleted) : 0,
    treats: Number.isFinite(raw.treats) ? Math.max(0, raw.treats) : 0,
    rewardPending: Boolean(raw.rewardPending)
  };
}

async function reconcilePomodoroState() {
  if (!pomodoroState.running || !pomodoroState.endAt) {
    if (pomodoroState.rewardPending) showRewardVisuals(false);
    return;
  }

  const now = Date.now();
  const remaining = pomodoroState.endAt - now;

  if (remaining > 0) {
    pomodoroState.remainingMs = remaining;
    await persistPomodoroState();
    return;
  }

  await completePomodoroCycle(true);
}

function startPomodoro() {
  if (pomodoroState.running) return;

  if (pomodoroState.remainingMs <= 0) {
    completePomodoroCycle(false);
    return;
  }

  pomodoroState.running = true;
  pomodoroState.endAt = Date.now() + pomodoroState.remainingMs;
  // schedule background alarm so notification fires even if popup closed
  try {
    chrome.alarms.clear('pomodoro-end');
    chrome.storage.local.set({ nextPomodoroNotification: {
      title: pomodoroState.mode === 'focus' ? 'Focus block complete' : 'Break complete',
      message: pomodoroState.mode === 'focus' ? 'Great work. Time for a short break.' : 'Break is over. Ready to focus again.'
    }});
    chrome.alarms.create('pomodoro-end', { when: pomodoroState.endAt });
  } catch (e) {
    // some environments may not allow alarms from popup; ignore silently
  }
  if (pomodoroState.mode === 'focus') mascotController?.setState('study');
  if (pomodoroState.mode === 'break') {
    mascotController?.resetToStart();
    mascotController?.setState('break');
  }
  persistPomodoroState();
  syncPomodoroUi();
}

function pausePomodoro() {
  if (!pomodoroState.running || !pomodoroState.endAt) return;

  pomodoroState.remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
  pomodoroState.running = false;
  pomodoroState.endAt = null;
  mascotController?.setState('idle');

  try {
    chrome.alarms.clear('pomodoro-end');
    chrome.storage.local.remove('nextPomodoroNotification');
  } catch (e) {}
  persistPomodoroState();
  syncPomodoroUi();
}

function resetPomodoro() {
  const dur = pomodoroState.mode === 'break' ? BREAK_DURATION_MS : FOCUS_DURATION_MS;
  pomodoroState.running = false;
  pomodoroState.endAt = null;
  pomodoroState.remainingMs = dur;
  pomodoroState.totalMs = dur;
  pomodoroState.rewardPending = false;
  mascotController?.setState('idle');

  persistPomodoroState();
  syncPomodoroUi();
  showRewardVisuals(false);

  try {
    chrome.alarms.clear('pomodoro-end');
    chrome.storage.local.remove('nextPomodoroNotification');
  } catch (e) {}
}

function toggleBreakMode() {
  const nextMode = pomodoroState.mode === 'focus' ? 'break' : 'focus';
  const nextDuration = nextMode === 'focus' ? FOCUS_DURATION_MS : BREAK_DURATION_MS;

  pomodoroState.mode = nextMode;
  pomodoroState.running = false;
  pomodoroState.endAt = null;
  pomodoroState.remainingMs = nextDuration;
  pomodoroState.totalMs = nextDuration;
  mascotController?.setState('idle');

  persistPomodoroState();
  syncPomodoroUi();
}

function startPomodoroTicker() {
  if (pomodoroTick) clearInterval(pomodoroTick);

  pomodoroTick = setInterval(async () => {
    if (!pomodoroState.running || !pomodoroState.endAt) {
      syncPomodoroUi();
      return;
    }

    const remaining = pomodoroState.endAt - Date.now();
    if (remaining <= 0) {
      await completePomodoroCycle(false);
      return;
    }

    pomodoroState.remainingMs = remaining;
    syncPomodoroUi();
  }, 1000);
}

async function completePomodoroCycle(fromRestore) {
  const wasFocus = pomodoroState.mode === 'focus';

  pomodoroState.running = false;
  pomodoroState.endAt = null;

  if (wasFocus) {
    pomodoroState.sessionsCompleted += 1;
    pomodoroState.treats += 1;
    pomodoroState.rewardPending = true;

    pomodoroState.mode = 'break';
    pomodoroState.totalMs = BREAK_DURATION_MS;
    pomodoroState.remainingMs = BREAK_DURATION_MS;

    showRewardVisuals(true);
    if (document.hidden && !fromRestore) {
      showPomodoroNotification('Focus block complete', 'Great work. Time for a short break.');
    }
  } else {
    pomodoroState.rewardPending = false;
    pomodoroState.mode = 'focus';
    pomodoroState.totalMs = FOCUS_DURATION_MS;
    pomodoroState.remainingMs = FOCUS_DURATION_MS;
    mascotController?.setState('idle');

    if (!fromRestore && document.hidden) {
      showPomodoroNotification('Break complete', 'You are ready to focus again.');
    }
  }

  await persistPomodoroState();
  syncPomodoroUi();
}

function showPomodoroNotification(title, message) {
  if (!chrome?.notifications) return;

  chrome.notifications.create(`pomodoro-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1,
    requireInteraction: false
  });
}

function syncPomodoroUi() {
  const timerDisplay = document.getElementById('timerDisplay');
  const badge = document.getElementById('focusModeBadge');
  const startPauseBtn = document.getElementById('startPausePomodoroBtn');
  const breakBtn = document.getElementById('breakPomodoroBtn');
  const sessionsCount = document.getElementById('sessionsCount');
  const ringShell = document.getElementById('clockRingShell');

  const remaining = pomodoroState.running && pomodoroState.endAt
    ? Math.max(0, pomodoroState.endAt - Date.now())
    : pomodoroState.remainingMs;

  pomodoroState.remainingMs = remaining;

  timerDisplay.textContent = formatDuration(remaining);

  badge.textContent = pomodoroState.mode === 'focus' ? '🎯 Focus' : 'Break';
  badge.classList.toggle('break', pomodoroState.mode === 'break');

  startPauseBtn.textContent = pomodoroState.running ? 'Pause' : (pomodoroState.mode === 'focus' ? 'Start Focus' : 'Start Break');
  breakBtn.textContent = pomodoroState.mode === 'focus' ? 'Break' : 'Focus';
  breakBtn.disabled = pomodoroState.running;

  sessionsCount.textContent = String(pomodoroState.sessionsCompleted);

  updateClockRing(remaining, pomodoroState.totalMs);
  if (ringShell) {
    ringShell.classList.toggle('break', pomodoroState.mode === 'break');
    ringShell.classList.toggle('urgent', pomodoroState.mode === 'focus' && remaining <= URGENCY_THRESHOLD_MS && pomodoroState.running);
  }

  if (pomodoroState.running) {
    mascotController?.setState(pomodoroState.mode === 'focus' ? 'study' : 'break');
  } else if (!pomodoroState.rewardPending) {
    mascotController?.setState('idle');
  }

  if (pomodoroState.rewardPending) {
    showRewardVisuals(false);
  }
}

function updateClockRing(remainingMs, totalMs) {
  const ring = document.getElementById('clockRingProgress');
  const head = document.getElementById('clockRingHead');
  if (!ring) return;

  const radius = CLOCK_RING_RADIUS;
  const circumference = CLOCK_RING_CIRCUMFERENCE;
  const safeTotal = Math.max(1, totalMs || 1);
  const progress = Math.max(0, Math.min(1, 1 - (remainingMs / safeTotal)));
  const dash = Math.max(MIN_STROKE_DASH, circumference * progress);
  const showInitialHint = progress < 0.005;

  ring.style.strokeDasharray = `${dash} ${circumference}`;
  ring.style.strokeDashoffset = '0';
  ring.style.opacity = showInitialHint ? '0.4' : '1';

  if (!head) return;
  head.style.opacity = showInitialHint ? '0.4' : '1';

  const angle = progress * Math.PI * 2;
  const cx = CLOCK_SVG_CENTER + (Math.sin(angle) * radius);
  const cy = CLOCK_SVG_CENTER - (Math.cos(angle) * radius);
  head.setAttribute('cx', String(cx));
  head.setAttribute('cy', String(cy));
}

function showRewardVisuals(withAnimation) {
  const ringShell = document.getElementById('clockRingShell');

  if (!pomodoroState.rewardPending) {
    if (ringShell) ringShell.classList.remove('burst');
    return;
  }

  if (withAnimation) {
    if (ringShell) {
      ringShell.classList.remove('burst');
      requestAnimationFrame(() => ringShell.classList.add('burst'));
    }

    triggerFishThrow();

    setTimeout(() => {
      pomodoroState.rewardPending = false;
      if (ringShell) ringShell.classList.remove('burst');
      mascotController?.setState('idle');
      persistPomodoroState();
      syncPomodoroUi();
    }, REWARD_ANIMATION_DURATION_MS);
  }
}

function triggerFishThrow() {
  const fish = document.getElementById('fishProjectile');
  const pos = mascotController?.getPosition();
  if (!fish || !pos) return;

  // fish launches from roughly the centre of the clock face
  const startX = 160;
  const startY = 235;
  const endX = pos.x + 34;
  const endY = pos.y + 34;

  fish.style.left = `${startX}px`;
  fish.style.top = `${startY}px`;
  fish.classList.remove('hidden');

  const anim = fish.animate([
    { transform: 'translate(0, 0) scale(1.4) rotate(0deg)', opacity: 1 },
    {
      transform: `translate(${(endX - startX) * 0.4 - 10}px, ${(endY - startY) * 0.35 - 55}px) scale(1.8) rotate(-40deg)`,
      opacity: 1,
      offset: 0.42
    },
    { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(0.6) rotate(-90deg)`, opacity: 0 }
  ], {
    duration: 1500,
    easing: 'cubic-bezier(0.2, 0.8, 0.5, 1)',
    fill: 'forwards'
  });

  anim.addEventListener('finish', () => {
    fish.classList.add('hidden');
    anim.cancel();
    mascotController?.triggerFishCatch();
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function persistPomodoroState() {
  await setStorage({ pomodoroState });
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}
