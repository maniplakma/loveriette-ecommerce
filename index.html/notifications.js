let audioCtx = null;
let masterGain = null;

const MUTE_KEY = 'loveriette-muted';

function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

function setMuted(muted) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  updateSoundToggleUI();
}

function toggleMute() {
  setMuted(!isMuted());
  if (!isMuted()) {
    playNotificationSound('success');
  }
}

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.8;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function getMasterGain() {
  getAudioContext();
  return masterGain;
}

function setMasterVolume(level) {
  const ctx = getAudioContext();
  getMasterGain().gain.setValueAtTime(level, ctx.currentTime);
}

function playTone(frequency, startTime, duration, volume = 1, type = 'sine') {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001), startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(getMasterGain());
  osc.start(startTime);
  osc.stop(startTime + duration + 0.08);
}

function playLayeredTone(frequency, startTime, duration) {
  playTone(frequency, startTime, duration, 1, 'square');
  playTone(frequency, startTime, duration, 0.85, 'sine');
  playTone(frequency * 0.5, startTime, duration, 0.5, 'triangle');
}

function playApprovedAlarm(now) {
  setMasterVolume(3.2);

  const burst = (offset, baseFreq) => {
    playLayeredTone(baseFreq, now + offset, 0.22);
    playLayeredTone(baseFreq * 1.25, now + offset + 0.14, 0.22);
    playLayeredTone(baseFreq * 1.5, now + offset + 0.28, 0.28);
    playLayeredTone(baseFreq * 2, now + offset + 0.42, 0.35);
  };

  burst(0, 523);
  burst(0.9, 659);
  burst(1.8, 784);

  playLayeredTone(1047, now + 2.55, 0.5);
  playLayeredTone(1319, now + 2.7, 0.55);
  playLayeredTone(1568, now + 2.85, 0.65);

  setMasterVolume(2);
}

function playNotificationSound(type = 'success') {
  if (isMuted()) return;

  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    if (type === 'approved') {
      playApprovedAlarm(now);
      return;
    }

    setMasterVolume(type === 'error' ? 2.2 : 2);

    if (type === 'error') {
      playLayeredTone(220, now, 0.35);
      playLayeredTone(185, now + 0.25, 0.4);
      playLayeredTone(165, now + 0.5, 0.45);
      return;
    }

    if (type === 'info') {
      playTone(660, now, 0.15, 0.9);
      playTone(880, now + 0.12, 0.2, 1);
      playTone(1100, now + 0.24, 0.22, 1);
      return;
    }

    playLayeredTone(523, now, 0.15);
    playLayeredTone(784, now + 0.12, 0.22);
    playLayeredTone(988, now + 0.24, 0.25);
  } catch {
    /* audio not supported or blocked */
  }
}

function soundToggleIcons() {
  return {
    on: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>`,
    off: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    </svg>`
  };
}

function updateSoundToggleUI() {
  document.querySelectorAll('.sound-toggle').forEach((btn) => {
    const icons = soundToggleIcons();
    const muted = isMuted();
    btn.innerHTML = muted ? icons.off : icons.on;
    btn.classList.toggle('is-muted', muted);
    btn.setAttribute('aria-label', muted ? 'Unmute notifications' : 'Mute notifications');
    btn.setAttribute('title', muted ? 'Unmute sounds' : 'Mute sounds');
  });
}

function initSoundToggle() {
  document.querySelectorAll('.nav-right').forEach((navRight) => {
    if (navRight.querySelector('.sound-toggle')) return;

    const li = document.createElement('li');
    li.innerHTML = `<button class="icon-btn sound-toggle" type="button" aria-label="Mute notifications"></button>`;

    const cartLi = navRight.querySelector('.cart-btn')?.closest('li');
    if (cartLi) {
      navRight.insertBefore(li, cartLi);
    } else {
      navRight.prepend(li);
    }

    li.querySelector('.sound-toggle').addEventListener('click', toggleMute);
  });

  updateSoundToggleUI();
}

document.addEventListener('click', () => {
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: true });

initSoundToggle();
