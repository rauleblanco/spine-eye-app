import { CLINICAL_PROTOCOLS, CORNELL_STRETCHES, AAO_EYE_EXERCISES, CORNELL_ERGONOMICS_AUDIT } from './ergonomics.js';
import { sound } from './audio.js';

// Detect whether running in Tauri desktop environment or webview
const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

let tauriCore = null;
let tauriEvent = null;
let tauriNotification = null;
let tauriUpdater = null;
let tauriProcess = null;

async function initTauriBindings() {
  if (isTauri) {
    try {
      tauriCore = await import('@tauri-apps/api/core');
      tauriEvent = await import('@tauri-apps/api/event');
      tauriNotification = await import('@tauri-apps/plugin-notification');
      try {
        tauriUpdater = await import('@tauri-apps/plugin-updater');
        tauriProcess = await import('@tauri-apps/plugin-process');
      } catch (updaterErr) {
        console.warn('Tauri updater/process plugin note:', updaterErr);
      }

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

      if (typeof appState?.renderAboutVersion === 'function') {
        appState.renderAboutVersion();
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
    this.activeView = 'eye_rest'; // 'eye_rest', 'posture_default', 'posture_deep_work', 'musculoskeletal_reset', 'posture_custom', 'stretches'
    this.activePostureKey = 'posture_default'; // Selected posture protocol for simultaneous dual sync

    // Custom Posture Configuration (Stand, Sit, Stretch with configurable intervals)
    this.customPostureConfig = {
      stand: { enabled: true, minutes: 10 },
      sit: { enabled: true, minutes: 20 },
      stretch: { enabled: true, minutes: 2 }
    };

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

    this.applyCustomPostureConfig(this.customPostureConfig, false);

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
      return this.engines[this.activePostureKey] || this.engines.posture_default;
    }
    return this.engines[this.activeView] || this.engines.eye_rest;
  }

  get eyeEngine() {
    return this.engines.eye_rest;
  }

  get postureEngine() {
    // 1. If ANY posture/microbreak engine is currently running, prioritize the running engine!
    const postureKeys = ['posture_default', 'posture_deep_work', 'musculoskeletal_reset', 'posture_custom'];
    for (const key of postureKeys) {
      if (this.engines[key]?.isRunning) {
        if (this.activePostureKey !== key) {
          this.activePostureKey = key;
        }
        return this.engines[key];
      }
    }
    // 2. Otherwise, return currently selected activePostureKey engine
    if (this.activePostureKey && this.engines[this.activePostureKey]) {
      return this.engines[this.activePostureKey];
    }
    return this.engines.posture_default;
  }

  applyCustomPostureConfig(config, updateRuntime = true) {
    if (!config) return;
    this.customPostureConfig = config;

    const steps = [];
    if (config.stand?.enabled) {
      const standSec = Math.max(1, Number(config.stand.minutes) || 10) * 60;
      steps.push({
        id: 'stand',
        name: 'Stand',
        shortName: 'Stand',
        durationSec: standSec,
        icon: '🧍',
        timestampLabel: 'Stand',
        guidance: 'Stand: Weight evenly distributed on both feet, soft knees, forearms at 90°–100°.',
        nextStep: 'Transition to next phase'
      });
    }

    if (config.sit?.enabled) {
      const sitSec = Math.max(1, Number(config.sit.minutes) || 20) * 60;
      steps.push({
        id: 'sit',
        name: 'Sit (Neutral Posture)',
        shortName: 'Sit',
        durationSec: sitSec,
        icon: '🪑',
        timestampLabel: 'Sit',
        guidance: 'Sit: Lumbar supported, elbows 90°, top of screen at eye level, feet flat on floor.',
        nextStep: 'Transition to next phase'
      });
    }

    if (config.stretch?.enabled) {
      const stretchSec = Math.max(1, Number(config.stretch.minutes) || 2) * 60;
      steps.push({
        id: 'stretch',
        name: 'Step away, stretch, hydrate',
        shortName: 'Stretch',
        durationSec: stretchSec,
        icon: '🧘',
        timestampLabel: 'Stretch',
        guidance: 'Step away, stretch, hydrate: Perform cervical retractions and shoulder rolls.',
        nextStep: 'Transition to next phase'
      });
    }

    // Fallback: at least 1 step required
    if (steps.length === 0) {
      steps.push({
        id: 'stand',
        name: 'Stand',
        shortName: 'Stand',
        durationSec: 10 * 60,
        icon: '🧍',
        timestampLabel: 'Stand',
        guidance: 'Stand upright with soft knees.',
        nextStep: 'Resume routine'
      });
    }

    // Compute dynamic next step labels
    for (let i = 0; i < steps.length; i++) {
      const next = steps[(i + 1) % steps.length];
      const nextMin = Math.round(next.durationSec / 60);
      steps[i].nextStep = `Next: ${next.name} (${nextMin >= 1 ? `${nextMin} min` : `${next.durationSec} sec`})`;
    }

    const totalMins = Math.round(steps.reduce((acc, s) => acc + s.durationSec, 0) / 60);
    CLINICAL_PROTOCOLS.posture_custom.steps = steps;
    CLINICAL_PROTOCOLS.posture_custom.intervalDescription = `${totalMins}-min custom cycle: • ${steps.map(s => `${Math.round(s.durationSec / 60)} min ${s.shortName}`).join(' • ')}`;

    if (this.engines.posture_custom) {
      this.engines.posture_custom.proto = CLINICAL_PROTOCOLS.posture_custom;
      if (this.engines.posture_custom.stepIndex >= steps.length) {
        this.engines.posture_custom.stepIndex = 0;
      }
      const currentStep = steps[this.engines.posture_custom.stepIndex];
      if (updateRuntime) {
        this.engines.posture_custom.durationSec = currentStep.durationSec;
        if (this.engines.posture_custom.isRunning) {
          this.engines.posture_custom.remainingSec = currentStep.durationSec;
          this.engines.posture_custom.targetEndTime = Date.now() + currentStep.durationSec * 1000;
        } else {
          this.engines.posture_custom.remainingSec = currentStep.durationSec;
        }
      }
    }

    this.savePersistedState();

    if (this.activeView === 'posture_custom') {
      this.updateProtocolView();
    }
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
  }

  setSimultaneousPosture(newKey) {
    if (!this.engines[newKey] || newKey === 'eye_rest') return;
    if (this.activePostureKey === newKey) return;

    const prevKey = this.activePostureKey;
    const prevEngine = this.engines[prevKey];
    const wasRunning = prevEngine?.isRunning;

    if (wasRunning) {
      this.pauseEngine(prevEngine);
    }

    this.activePostureKey = newKey;

    if (wasRunning) {
      const newEngine = this.engines[newKey];
      this.startEngine(newEngine);
    }

    this.savePersistedState();
    this.updatePairedStatusUI();
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();

    if (this.activeView !== 'stretches') {
      this.updateProtocolTimerCardDisplay();
    }
    this.syncTrayStatus();
  }

  updatePairedStatusUI() {
    const selectEl = document.getElementById('select-simultaneous-posture');
    if (selectEl && selectEl.value !== this.activePostureKey) {
      selectEl.value = this.activePostureKey;
    }

    const nameEl = document.getElementById('tracker-posture-name');
    if (nameEl) {
      const names = {
        posture_default: 'Default',
        posture_deep_work: 'Deep Work',
        musculoskeletal_reset: 'Reset',
        posture_custom: 'Custom'
      };
      nameEl.textContent = names[this.activePostureKey] || 'Posture';
    }

    // Update paired pills on tabs
    const postureKeys = ['posture_default', 'posture_deep_work', 'musculoskeletal_reset', 'posture_custom'];
    for (const key of postureKeys) {
      const pill = document.getElementById(`paired-pill-${key}`);
      if (pill) {
        pill.classList.toggle('hidden', key !== this.activePostureKey);
      }
    }

    // Update header pair button in protocol details
    const pairBtn = document.getElementById('btn-pair-simultaneous');
    const pairLabel = document.getElementById('pair-btn-label');
    const pairIcon = document.getElementById('pair-btn-icon');
    if (pairBtn) {
      const isPostureTab = this.activeView && (this.engines[this.activeView]?.proto?.type === 'posture' || this.activeView === 'musculoskeletal_reset');
      if (isPostureTab) {
        pairBtn.classList.remove('hidden');
        const isCurrentPaired = this.activeView === this.activePostureKey;
        pairBtn.classList.toggle('is-paired', isCurrentPaired);
        if (pairLabel) {
          pairLabel.textContent = isCurrentPaired ? '✓ Paired with Vision' : 'Pair with Vision';
        }
        if (pairIcon) {
          pairIcon.textContent = isCurrentPaired ? '★' : '⚡';
        }
      } else {
        pairBtn.classList.add('hidden');
      }
    }
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
    this.updatePairedStatusUI();
    this.syncTrayStatus();
    this.startMasterTicker();
    initTauriBindings();
  }

  async renderAboutVersion() {
    const versionEl = document.getElementById('about-app-version');
    if (!versionEl) return;
    const baseVersion = import.meta.env.VITE_APP_VERSION || '0.1.26';
    const buildNum = import.meta.env.VITE_BUILD_NUMBER;
    const commitSha = import.meta.env.VITE_COMMIT_SHA ? import.meta.env.VITE_COMMIT_SHA.substring(0, 7) : null;

    let versionText = `v${baseVersion}`;
    if (buildNum) {
      versionText += ` • Build #${buildNum}`;
      if (commitSha) {
        versionText += ` (${commitSha})`;
      }
    }

    if (isTauri && tauriCore?.invoke) {
      try {
        const nativeVersion = await tauriCore.invoke('get_app_version_string');
        if (nativeVersion && nativeVersion.trim()) {
          versionText = nativeVersion;
        }
      } catch (err) {
        // Fall back to Vite-generated string
      }
    }

    this.currentAppVersion = versionText;
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
      const savedCustom = localStorage.getItem('spineeye_custom_posture');
      if (savedCustom) {
        this.applyCustomPostureConfig(JSON.parse(savedCustom), false);
      }
      const savedPosture = localStorage.getItem('spineeye_posture_key') || localStorage.getItem('deskhealth_posture_key');
      if (savedPosture && this.engines[savedPosture] && savedPosture !== 'eye_rest') {
        this.activePostureKey = savedPosture;
      }
      const savedView = localStorage.getItem('spineeye_active_view');
      if (savedView && (this.engines[savedView] || savedView === 'stretches')) {
        this.activeView = savedView;
      }

      // Restore engine runtime states smoothly
      const savedEngineStates = localStorage.getItem('spineeye_engine_states');
      if (savedEngineStates) {
        const parsed = JSON.parse(savedEngineStates);
        const now = Date.now();
        for (const [k, state] of Object.entries(parsed)) {
          if (this.engines[k] && state) {
            this.engines[k].stepIndex = state.stepIndex || 0;
            this.engines[k].durationSec = state.durationSec || this.engines[k].proto.steps[this.engines[k].stepIndex]?.durationSec || 60;
            if (state.isRunning && state.targetEndTime) {
              const remainingMs = state.targetEndTime - now;
              if (remainingMs > 0) {
                this.engines[k].isRunning = true;
                this.engines[k].targetEndTime = state.targetEndTime;
                this.engines[k].remainingSec = Math.ceil(remainingMs / 1000);
              } else {
                // Step expired while inactive: advance step cleanly
                this.engines[k].isRunning = true;
                this.onEngineStepComplete(this.engines[k]);
              }
            } else {
              this.engines[k].isRunning = false;
              this.engines[k].targetEndTime = null;
              this.engines[k].remainingSec = (typeof state.remainingSec === 'number') ? state.remainingSec : this.engines[k].durationSec;
            }
          }
        }
      }

      // Ensure activePostureKey aligns with any running posture engine
      const postureKeys = ['posture_default', 'posture_deep_work', 'musculoskeletal_reset', 'posture_custom'];
      for (const k of postureKeys) {
        if (this.engines[k]?.isRunning) {
          this.activePostureKey = k;
          break;
        }
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
      localStorage.setItem('spineeye_active_view', this.activeView);
      if (this.customPostureConfig) {
        localStorage.setItem('spineeye_custom_posture', JSON.stringify(this.customPostureConfig));
      }

      // Persist engine runtime state (targetEndTime, isRunning, stepIndex, durationSec, remainingSec)
      const engineStates = {};
      for (const [k, eng] of Object.entries(this.engines)) {
        engineStates[k] = {
          isRunning: eng.isRunning,
          targetEndTime: eng.targetEndTime,
          remainingSec: eng.remainingSec,
          stepIndex: eng.stepIndex,
          durationSec: eng.durationSec
        };
      }
      localStorage.setItem('spineeye_engine_states', JSON.stringify(engineStates));
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
    } else if (engine.id === 'posture_custom') {
      if (completedStep.shortName === 'Stand') {
        alertTitle = 'Custom Posture: Stand Interval Complete';
        alertBody = `${nextStep.name}: ${nextStep.guidance}`;
      } else if (completedStep.shortName === 'Sit') {
        alertTitle = 'Custom Posture: Sit Interval Complete';
        alertBody = `${nextStep.name}: ${nextStep.guidance}`;
      } else if (completedStep.shortName === 'Stretch') {
        alertTitle = 'Custom Posture: Stretch Interval Complete';
        alertBody = `${nextStep.name}: ${nextStep.guidance}`;
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
      // If no posture protocol is currently running, automatically align activePostureKey with viewed posture tab
      if (this.engines[key].proto.type === 'posture' || key === 'musculoskeletal_reset') {
        const currentRunningPosture = this.postureEngine;
        if (!currentRunningPosture?.isRunning) {
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

  // Dual Protocol "Start Vision + Posture"
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

    if (this.activeView !== 'stretches' && this.currentEngine === engine) {
      this.renderPostureStepper(engine.proto, 0);
      this.updateProtocolTimerCardDisplay();
    }
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
    this.syncTrayStatus();
  }

  resetAllProtocols() {
    if (this.breakTimerInterval) {
      clearInterval(this.breakTimerInterval);
      this.breakTimerInterval = null;
    }
    document.getElementById('break-modal')?.classList.add('hidden');
    this.breakActiveProtocolKey = null;

    for (const engine of Object.values(this.engines)) {
      this.pauseEngine(engine);
      engine.stepIndex = 0;
      const firstStep = engine.proto.steps[0];
      engine.durationSec = firstStep.durationSec;
      engine.remainingSec = firstStep.durationSec;
      engine.targetEndTime = null;
    }

    if (this.activeView !== 'stretches') {
      this.renderPostureStepper(this.currentEngine.proto, 0);
      this.updateProtocolTimerCardDisplay();
    }
    this.updateMasterBarDisplay();
    this.updateTabsDisplay();
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
    if (nameEl) {
      if (proto.id === 'posture_deep_work') {
        nameEl.innerHTML = 'Macro Ratio<span class="detail-subtitle">(3:1 to 1:1)</span>';
      } else {
        nameEl.textContent = proto.name;
      }
    }
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

    // Show/hide and populate custom posture configuration card
    const customConfigCard = document.getElementById('custom-posture-config-card');
    if (customConfigCard) {
      if (this.activeView === 'posture_custom') {
        customConfigCard.classList.remove('hidden');
        const cfg = this.customPostureConfig || {
          stand: { enabled: true, minutes: 10 },
          sit: { enabled: true, minutes: 20 },
          stretch: { enabled: true, minutes: 2 }
        };
        const chkStand = document.getElementById('check-step-stand');
        const durStand = document.getElementById('custom-dur-stand');
        const chkSit = document.getElementById('check-step-sit');
        const durSit = document.getElementById('custom-dur-sit');
        const chkStretch = document.getElementById('check-step-stretch');
        const durStretch = document.getElementById('custom-dur-stretch');

        if (chkStand) chkStand.checked = Boolean(cfg.stand?.enabled);
        if (durStand) durStand.value = cfg.stand?.minutes || 10;
        if (chkSit) chkSit.checked = Boolean(cfg.sit?.enabled);
        if (durSit) durSit.value = cfg.sit?.minutes || 20;
        if (chkStretch) chkStretch.checked = Boolean(cfg.stretch?.enabled);
        if (durStretch) durStretch.value = cfg.stretch?.minutes || 2;
      } else {
        customConfigCard.classList.add('hidden');
      }
    }

    this.renderPostureStepper(proto, engine.stepIndex);
    this.updateProtocolTimerCardDisplay();
    this.updatePairedStatusUI();
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
    const masterAction = document.getElementById('master-btn-action');
    const masterSub = document.getElementById('master-btn-sub');
    const masterBtnLabel = document.getElementById('master-btn-label');
    const masterPlay = document.getElementById('master-icon-play');
    const masterPause = document.getElementById('master-icon-pause');

    const bothRunning = eye.isRunning && posture.isRunning;
    const anyRunning = eye.isRunning || posture.isRunning || Object.values(this.engines).some(e => e.isRunning);

    if (masterAction && masterSub) {
      if (bothRunning) {
        masterAction.textContent = 'Pause';
        masterSub.textContent = 'Both Protocols';
      } else if (anyRunning) {
        masterAction.textContent = 'Resume';
        masterSub.textContent = 'Both Protocols';
      } else {
        masterAction.textContent = 'Start';
        masterSub.textContent = 'Vision + Posture';
      }
    } else if (masterBtnLabel) {
      if (bothRunning) {
        masterBtnLabel.textContent = 'Pause Both Protocols';
      } else if (anyRunning) {
        masterBtnLabel.textContent = 'Resume Both Protocols';
      } else {
        masterBtnLabel.textContent = 'Start Vision + Posture';
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
    this.updatePairedStatusUI();
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
    const badgePostCustom = document.getElementById('tab-badge-posture-custom');

    if (badgeEye) badgeEye.textContent = this.eyeEngine.isRunning ? formatMini(this.eyeEngine) : '20-20-20';
    if (badgePostDef) badgePostDef.textContent = this.engines.posture_default.isRunning ? formatMini(this.engines.posture_default) : '20-8-2';
    if (badgePostDeep) badgePostDeep.textContent = this.engines.posture_deep_work.isRunning ? formatMini(this.engines.posture_deep_work) : '45-15';
    if (badgeMicro) badgeMicro.textContent = this.engines.musculoskeletal_reset.isRunning ? formatMini(this.engines.musculoskeletal_reset) : '30m/60s';
    if (badgePostCustom) badgePostCustom.textContent = this.engines.posture_custom.isRunning ? formatMini(this.engines.posture_custom) : 'Custom';
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
    let trayTitle = 'Spine and Eye';

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
    const trayTooltip = `Spine and Eye | Posture: ${activePStep.name} (${ptime} left) • Eye: ${eyeStatusText}`;

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

    // Master Toggle Button (Simultaneous Vision + Posture)
    document.getElementById('btn-master-toggle')?.addEventListener('click', () => {
      this.startBothProtocols();
    });

    // Simultaneous posture selector dropdown in master action bar
    document.getElementById('select-simultaneous-posture')?.addEventListener('change', (e) => {
      this.setSimultaneousPosture(e.target.value);
    });

    // Quick Pair with Vision button in protocol header
    document.getElementById('btn-pair-simultaneous')?.addEventListener('click', () => {
      if (this.activeView && this.engines[this.activeView] && (this.engines[this.activeView].proto.type === 'posture' || this.activeView === 'musculoskeletal_reset')) {
        this.setSimultaneousPosture(this.activeView);
      }
    });

    // Save & apply Custom Posture configuration
    document.getElementById('btn-save-custom-posture')?.addEventListener('click', () => {
      const chkStand = document.getElementById('check-step-stand')?.checked ?? true;
      const durStand = Math.max(1, Math.min(180, parseInt(document.getElementById('custom-dur-stand')?.value || '10', 10)));
      const chkSit = document.getElementById('check-step-sit')?.checked ?? true;
      const durSit = Math.max(1, Math.min(180, parseInt(document.getElementById('custom-dur-sit')?.value || '20', 10)));
      const chkStretch = document.getElementById('check-step-stretch')?.checked ?? true;
      const durStretch = Math.max(1, Math.min(60, parseInt(document.getElementById('custom-dur-stretch')?.value || '2', 10)));

      const statusEl = document.getElementById('custom-save-status');

      if (!chkStand && !chkSit && !chkStretch) {
        if (statusEl) {
          statusEl.textContent = 'Please enable at least 1 step.';
          statusEl.style.color = '#f43f5e';
        }
        return;
      }

      const newConfig = {
        stand: { enabled: chkStand, minutes: durStand },
        sit: { enabled: chkSit, minutes: durSit },
        stretch: { enabled: chkStretch, minutes: durStretch }
      };

      this.applyCustomPostureConfig(newConfig, true);

      if (statusEl) {
        statusEl.textContent = '✓ Saved and applied to custom cycle!';
        statusEl.style.color = '#34d399';
        setTimeout(() => {
          if (statusEl) statusEl.textContent = '';
        }, 3000);
      }
      sound.playCompletionChime();
    });

    // Master Reset All Button (Reset both vision and posture protocols)
    document.getElementById('btn-master-reset')?.addEventListener('click', () => {
      this.resetAllProtocols();
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

    // Initialize In-App Updater
    this.initUpdater();
  }

  initUpdater() {
    this.activeUpdate = null;

    document.getElementById('btn-check-updates')?.addEventListener('click', () => {
      this.checkForUpdates(true);
    });

    document.getElementById('btn-header-update')?.addEventListener('click', () => {
      document.getElementById('about-modal')?.classList.remove('hidden');
      this.checkForUpdates(true);
    });

    document.getElementById('btn-dismiss-updater')?.addEventListener('click', () => {
      document.getElementById('updater-card')?.classList.add('hidden');
    });

    document.getElementById('btn-download-update')?.addEventListener('click', () => {
      this.downloadAndInstallUpdate();
    });

    document.getElementById('btn-relaunch-app')?.addEventListener('click', () => {
      this.relaunchApp();
    });

    // Silent background check after 5s on desktop launch
    setTimeout(() => {
      if (isTauri) {
        this.checkForUpdates(false);
      }
    }, 5000);
  }

  async checkForUpdates(interactive = false) {
    const btnCheck = document.getElementById('btn-check-updates');
    const spinner = document.getElementById('icon-update-spinner');
    const refreshIcon = document.getElementById('icon-update-refresh');
    const labelCheck = document.getElementById('label-check-updates');
    const card = document.getElementById('updater-card');
    const badge = document.getElementById('updater-badge');
    const versionTag = document.getElementById('updater-new-version');
    const notes = document.getElementById('updater-notes');
    const downloadBtn = document.getElementById('btn-download-update');
    const relaunchBtn = document.getElementById('btn-relaunch-app');
    const progressWrap = document.getElementById('updater-progress-wrap');
    const statusText = document.getElementById('updater-status-text');
    const headerPill = document.getElementById('btn-header-update');

    if (interactive) {
      if (btnCheck) btnCheck.disabled = true;
      spinner?.classList.remove('hidden');
      refreshIcon?.classList.add('hidden');
      if (labelCheck) labelCheck.textContent = 'Checking...';

      card?.classList.remove('hidden', 'error', 'up-to-date');
      if (badge) badge.textContent = 'Checking for updates...';
      if (versionTag) versionTag.textContent = '';
      if (notes) notes.textContent = 'Verifying cryptographic release manifest from GitHub...';
      downloadBtn?.classList.add('hidden');
      relaunchBtn?.classList.add('hidden');
      progressWrap?.classList.add('hidden');
      if (statusText) statusText.textContent = '';
    }

    if (!isTauri || !tauriUpdater?.check) {
      if (interactive) {
        if (badge) badge.textContent = 'Development Environment';
        if (notes) notes.textContent = 'In-app updater operates inside packaged desktop binary builds with minisign verification.';
        card?.classList.add('up-to-date');
        if (btnCheck) btnCheck.disabled = false;
        spinner?.classList.add('hidden');
        refreshIcon?.classList.remove('hidden');
        if (labelCheck) labelCheck.textContent = 'Check for Updates';
      }
      return;
    }

    try {
      const update = await tauriUpdater.check();
      if (update?.available) {
        this.activeUpdate = update;
        headerPill?.classList.remove('hidden');
        card?.classList.remove('hidden', 'error', 'up-to-date');
        if (badge) badge.textContent = 'Update Available';
        if (versionTag) versionTag.textContent = `v${update.version}`;
        if (notes) notes.textContent = update.body || `Version ${update.version} is now available.`;
        if (downloadBtn) {
          downloadBtn.classList.remove('hidden');
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download & Install';
        }
      } else {
        if (interactive) {
          card?.classList.remove('hidden', 'error');
          card?.classList.add('up-to-date');
          if (badge) badge.textContent = 'Up to Date';
          const displayedVersion = this.currentAppVersion ? this.currentAppVersion.split(' ')[0] : `v${import.meta.env.VITE_APP_VERSION || '0.1.26'}`;
          if (versionTag) versionTag.textContent = displayedVersion;
          if (notes) notes.textContent = 'You are running the latest version of Spine & Eye Desktop Companion.';
          setTimeout(() => {
            if (!this.activeUpdate) card?.classList.add('hidden');
          }, 4000);
        }
      }
    } catch (err) {
      console.warn('Tauri update check error:', err);
      if (interactive) {
        card?.classList.remove('hidden', 'up-to-date');
        card?.classList.add('error');
        if (badge) badge.textContent = 'Update Server Note';
        if (notes) notes.textContent = 'No update manifest found or server unreachable. Updates are signed and published via GitHub Releases.';
      }
    } finally {
      if (btnCheck) btnCheck.disabled = false;
      spinner?.classList.add('hidden');
      refreshIcon?.classList.remove('hidden');
      if (labelCheck) labelCheck.textContent = 'Check for Updates';
    }
  }

  async downloadAndInstallUpdate() {
    if (!this.activeUpdate) return;
    const downloadBtn = document.getElementById('btn-download-update');
    const relaunchBtn = document.getElementById('btn-relaunch-app');
    const progressWrap = document.getElementById('updater-progress-wrap');
    const progressBar = document.getElementById('updater-progress-bar');
    const statusText = document.getElementById('updater-status-text');
    const badge = document.getElementById('updater-badge');

    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Downloading...';
    }
    progressWrap?.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (statusText) statusText.textContent = 'Starting secure package download...';

    try {
      let downloaded = 0;
      let contentLength = 0;

      await this.activeUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data?.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength || 0;
          if (contentLength > 0) {
            const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (statusText) {
              const mbDl = (downloaded / (1024 * 1024)).toFixed(1);
              const mbTot = (contentLength / (1024 * 1024)).toFixed(1);
              statusText.textContent = `${pct}% (${mbDl} MB / ${mbTot} MB)`;
            }
          } else {
            if (statusText) {
              const mbDl = (downloaded / (1024 * 1024)).toFixed(1);
              statusText.textContent = `${mbDl} MB downloaded`;
            }
          }
        } else if (event.event === 'Finished') {
          if (progressBar) progressBar.style.width = '100%';
          if (statusText) statusText.textContent = 'Package verified and unpacked!';
        }
      });

      if (badge) badge.textContent = 'Update Installed';
      downloadBtn?.classList.add('hidden');
      relaunchBtn?.classList.remove('hidden');
      if (statusText) statusText.textContent = 'Ready to launch updated version.';
    } catch (err) {
      console.error('Update download/install error:', err);
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Retry Install';
      }
      if (statusText) statusText.textContent = `Error during installation: ${err.message || err}`;
    }
  }

  async relaunchApp() {
    if (tauriProcess?.relaunch) {
      try {
        await tauriProcess.relaunch();
      } catch (err) {
        console.warn('Relaunch error:', err);
        // Fallback to reload if relaunch fails
        window.location.reload();
      }
    } else {
      window.location.reload();
    }
  }
}

export const appState = new AppState();
document.addEventListener('DOMContentLoaded', () => {
  appState.init();
});

// Resynchronize on window focus or visibility change to ensure GUI status never drifts
window.addEventListener('focus', () => {
  appState.tickTimers();
  appState.updateMasterBarDisplay();
  appState.updateTabsDisplay();
  if (appState.activeView !== 'stretches') {
    appState.updateProtocolTimerCardDisplay();
  }
  appState.syncTrayStatus();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    appState.tickTimers();
    appState.updateMasterBarDisplay();
    appState.updateTabsDisplay();
    if (appState.activeView !== 'stretches') {
      appState.updateProtocolTimerCardDisplay();
    }
    appState.syncTrayStatus();
  }
});
