import { CLINICAL_PROTOCOLS, CORNELL_STRETCHES, AAO_EYE_EXERCISES, CORNELL_ERGONOMICS_AUDIT } from './ergonomics.js';
import { sound } from './audio.js';

// Detect whether running in Tauri desktop environment or webview
const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

let tauriCore = null;
let tauriEvent = null;
let tauriNotification = null;

async function initTauriBindings() {
  if (isTauri) {
    try {
      tauriCore = await import('@tauri-apps/api/core');
      tauriEvent = await import('@tauri-apps/api/event');
      tauriNotification = await import('@tauri-apps/plugin-notification');

      // Request native notification permissions if available
      try {
        if (tauriNotification?.isPermissionGranted) {
          const granted = await tauriNotification.isPermissionGranted();
          if (!granted && tauriNotification.requestPermission) {
            await tauriNotification.requestPermission();
          }
        }
      } catch (permErr) {
        console.warn('Tauri notification permission check:', permErr);
      }

      // Listen for system tray events emitted from Rust backend
      if (tauriEvent?.listen) {
        await tauriEvent.listen('tray-start-both', () => {
          appState.startBothProtocols();
        });

        await tauriEvent.listen('tray-take-break', () => {
          appState.startBreakExperience();
        });

        await tauriEvent.listen('tray-pause-duration', (evt) => {
          const minutes = evt.payload || 30;
          appState.pauseAllForMinutes(minutes);
        });

        await tauriEvent.listen('tray-resume', () => {
          appState.resumeAllTimers();
        });

        // Background heartbeat tick emitted by Rust every second
        await tauriEvent.listen('rust-heartbeat-tick', () => {
          appState.tickTimers();
        });
      }
    } catch (err) {
      console.warn('Tauri IPC initialization note:', err);
    }
  }
}

async function openExternalUrl(url) {
  if (isTauri && tauriCore?.invoke) {
    try {
      await tauriCore.invoke('open_external_url', { url });
      return;
    } catch (err) {
      console.warn('Tauri open_external_url error:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

class AppState {
  constructor() {
    this.activeView = 'eye_rest'; // 'eye_rest', 'posture_default', 'posture_deep_work', 'musculoskeletal_reset', 'stretches'
    this.activePostureKey = 'posture_default'; // Selected posture protocol for 1-click dual sync

    // Protocol Engine Instances (Independent Simultaneous State)
    this.engines = {};
    for (const [key, proto] of Object.entries(CLINICAL_PROTOCOLS)) {
      const firstStep = proto.steps[0];
      this.engines[key] = {
        id: key,
        proto: proto,
        isRunning: false,
        stepIndex: 0,
        remainingSec: firstStep.durationSec,
        durationSec: firstStep.durationSec,
        targetEndTime: null
      };
    }

    // Modal break state
    this.breakTimerInterval = null;
    this.breakRemainingSec = 20;
    this.breakActiveProtocolKey = 'eye_rest';
    this.activeStretchIndex = 0;
    this.blinkCount = 0;

    // Daily metrics
    this.metrics = {
      breaksCount: 0,
      eyeRestsCount: 0,
      standingMinutes: 0,
      complianceScore: 100
    };

    // Settings
    this.settings = {
      nativeNotif: true,
      audioChimes: true,
      autoBreak: true,
      sitTime: 20,
      standTime: 8,
      aaoTime: 20
    };

    // Ergonomic Audit Answers
    this.auditAnswers = new Set([0, 1, 2, 3, 4, 5, 6]);

    // Interval ticker in JavaScript
    this.masterTimerInterval = null;
  }

  get currentEngine() {
    if (this.activeView === 'stretches') {
      return this.engines[this.activePostureKey];
    }
    return this.engines[this.activeView] || this.engines.eye_rest;
  }

  get eyeEngine() {
    return this.engines.eye_rest;
  }

  get postureEngine() {
    // 1. If currently selected activePostureKey engine is running, use it
    if (this.engines[this.activePostureKey]?.isRunning) {
      return this.engines[this.activePostureKey];
    }
    // 2. Otherwise, check if ANY posture/microbreak engine is currently running
    const postureKeys = ['posture_default', 'posture_deep_work', 'musculoskeletal_reset'];
    for (const key of postureKeys) {
      if (this.engines[key]?.isRunning) {
        return this.engines[key];
      }
    }
    // 3. Fallback to activePostureKey if valid posture/microbreak, or posture_default
    if (this.activePostureKey && this.activePostureKey !== 'eye_rest' && this.engines[this.activePostureKey]) {
      return this.engines[this.activePostureKey];
    }
    return this.engines.posture_default;
  }

  init() {
    this.loadPersistedState();
    this.setupUI();
    this.renderAboutVersion();
    this.renderStretches();
    this.renderAuditItems();
    this.updateProtocolView();
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    this.syncTrayStatus();
    this.startMasterTicker();
    initTauriBindings();
  }

  renderAboutVersion() {
    const versionEl = document.getElementById('about-app-version');
    if (!versionEl) return;
    const baseVersion = '0.1.0';
    const buildNum = import.meta.env.VITE_BUILD_NUMBER;
    const commitSha = import.meta.env.VITE_COMMIT_SHA ? import.meta.env.VITE_COMMIT_SHA.substring(0, 7) : null;

    let versionText = `v${baseVersion}`;
    if (buildNum) {
      versionText += ` • Build #${buildNum}`;
      if (commitSha) {
        versionText += ` (${commitSha})`;
      }
    }
    versionEl.textContent = `${versionText} • Clinical Ergonomics & Ocular Companion`;
  }

  loadPersistedState() {
    try {
      const savedMetrics = localStorage.getItem('spineeye_metrics') || localStorage.getItem('deskhealth_metrics');
      if (savedMetrics) {
        this.metrics = { ...this.metrics, ...JSON.parse(savedMetrics) };
      }
      const savedSettings = localStorage.getItem('spineeye_settings') || localStorage.getItem('deskhealth_settings');
      if (savedSettings) {
        this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
        sound.setMuted(!this.settings.audioChimes);
      }
      const savedPosture = localStorage.getItem('spineeye_posture_key') || localStorage.getItem('deskhealth_posture_key');
      if (savedPosture && this.engines[savedPosture] && savedPosture !== 'eye_rest') {
        this.activePostureKey = savedPosture;
      }
    } catch {
      // Fallback safely to defaults
    }
  }

  savePersistedState() {
    try {
      localStorage.setItem('spineeye_metrics', JSON.stringify(this.metrics));
      localStorage.setItem('spineeye_settings', JSON.stringify(this.settings));
      if (this.activePostureKey && this.activePostureKey !== 'eye_rest') {
        localStorage.setItem('spineeye_posture_key', this.activePostureKey);
      }
    } catch {
      // Ignore storage errors safely
    }
  }

  // Master Wall-Clock Ticker
  startMasterTicker() {
    if (this.masterTimerInterval) clearInterval(this.masterTimerInterval);
    this.masterTimerInterval = setInterval(() => {
      this.tickTimers();
    }, 500);
  }

  tickTimers() {
    const now = Date.now();
    let stateChanged = false;

    // Tick all running protocol engines independently based on wall-clock time
    for (const [key, engine] of Object.entries(this.engines)) {
      if (engine.isRunning && engine.targetEndTime) {
        const remainingMs = engine.targetEndTime - now;
        const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
        engine.remainingSec = remaining;
        stateChanged = true;

        if (remainingMs <= 0) {
          // If break modal is actively running on screen for this engine,
          // the modal countdown handles the synchronous completion to prevent premature alerts!
          if (this.isBreakModalActive(engine.id)) {
            continue;
          }
          this.onEngineStepComplete(engine);
        }
      }
    }

    if (stateChanged) {
      this.updateMasterBarDisplay();
      this.updateTabsDisplay();
      if (this.activeView !== 'stretches') {
        this.updateProtocolTimerCardDisplay();
      }
      this.syncTrayStatus();
    }
  }

  isBreakModalActive(engineId) {
    const modal = document.getElementById('break-modal');
    const isOpen = modal && !modal.classList.contains('hidden');
    if (!isOpen) return false;
    if (engineId) {
      return this.breakActiveProtocolKey === engineId;
    }
    return Boolean(this.breakActiveProtocolKey);
  }

  // Handle step completion for an engine
  onEngineStepComplete(engine) {
    const currentStep = engine.proto.steps[engine.stepIndex];
    const prevStepIndex = engine.stepIndex;

    // Advance to next step in this protocol's cycle
    engine.stepIndex = (engine.stepIndex + 1) % engine.proto.steps.length;
    const nextStep = engine.proto.steps[engine.stepIndex];
    engine.durationSec = nextStep.durationSec;
    engine.remainingSec = nextStep.durationSec;
    engine.targetEndTime = Date.now() + nextStep.durationSec * 1000;

    // Track metrics
    if (engine.id === 'eye_rest') {
      if (currentStep.id === 'distance_gaze') {
        this.metrics.eyeRestsCount++;
        this.metrics.breaksCount++;
        this.savePersistedState();
        this.updateMetricsUI();
      }
    } else if (engine.proto.type === 'posture') {
      if (currentStep.shortName === 'Stand') {
        const standMinutes = Math.round(currentStep.durationSec / 60);
        this.metrics.standingMinutes += standMinutes;
        this.savePersistedState();
        this.updateMetricsUI();
      } else if (currentStep.shortName === 'Stretch' || currentStep.shortName === 'Move') {
        this.metrics.breaksCount++;
        this.savePersistedState();
        this.updateMetricsUI();
      }
    }

    // Trigger Notification & Audio
    this.deliverStepAlert(engine, prevStepIndex);

    // If modal break should be launched
    if (this.settings.autoBreak) {
      if (engine.id === 'eye_rest' && nextStep.id === 'distance_gaze') {
        this.breakActiveProtocolKey = 'eye_rest';
        this.startBreakExperience();
      } else if (engine.proto.type === 'posture' && (nextStep.shortName === 'Stretch' || nextStep.shortName === 'Move')) {
        this.breakActiveProtocolKey = engine.id;
        this.startBreakExperience();
      } else if (engine.id === 'musculoskeletal_reset' && nextStep.shortName === 'Reset') {
        this.breakActiveProtocolKey = engine.id;
        this.startBreakExperience();
      }
    }
  }

  deliverStepAlert(engine, completedStepIndex) {
    const completedStep = engine.proto.steps[completedStepIndex];
    const nextStep = engine.proto.steps[engine.stepIndex];

    let alertTitle = '';
    let alertBody = '';

    if (engine.id === 'eye_rest') {
      if (completedStep.id === 'screen_focus') {
        alertTitle = 'Eye Rest: 20-20-20 Rule (AAO)';
        alertBody = 'Look at an object at least 20 feet away to relax the ciliary muscles and reset your blink rate. (20s rest)';
      } else {
        alertTitle = 'Eye Rest Complete';
        alertBody = '20-second distant gaze complete. Resume focused work.';
      }
    } else if (engine.id === 'posture_default') {
      if (completedStep.shortName === 'Sit') {
        alertTitle = 'Posture: Raise desk / Stand!';
        alertBody = '20 min sitting complete. Raise desk and stand for 8 minutes (Cornell 20-8-2).';
      } else if (completedStep.shortName === 'Stand') {
        alertTitle = 'Posture: Step away, stretch, hydrate!';
        alertBody = '8 min standing complete. Step away, stretch, hydrate for 2 minutes.';
      } else if (completedStep.shortName === 'Stretch' || completedStep.shortName === 'Move') {
        alertTitle = 'Posture: Lower desk / Return to sit';
        alertBody = 'Movement/stretch break complete. Return to seated neutral posture (lumbar supported, elbows 90°).';
      }
    } else if (engine.id === 'posture_deep_work') {
      if (completedStep.shortName === 'Sit') {
        alertTitle = 'Posture (Deep Work): Raise desk / Stand!';
        alertBody = '45 min sitting complete. Raise desk and stand for 15 minutes.';
      } else if (completedStep.shortName === 'Stand') {
        alertTitle = 'Posture (Deep Work): Return to sit';
        alertBody = '15 min standing complete. Lower desk and resume seated deep focus.';
      }
    } else if (engine.id === 'musculoskeletal_reset') {
      if (completedStep.shortName === 'Focus') {
        alertTitle = 'Musculoskeletal Reset (Microbreak)';
        alertBody = '30 min focus complete. Take a 60-second microbreak: chin tucks, thoracic extension, carpal tunnel decompression.';
      } else {
        alertTitle = 'Microbreak Complete';
        alertBody = '60-second reset complete. Resume seated work in neutral alignment.';
      }
    }

    if (alertTitle) {
      this.sendDesktopAlert(alertTitle, alertBody);
      if (completedStep.id === 'distance_gaze' || completedStep.shortName === 'Stretch' || completedStep.shortName === 'Move' || completedStep.shortName === 'Reset') {
        sound.playCompletionChime();
      } else {
        sound.playBreakChime();
      }
    }
  }

  async sendDesktopAlert(title, body) {
    if (!this.settings.nativeNotif) return;

    if (isTauri && tauriCore?.invoke) {
      try {
        await tauriCore.invoke('trigger_break_notification', {
          title,
          body,
          soundEnabled: this.settings.audioChimes
        });
        return;
      } catch (err) {
        console.warn('Native notification invoke error:', err);
      }
    }

    // Web Notification fallback
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/app-icon.png' });
      } catch (e) {
        console.warn('Web notification error:', e);
      }
    }
  }

  // Switch View Tab (NEVER RESETS TIMERS)
  switchView(key) {
    if (key === 'stretches') {
      this.activeView = 'stretches';
      document.getElementById('view-protocol')?.classList.add('hidden');
      document.getElementById('view-stretches')?.classList.remove('hidden');
    } else {
      if (!this.engines[key]) return;
      this.activeView = key;
      // Only switch activePostureKey if clicked tab is a posture protocol,
      // AND either the clicked engine is currently running OR no other posture engine is running.
      // This prevents simply browsing other tabs from disassociating a running posture cycle!
      if (this.engines[key].proto.type === 'posture' || key === 'musculoskeletal_reset') {
        const currentRunningPosture = this.postureEngine;
        if (!currentRunningPosture?.isRunning || currentRunningPosture.id === key) {
          this.activePostureKey = key;
          this.savePersistedState();
        }
      }
      document.getElementById('view-protocol')?.classList.remove('hidden');
      document.getElementById('view-stretches')?.classList.add('hidden');
      this.updateProtocolView();
    }

    this.updateTabsDisplay();
    this.updateMasterBarDisplay();
    this.syncTrayStatus();
  }

  // 1-Click "Start Vision + Posture"
  startBothProtocols() {
    const eye = this.eyeEngine;
    const posture = this.postureEngine;

    const bothRunning = eye.isRunning && posture.isRunning;

    if (bothRunning) {
      // Pause all running engines
      for (const eng of Object.values(this.engines)) {
        if (eng.isRunning) {
          this.pauseEngine(eng);
        }
      }
    } else {
      // Ensure competing posture engines are stopped so only one posture cycle runs
      for (const [k, eng] of Object.entries(this.engines)) {
        if (k !== 'eye_rest' && k !== posture.id && eng.isRunning) {
          this.pauseEngine(eng);
        }
      }
      // Start/resume both selected posture and eye rest
      this.startEngine(eye);
      this.startEngine(posture);
    }

    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
  }

  startEngine(engine) {
    if (engine.isRunning) return;
    engine.isRunning = true;
    engine.targetEndTime = Date.now() + engine.remainingSec * 1000;
  }

  pauseEngine(engine) {
    if (!engine.isRunning) return;
    if (engine.targetEndTime) {
      engine.remainingSec = Math.max(0, Math.round((engine.targetEndTime - Date.now()) / 1000));
    }
    engine.isRunning = false;
    engine.targetEndTime = null;
  }

  resetEngine(engine) {
    this.pauseEngine(engine);
    engine.stepIndex = 0;
    const firstStep = engine.proto.steps[0];
    engine.durationSec = firstStep.durationSec;
    engine.remainingSec = firstStep.durationSec;
    engine.targetEndTime = null;

    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
  }

  pauseAllForMinutes(minutes) {
    for (const engine of Object.values(this.engines)) {
      this.pauseEngine(engine);
      engine.remainingSec = minutes * 60;
    }
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
  }

  resumeAllTimers() {
    this.startBothProtocols();
  }

  // UI Updates: Protocol Details View
  updateProtocolView() {
    const engine = this.currentEngine;
    const proto = engine.proto;
    const currentStep = proto.steps[engine.stepIndex];

    // Category & Names
    const catBadge = document.getElementById('detail-category-badge');
    const nameEl = document.getElementById('detail-protocol-name');
    const instEl = document.getElementById('detail-institution');
    const cadenceEl = document.getElementById('detail-cadence-pill');
    const citationEl = document.getElementById('citation-text');

    if (catBadge) catBadge.textContent = proto.category;
    if (nameEl) nameEl.textContent = proto.name;
    if (instEl) instEl.textContent = proto.institution;
    if (cadenceEl) cadenceEl.textContent = proto.intervalDescription;

    if (citationEl) {
      citationEl.innerHTML = `<strong>${proto.category} Guidance:</strong> ${proto.notificationAction}`;
    }

    // Dynamic Source Research Link
    const researchLinkEl = document.getElementById('protocol-research-link');
    if (researchLinkEl) {
      if (proto.researchUrl) {
        researchLinkEl.href = proto.researchUrl;
        researchLinkEl.title = `Read ${proto.institution} Clinical Research`;
        researchLinkEl.style.display = 'inline-flex';
      } else {
        researchLinkEl.style.display = 'none';
      }
    }

    // Guidance Card Tag
    const guideTag = document.getElementById('guidance-tag');
    const guideInst = document.getElementById('guidance-institution');
    if (guideTag) guideTag.textContent = proto.name;
    if (guideInst) guideInst.textContent = proto.institution;

    this.renderPostureStepper(proto, engine.stepIndex);
    this.updateProtocolTimerCardDisplay();
  }

  renderPostureStepper(proto, activeIndex) {
    const trackEl = document.getElementById('posture-steps-track');
    const currentLabelEl = document.getElementById('stepper-current-label');
    const nextStepEl = document.getElementById('next-step-text');

    if (!trackEl) return;
    trackEl.replaceChildren();

    if (proto.steps.length === 2) {
      trackEl.classList.add('two-col');
    } else {
      trackEl.classList.remove('two-col');
    }

    proto.steps.forEach((step, idx) => {
      const card = document.createElement('div');
      const isActive = idx === activeIndex;
      const isCompleted = idx < activeIndex;

      card.className = `step-card ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;

      const icon = document.createElement('span');
      icon.className = 'step-card-icon';
      icon.textContent = step.icon;

      const textWrap = document.createElement('div');
      textWrap.className = 'step-card-text';

      const name = document.createElement('span');
      name.className = 'step-card-name';
      name.textContent = step.name;

      const dur = document.createElement('span');
      dur.className = 'step-card-duration';
      const durMin = Math.round(step.durationSec / 60);
      dur.textContent = durMin >= 1 ? `${durMin} min` : `${step.durationSec} sec`;

      textWrap.appendChild(name);
      textWrap.appendChild(dur);
      card.appendChild(icon);
      card.appendChild(textWrap);

      trackEl.appendChild(card);
    });

    const activeStep = proto.steps[activeIndex];
    if (currentLabelEl && activeStep) {
      currentLabelEl.textContent = `Active Step: ${activeStep.name} — ${activeStep.guidance}`;
    }

    if (nextStepEl && activeStep) {
      nextStepEl.textContent = activeStep.nextStep;
    }
  }

  updateProtocolTimerCardDisplay() {
    const engine = this.currentEngine;
    const proto = engine.proto;
    const currentStep = proto.steps[engine.stepIndex];

    const digitsEl = document.getElementById('timer-display');
    const stageEl = document.getElementById('timer-stage-badge');
    const progressRing = document.getElementById('ring-progress');
    const toggleBtnLabel = document.getElementById('label-toggle-timer');
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');

    // Digits
    const mins = Math.floor(engine.remainingSec / 60);
    const secs = engine.remainingSec % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (digitsEl) digitsEl.textContent = formatted;

    if (stageEl) {
      stageEl.textContent = `${currentStep.name}`;
      stageEl.style.borderColor = proto.accentColor;
      stageEl.style.color = proto.accentColor;
    }

    // Ring progress (r=84, circumference = 2 * PI * 84 = 527.78)
    if (progressRing) {
      const maxOffset = 527.78;
      const totalSec = engine.durationSec || 1;
      const elapsedSec = totalSec - engine.remainingSec;
      const progressRatio = Math.min(1, Math.max(0, elapsedSec / totalSec));
      progressRing.style.strokeDashoffset = String(maxOffset * (1 - progressRatio));
      progressRing.style.stroke = proto.accentColor;
    }

    // Toggle button state for this protocol
    if (toggleBtnLabel) {
      toggleBtnLabel.textContent = engine.isRunning ? `Pause ${proto.category}` : `Start ${proto.category}`;
    }
    if (playIcon && pauseIcon) {
      if (engine.isRunning) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }
    }
  }

  updateMasterBarDisplay() {
    const eye = this.eyeEngine;
    const posture = this.postureEngine;

    // Digits
    const eyeDigits = document.getElementById('tracker-eye-digits');
    const eyeStep = document.getElementById('tracker-eye-step');
    const postureDigits = document.getElementById('tracker-posture-digits');
    const postureStep = document.getElementById('tracker-posture-step');

    if (eyeDigits) {
      const emins = Math.floor(eye.remainingSec / 60);
      const esecs = eye.remainingSec % 60;
      eyeDigits.textContent = `${String(emins).padStart(2, '0')}:${String(esecs).padStart(2, '0')}`;
    }
    if (eyeStep) {
      const step = eye.proto.steps[eye.stepIndex];
      eyeStep.textContent = `• ${step.name} ${eye.isRunning ? '(Running)' : '(Paused)'}`;
    }

    if (postureDigits) {
      const pmins = Math.floor(posture.remainingSec / 60);
      const psecs = posture.remainingSec % 60;
      postureDigits.textContent = `${String(pmins).padStart(2, '0')}:${String(psecs).padStart(2, '0')}`;
    }
    if (postureStep) {
      const pstep = posture.proto.steps[posture.stepIndex];
      postureStep.textContent = `• Step ${posture.stepIndex + 1}: ${pstep.name} ${posture.isRunning ? '(Running)' : '(Paused)'}`;
    }

    // Master button
    const masterBtnLabel = document.getElementById('master-btn-label');
    const masterPlay = document.getElementById('master-icon-play');
    const masterPause = document.getElementById('master-icon-pause');

    const bothRunning = eye.isRunning && posture.isRunning;
    const anyRunning = eye.isRunning || posture.isRunning || Object.values(this.engines).some(e => e.isRunning);

    if (masterBtnLabel) {
      if (bothRunning) {
        masterBtnLabel.textContent = 'Pause Both Protocols';
      } else if (anyRunning) {
        masterBtnLabel.textContent = 'Resume Both Protocols';
      } else {
        masterBtnLabel.textContent = 'Start Vision + Posture (1-Click)';
      }
    }
    if (masterPlay && masterPause) {
      if (bothRunning) {
        masterPlay.classList.add('hidden');
        masterPause.classList.remove('hidden');
      } else {
        masterPlay.classList.remove('hidden');
        masterPause.classList.add('hidden');
      }
    }
  }

  updateTabsDisplay() {
    // Update active tab highlight
    document.querySelectorAll('.protocol-tab').forEach(tab => {
      const protoKey = tab.getAttribute('data-protocol');
      const viewKey = tab.getAttribute('data-view');

      if (viewKey === 'stretches') {
        const isActive = this.activeView === 'stretches';
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      } else if (protoKey) {
        const isActive = this.activeView === protoKey;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      }
    });

    // Update mini badges on tabs with live countdown if running
    const formatMini = (engine) => {
      const mins = Math.floor(engine.remainingSec / 60);
      const secs = engine.remainingSec % 60;
      const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
      if (engine.isRunning) {
        const step = engine.proto.steps[engine.stepIndex];
        return `${step.shortName || 'Act'}: ${timeStr}`;
      }
      return engine.proto.name;
    };

    const badgeEye = document.getElementById('tab-badge-eye');
    const badgePostDef = document.getElementById('tab-badge-posture-default');
    const badgePostDeep = document.getElementById('tab-badge-posture-deep');
    const badgeMicro = document.getElementById('tab-badge-micro');

    if (badgeEye) badgeEye.textContent = this.eyeEngine.isRunning ? formatMini(this.eyeEngine) : '20-20-20';
    if (badgePostDef) badgePostDef.textContent = this.engines.posture_default.isRunning ? formatMini(this.engines.posture_default) : '20-8-2';
    if (badgePostDeep) badgePostDeep.textContent = this.engines.posture_deep_work.isRunning ? formatMini(this.engines.posture_deep_work) : '45-15';
    if (badgeMicro) badgeMicro.textContent = this.engines.musculoskeletal_reset.isRunning ? formatMini(this.engines.musculoskeletal_reset) : '30m/60s';
  }

  syncTrayStatus() {
    const posture = this.postureEngine;
    const eye = this.eyeEngine;

    const pmins = Math.floor(posture.remainingSec / 60);
    const psecs = posture.remainingSec % 60;
    const ptime = `${pmins}:${String(psecs).padStart(2, '0')}`;

    const emins = Math.floor(eye.remainingSec / 60);
    const esecs = eye.remainingSec % 60;
    const etime = `${emins}:${String(esecs).padStart(2, '0')}`;

    const activePStep = posture.proto.steps[posture.stepIndex];
    let trayTitle = 'Spine & Eye';

    // Check if an eye rest break is currently active:
    // (stepIndex 1: 20-Foot Horizon Gaze) OR break modal is currently open for eye rest
    const modalEl = document.getElementById('break-modal');
    const isModalOpen = modalEl && !modalEl.classList.contains('hidden');
    const isEyeBreakActive = (eye.isRunning && eye.stepIndex === 1) || (isModalOpen && this.breakActiveProtocolKey === 'eye_rest');

    if (isEyeBreakActive) {
      // Actively in the 20-second distant gaze eye rest break!
      const breakSec = isModalOpen ? this.breakRemainingSec : eye.remainingSec;
      const bmins = Math.floor(breakSec / 60);
      const bsecs = breakSec % 60;
      const btime = `${bmins}:${String(bsecs).padStart(2, '0')}`;
      trayTitle = `👁️ Eye Rest: ${btime}`;
    } else if (posture.isRunning) {
      // Posture cycle is active: display current phase (Sit, Stand, Stretch)
      const stepIcon = activePStep.icon || '🪑';
      const stepName = activePStep.shortName || (posture.stepIndex === 0 ? 'Sit' : posture.stepIndex === 1 ? 'Stand' : 'Stretch');
      trayTitle = `${stepIcon} ${stepName}: ${ptime}`;
    } else if (eye.isRunning) {
      // Only eye engine is running during screen focus work
      trayTitle = `👁️ Focus: ${etime}`;
    }

    const eyeStatusText = isEyeBreakActive ? `Rest Now (${etime})` : `${etime} to rest`;
    const trayTooltip = `Spine & Eye | Posture: ${activePStep.name} (${ptime} left) • Eye: ${eyeStatusText}`;

    // Update in-app header status pill
    const trayLabel = document.getElementById('tray-live-label');
    if (trayLabel) {
      trayLabel.textContent = `Taskbar: ${trayTitle}`;
    }

    // Call Rust to update macOS menu bar title and tooltip
    if (isTauri && tauriCore?.invoke) {
      tauriCore.invoke('update_tray_status', {
        title: trayTitle,
        tooltip: trayTooltip
      }).catch(err => {
        // Suppress benign IPC notes
      });
    }
  }

  startBreakExperience() {
    const engine = this.engines[this.breakActiveProtocolKey] || this.eyeEngine;
    const proto = engine.proto;
    const currentStep = proto.steps[engine.stepIndex];

    const stepDuration = (currentStep && currentStep.durationSec) ? currentStep.durationSec : (proto.type === 'eye' ? 20 : 60);
    this.breakTotalDurationSec = stepDuration;
    this.breakRemainingSec = stepDuration;

    // Synchronize targetEndTime precisely with engine if running, or set new targetEndTime
    if (engine.isRunning && engine.targetEndTime && engine.targetEndTime > Date.now()) {
      this.breakTargetEndTime = engine.targetEndTime;
    } else {
      this.breakTargetEndTime = Date.now() + stepDuration * 1000;
      if (engine.isRunning) {
        engine.durationSec = stepDuration;
        engine.remainingSec = stepDuration;
        engine.targetEndTime = this.breakTargetEndTime;
      }
    }

    this.blinkCount = 0;
    this.activeStretchIndex = 0;

    const modal = document.getElementById('break-modal');
    if (modal) modal.classList.remove('hidden');

    this.renderBreakContent();
    this.startBreakCountdown();
  }

  startBreakCountdown() {
    if (this.breakTimerInterval) clearInterval(this.breakTimerInterval);
    const timeEl = document.getElementById('modal-break-time');
    const ringEl = document.getElementById('modal-ring-progress');
    const totalDuration = this.breakTotalDurationSec || 20;
    const maxOffset = 477.52; // 2 * PI * 76
    let lastPacingSec = -1;

    const updateModalTick = () => {
      const now = Date.now();
      const remainingMs = this.breakTargetEndTime - now;
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      this.breakRemainingSec = remainingSec;

      if (timeEl) timeEl.textContent = String(remainingSec);

      if (ringEl) {
        const elapsed = Math.max(0, totalDuration - Math.max(0, remainingMs / 1000));
        const ratio = Math.min(1, Math.max(0, elapsed / totalDuration));
        ringEl.style.strokeDashoffset = String(maxOffset * (1 - ratio));
      }

      // Pacing tick for eye exercises
      if (this.breakActiveProtocolKey === 'eye_rest' && remainingSec !== lastPacingSec) {
        lastPacingSec = remainingSec;
        if (remainingSec % 2 === 0 && remainingSec > 0) {
          sound.playPacingTick();
        }
      }

      this.syncTrayStatus();

      if (remainingMs <= 0) {
        clearInterval(this.breakTimerInterval);
        this.breakTimerInterval = null;
        this.completeBreakSession();
      }
    };

    updateModalTick();
    this.breakTimerInterval = setInterval(updateModalTick, 100);
  }

  renderBreakContent() {
    const titleEl = document.getElementById('break-modal-title');
    const descEl = document.getElementById('break-modal-desc');
    const benefitEl = document.getElementById('break-modal-benefit');
    const routineTypeEl = document.getElementById('break-routine-type');
    const stageEl = document.getElementById('break-interactive-stage');

    if (!titleEl || !descEl || !stageEl) return;

    if (this.breakActiveProtocolKey === 'eye_rest') {
      const exercise = AAO_EYE_EXERCISES[0];
      if (routineTypeEl) routineTypeEl.textContent = 'AAO 20-20-20 Ocular Reset';
      titleEl.textContent = exercise.name;
      descEl.textContent = exercise.instruction;

      if (benefitEl) {
        benefitEl.replaceChildren();
        const span = document.createElement('span');
        span.textContent = `🩺 Clinical Benefit: ${exercise.clinicalBenefit}`;
        benefitEl.appendChild(span);
      }

      this.renderEyeStage(stageEl);
    } else {
      const stretch = CORNELL_STRETCHES[this.activeStretchIndex];
      if (routineTypeEl) routineTypeEl.textContent = 'Cornell Physical Stretch';
      titleEl.textContent = stretch.name;
      descEl.textContent = stretch.instruction;

      if (benefitEl) {
        benefitEl.replaceChildren();
        const span = document.createElement('span');
        span.textContent = `🩺 Clinical Benefit: ${stretch.clinicalBenefit}`;
        benefitEl.appendChild(span);
      }

      this.renderStretchStage(stageEl, stretch);
    }
  }

  renderEyeStage(container) {
    container.replaceChildren();

    const pursuitWrap = document.createElement('div');
    pursuitWrap.className = 'smooth-pursuit-canvas';

    const track = document.createElement('div');
    track.className = 'infinity-track';

    const orb = document.createElement('div');
    orb.className = 'pursuit-orb';
    track.appendChild(orb);

    const counterRow = document.createElement('div');
    counterRow.className = 'blink-counter-row';

    const lbl = document.createElement('span');
    lbl.className = 'blink-label';
    lbl.textContent = '10 Conscious Blinks (Click or metronome):';

    const beadsWrap = document.createElement('div');
    beadsWrap.className = 'blink-beads-wrap';

    for (let i = 0; i < 10; i++) {
      const bead = document.createElement('div');
      bead.className = `blink-bead ${i < this.blinkCount ? 'active' : ''}`;
      bead.addEventListener('click', () => {
        this.blinkCount = i + 1;
        sound.playPacingTick();
        this.renderEyeStage(container);
      });
      beadsWrap.appendChild(bead);
    }

    counterRow.appendChild(lbl);
    counterRow.appendChild(beadsWrap);

    pursuitWrap.appendChild(track);
    pursuitWrap.appendChild(counterRow);
    container.appendChild(pursuitWrap);
  }

  renderStretchStage(container, stretch) {
    container.replaceChildren();

    const card = document.createElement('div');
    card.className = 'glass-panel';
    card.style.padding = '14px';
    card.style.textAlign = 'left';

    const targetH = document.createElement('div');
    targetH.className = 'stretch-target-badge';
    targetH.textContent = `Target: ${stretch.target}`;

    const titleH = document.createElement('h3');
    titleH.className = 'stretch-name';
    titleH.style.marginTop = '8px';
    titleH.textContent = stretch.name;

    const instP = document.createElement('p');
    instP.className = 'stretch-desc';
    instP.textContent = stretch.instruction;

    card.appendChild(targetH);
    card.appendChild(titleH);
    card.appendChild(instP);
    container.appendChild(card);
  }

  nextRoutine() {
    this.activeStretchIndex = (this.activeStretchIndex + 1) % CORNELL_STRETCHES.length;
    this.renderBreakContent();
  }

  completeBreakSession() {
    if (this.breakTimerInterval) {
      clearInterval(this.breakTimerInterval);
      this.breakTimerInterval = null;
    }
    const modal = document.getElementById('break-modal');
    if (modal) modal.classList.add('hidden');

    const breakKey = this.breakActiveProtocolKey;
    this.breakActiveProtocolKey = null;

    this.metrics.breaksCount++;
    if (breakKey === 'eye_rest') {
      this.metrics.eyeRestsCount++;
      // Advance eye engine back to screen_focus (step 0)
      this.eyeEngine.stepIndex = 0;
      const focusStep = this.eyeEngine.proto.steps[0];
      this.eyeEngine.durationSec = focusStep.durationSec;
      this.eyeEngine.remainingSec = focusStep.durationSec;
      if (this.eyeEngine.isRunning) {
        this.eyeEngine.targetEndTime = Date.now() + focusStep.durationSec * 1000;
      }
      this.sendDesktopAlert(
        'Eye Rest Complete',
        '20-second distant gaze complete. Resume focused work.'
      );
    } else if (breakKey && this.engines[breakKey]?.proto?.type === 'posture') {
      const pEngine = this.engines[breakKey];
      pEngine.stepIndex = (pEngine.stepIndex + 1) % pEngine.proto.steps.length;
      const nextStep = pEngine.proto.steps[pEngine.stepIndex];
      pEngine.durationSec = nextStep.durationSec;
      pEngine.remainingSec = nextStep.durationSec;
      if (pEngine.isRunning) {
        pEngine.targetEndTime = Date.now() + nextStep.durationSec * 1000;
      }
      this.sendDesktopAlert(
        'Posture: Lower desk / Return to sit',
        'Movement/stretch break complete. Return to seated neutral posture (lumbar supported, elbows 90°).'
      );
    } else if (breakKey === 'musculoskeletal_reset') {
      const mEngine = this.engines[breakKey];
      mEngine.stepIndex = 0;
      const focusStep = mEngine.proto.steps[0];
      mEngine.durationSec = focusStep.durationSec;
      mEngine.remainingSec = focusStep.durationSec;
      if (mEngine.isRunning) {
        mEngine.targetEndTime = Date.now() + focusStep.durationSec * 1000;
      }
      this.sendDesktopAlert(
        'Microbreak Complete',
        '60-second reset complete. Resume seated work in neutral alignment.'
      );
    }

    this.savePersistedState();
    this.updateMetricsUI();
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
    sound.playCompletionChime();
  }

  snoozeBreak() {
    if (this.breakTimerInterval) {
      clearInterval(this.breakTimerInterval);
      this.breakTimerInterval = null;
    }
    const modal = document.getElementById('break-modal');
    if (modal) modal.classList.add('hidden');

    const key = this.breakActiveProtocolKey;
    this.breakActiveProtocolKey = null;

    // Postpone the snoozed break protocol for 5 minutes without killing running timers
    const engine = this.engines[key] || this.eyeEngine;
    engine.durationSec = 5 * 60;
    engine.remainingSec = 5 * 60;
    if (engine.isRunning) {
      engine.targetEndTime = Date.now() + 5 * 60 * 1000;
    } else {
      this.startEngine(engine);
    }

    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
  }

  // Render full Clinical Stretch Library
  renderStretches() {
    const grid = document.getElementById('stretch-cards-grid');
    if (!grid) return;
    grid.replaceChildren();

    CORNELL_STRETCHES.forEach((stretch) => {
      const card = document.createElement('div');
      card.className = 'stretch-card glass-panel';

      const header = document.createElement('div');
      header.className = 'stretch-card-header';

      const target = document.createElement('span');
      target.className = 'stretch-target-badge';
      target.textContent = stretch.target;

      const dur = document.createElement('span');
      dur.className = 'stretch-duration-badge';
      dur.textContent = `${stretch.durationSec}s Hold`;

      header.appendChild(target);
      header.appendChild(dur);

      const title = document.createElement('h4');
      title.className = 'stretch-name';
      title.textContent = stretch.name;

      const desc = document.createElement('p');
      desc.className = 'stretch-desc';
      desc.textContent = stretch.instruction;

      const benefit = document.createElement('div');
      benefit.className = 'stretch-benefit';
      benefit.innerHTML = `<strong>🩺 Clinical Benefit:</strong> ${stretch.clinicalBenefit}`;

      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(benefit);

      grid.appendChild(card);
    });
  }

  // Ergonomic Audit Items
  renderAuditItems() {
    const list = document.getElementById('audit-items-list');
    if (!list) return;
    list.replaceChildren();

    CORNELL_ERGONOMICS_AUDIT.forEach((item, idx) => {
      const isChecked = this.auditAnswers.has(idx);

      const div = document.createElement('div');
      div.className = `audit-item ${isChecked ? 'checked' : ''}`;

      const box = document.createElement('div');
      box.className = 'audit-checkbox';
      if (isChecked) box.textContent = '✓';

      const textWrap = document.createElement('div');
      textWrap.className = 'audit-text';

      const title = document.createElement('div');
      title.className = 'audit-item-title';
      title.textContent = item.title;

      const std = document.createElement('div');
      std.className = 'audit-item-std';
      std.textContent = item.standard;

      const impact = document.createElement('div');
      impact.className = 'audit-item-impact';
      impact.textContent = `Clinical Guidance: ${item.clinicalImpact}`;

      textWrap.appendChild(title);
      textWrap.appendChild(std);
      textWrap.appendChild(impact);

      div.appendChild(box);
      div.appendChild(textWrap);

      div.addEventListener('click', () => {
        if (this.auditAnswers.has(idx)) {
          this.auditAnswers.delete(idx);
        } else {
          this.auditAnswers.add(idx);
        }
        this.updateAuditScore();
        this.renderAuditItems();
      });

      list.appendChild(div);
    });

    this.updateAuditScore();
  }

  updateAuditScore() {
    const total = CORNELL_ERGONOMICS_AUDIT.length;
    const checked = this.auditAnswers.size;
    const pct = Math.round((checked / total) * 100);

    const scoreVal = document.getElementById('audit-score-val');
    const scoreStatus = document.getElementById('audit-score-status');

    if (scoreVal) scoreVal.textContent = `${pct}%`;
    if (scoreStatus) {
      if (pct === 100) {
        scoreStatus.textContent = 'Optimal Cornell Neutral Alignment';
        scoreStatus.style.color = '#34d399';
      } else if (pct >= 70) {
        scoreStatus.textContent = 'Moderate Musculoskeletal Strain Risk';
        scoreStatus.style.color = '#f59e0b';
      } else {
        scoreStatus.textContent = 'High Cumulative Strain Risk - Adjust Workstation';
        scoreStatus.style.color = '#f43f5e';
      }
    }

    this.metrics.complianceScore = pct;
    this.updateMetricsUI();
  }

  updateMetricsUI() {
    const bEl = document.getElementById('metric-breaks-count');
    const eEl = document.getElementById('metric-eye-count');
    const sEl = document.getElementById('metric-stand-min');
    const cEl = document.getElementById('metric-compliance');

    if (bEl) bEl.textContent = String(this.metrics.breaksCount);
    if (eEl) eEl.textContent = String(this.metrics.eyeRestsCount);
    if (sEl) sEl.textContent = `${this.metrics.standingMinutes}m`;
    if (cEl) cEl.textContent = `${this.metrics.complianceScore}%`;
  }

  setupUI() {
    // Protocol Bar Tabs (Simplified to just clean bold titles)
    document.querySelectorAll('.protocol-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const protoKey = tab.getAttribute('data-protocol');
        const viewKey = tab.getAttribute('data-view');
        if (viewKey) {
          this.switchView(viewKey);
        } else if (protoKey) {
          this.switchView(protoKey);
        }
      });
    });

    // Master 1-Click Toggle Button
    document.getElementById('btn-master-toggle')?.addEventListener('click', () => {
      this.startBothProtocols();
    });

    // Individual Protocol Timer card controls
    document.getElementById('btn-toggle-timer')?.addEventListener('click', () => {
      const engine = this.currentEngine;
      if (engine.isRunning) {
        this.pauseEngine(engine);
      } else {
        // If starting a posture/microbreak engine, align activePostureKey and pause competing posture engines
        if (engine.proto.type === 'posture' || engine.id === 'musculoskeletal_reset') {
          for (const [k, eng] of Object.entries(this.engines)) {
            if (k !== 'eye_rest' && k !== engine.id && eng.isRunning) {
              this.pauseEngine(eng);
            }
          }
          this.activePostureKey = engine.id;
          this.savePersistedState();
        }
        this.startEngine(engine);
      }
      this.updateMasterBarDisplay();
      this.updateTabsDisplay();
      this.updateProtocolTimerCardDisplay();
      this.syncTrayStatus();
    });

    document.getElementById('btn-break-now')?.addEventListener('click', () => {
      this.breakActiveProtocolKey = this.activeView === 'stretches' ? 'eye_rest' : this.activeView;
      const engine = this.engines[this.breakActiveProtocolKey] || this.eyeEngine;
      if (this.breakActiveProtocolKey === 'eye_rest') {
        this.eyeEngine.stepIndex = 1;
        this.eyeEngine.durationSec = 20;
        this.eyeEngine.remainingSec = 20;
        this.eyeEngine.targetEndTime = Date.now() + 20 * 1000;
      } else if (engine.proto.type === 'posture') {
        const stretchIdx = engine.proto.steps.findIndex(s => s.shortName === 'Stretch' || s.shortName === 'Move');
        if (stretchIdx >= 0) {
          engine.stepIndex = stretchIdx;
          const sStep = engine.proto.steps[stretchIdx];
          engine.durationSec = sStep.durationSec;
          engine.remainingSec = sStep.durationSec;
          engine.targetEndTime = Date.now() + sStep.durationSec * 1000;
        }
      }
      this.startBreakExperience();
      this.updateMasterBarDisplay();
      this.syncTrayStatus();
    });

    document.getElementById('btn-reset-timer')?.addEventListener('click', () => {
      this.resetEngine(this.currentEngine);
    });

    // Break modal buttons
    document.getElementById('btn-close-break')?.addEventListener('click', () => {
      document.getElementById('break-modal')?.classList.add('hidden');
      if (this.breakTimerInterval) {
        clearInterval(this.breakTimerInterval);
        this.breakTimerInterval = null;
      }
      if (this.breakActiveProtocolKey === 'eye_rest' && this.eyeEngine.stepIndex === 1) {
        this.eyeEngine.stepIndex = 0;
        const focusStep = this.eyeEngine.proto.steps[0];
        this.eyeEngine.durationSec = focusStep.durationSec;
        this.eyeEngine.remainingSec = focusStep.durationSec;
        if (this.eyeEngine.isRunning) {
          this.eyeEngine.targetEndTime = Date.now() + focusStep.durationSec * 1000;
        }
      }
      this.breakActiveProtocolKey = null;
      this.updateMasterBarDisplay();
      this.updateTabsDisplay();
      this.syncTrayStatus();
    });
    document.getElementById('btn-snooze-break')?.addEventListener('click', () => this.snoozeBreak());
    document.getElementById('btn-finish-break')?.addEventListener('click', () => this.completeBreakSession());
    document.getElementById('btn-next-exercise')?.addEventListener('click', () => this.nextRoutine());

    // Sound toggle
    const soundBtn = document.getElementById('btn-sound-toggle');
    const soundOn = document.getElementById('icon-sound-on');
    const soundOff = document.getElementById('icon-sound-off');

    soundBtn?.addEventListener('click', () => {
      this.settings.audioChimes = !this.settings.audioChimes;
      sound.setMuted(!this.settings.audioChimes);
      this.savePersistedState();

      if (this.settings.audioChimes) {
        soundOn?.classList.remove('hidden');
        soundOff?.classList.add('hidden');
        sound.playCompletionChime();
      } else {
        soundOn?.classList.add('hidden');
        soundOff?.classList.remove('hidden');
      }
    });

    // Ergo Audit Modal
    const auditModal = document.getElementById('audit-modal');
    document.getElementById('btn-audit-open')?.addEventListener('click', () => {
      auditModal?.classList.remove('hidden');
    });
    document.getElementById('btn-close-audit')?.addEventListener('click', () => {
      auditModal?.classList.add('hidden');
    });
    document.getElementById('btn-save-audit')?.addEventListener('click', () => {
      auditModal?.classList.add('hidden');
      this.savePersistedState();
    });

    // Settings Modal
    const settingsModal = document.getElementById('settings-modal');
    document.getElementById('btn-settings-toggle')?.addEventListener('click', () => {
      settingsModal?.classList.remove('hidden');
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      settingsModal?.classList.add('hidden');
    });

    // Settings Test Notification Button
    document.getElementById('btn-test-notification')?.addEventListener('click', async () => {
      await this.sendDesktopAlert(
        'Spine & Eye Notification Test',
        'Native desktop notifications and acoustic audio chimes are functioning properly!'
      );
      sound.playCompletionChime();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const nativeNotif = document.getElementById('chk-native-notif')?.checked ?? true;
      const audioChimes = document.getElementById('chk-audio-chimes')?.checked ?? true;
      const autoBreak = document.getElementById('chk-auto-break')?.checked ?? true;
      const sitTime = parseInt(document.getElementById('inp-sit-time')?.value || '20', 10);
      const standTime = parseInt(document.getElementById('inp-stand-time')?.value || '8', 10);
      const aaoTime = parseInt(document.getElementById('inp-aao-time')?.value || '20', 10);

      this.settings = { nativeNotif, audioChimes, autoBreak, sitTime, standTime, aaoTime };
      sound.setMuted(!audioChimes);

      // Apply updated durations to protocols
      this.engines.eye_rest.proto.steps[0].durationSec = aaoTime * 60;
      this.engines.posture_default.proto.steps[0].durationSec = sitTime * 60;
      this.engines.posture_default.proto.steps[1].durationSec = standTime * 60;

      this.savePersistedState();
      settingsModal?.classList.add('hidden');
      this.updateProtocolView();
      this.updateMasterBarDisplay();
    });

    // Guided Stretch Flow Button in Stretch Library
    document.getElementById('btn-start-stretch-flow')?.addEventListener('click', () => {
      this.breakActiveProtocolKey = 'posture_default';
      this.startBreakExperience();
    });

    // Minimize to System Tray Button
    document.getElementById('btn-minimize-tray')?.addEventListener('click', async () => {
      if (isTauri && tauriCore?.invoke) {
        try {
          await tauriCore.invoke('hide_to_tray');
        } catch (err) {
          console.warn('Hide to tray invoke:', err);
        }
      }
    });

    // About & License Modal
    const aboutModal = document.getElementById('about-modal');
    document.getElementById('btn-about-open')?.addEventListener('click', () => {
      aboutModal?.classList.remove('hidden');
    });
    document.getElementById('btn-close-about')?.addEventListener('click', () => {
      aboutModal?.classList.add('hidden');
    });
    document.getElementById('btn-dismiss-about')?.addEventListener('click', () => {
      aboutModal?.classList.add('hidden');
    });

    // Intercept clicks on research and about links to open safely in external default browser
    document.getElementById('protocol-research-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      const href = e.currentTarget.getAttribute('href');
      if (href) openExternalUrl(href);
    });

    document.querySelectorAll('.about-link-item').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href) openExternalUrl(href);
      });
    });
  }
}

export const appState = new AppState();
document.addEventListener('DOMContentLoaded', () => {
  appState.init();
});
