# Spine & Eye 🌿

> **An always-on, cross-platform background reminder app for macOS and Windows 11**, built on **Tauri v2** with a persistent system tray/menu bar architecture and seeded with clinical ergonomics standards from **Cornell University Ergonomics (CUErgo)** and the **American Academy of Ophthalmology (AAO)**.

[![GitHub Release](https://img.shields.io/github/v/release/rauleblanco/spine-eye-app?color=10b981&label=latest%20release)](https://github.com/rauleblanco/spine-eye-app/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%2011-8b5cf6.svg)]()
[![Node](https://img.shields.io/badge/node-v24.21.0%20LTS-brightgreen.svg)]()

---

## 📥 Download & Installation (Latest Release)

Precompiled desktop binaries for macOS and Windows 11 are automatically built by GitHub Actions and hosted on the **[GitHub Releases Page](https://github.com/rauleblanco/spine-eye-app/releases/latest)**.

### 🍎 macOS Installation (Apple Silicon & Intel)

1. **Download**: Grab `Spine_and_Eye_universal.dmg` (or `Spine_and_Eye.app.tar.gz`) from the [latest release](https://github.com/rauleblanco/spine-eye-app/releases/latest).
2. **Install**: Open the `.dmg` and drag **Spine and Eye.app** into your `/Applications` folder.
3. **Launch (Handling Apple Gatekeeper)**:  
   Because Spine & Eye is open-source and distributed without an expensive annual Apple Developer Program commercial certificate, it uses an ad-hoc self-signature (`APPLE_SIGNING_IDENTITY: "-"`). macOS attaches a quarantine flag to files downloaded through web browsers.

   Choose either method below to launch the app:

   #### Method A: One-line Terminal Command (Fastest & Cleanest)
   Open **Terminal** and run:
   ```bash
   xattr -cr "/Applications/Spine and Eye.app"
   ```
   *This strips the quarantine attribute. Spine & Eye will now open directly on double-click with zero security warnings.*

   #### Method B: System Settings (GUI)
   1. Double-click `Spine and Eye.app` in `/Applications`. Gatekeeper will display a prompt: *"Spine and Eye cannot be opened because it is from an unidentified developer."* Click **Done** / **Cancel**.
   2. Open **System Settings** → **Privacy & Security**.
   3. Scroll down to the **Security** section where you will see:  
      *"'Spine & Eye' was blocked from use because it is not from an identified developer."*
   4. Click **Open Anyway** and enter your Mac administrator password when prompted.

---

### 🪟 Windows 11 Installation (64-bit)

1. **Download**: Grab `Spine_and_Eye_x64-setup.exe` (or the `.msi` package) from the [latest release](https://github.com/rauleblanco/spine-eye-app/releases/latest).
2. **Install**: Double-click the downloaded setup file.
3. **Launch (Handling Windows Defender SmartScreen)**:  
   When launching the installer, Windows SmartScreen may show a blue prompt:  
   *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
   1. Click the underlined **"More info"** link.
   2. Click the **"Run anyway"** button.
   3. Follow the setup wizard to complete the installation. Once installed, the app launches seamlessly.

---

## 🏛️ Clinical Ergonomics Foundation

Spine & Eye is designed from empirical clinical research rather than generic productivity timers:

### 1. American Academy of Ophthalmology (AAO)
- **The 20-20-20 Rule**: For every 20 minutes of screen work, focus on an object at least 20 feet away for 20 seconds. This releases chronic tension in the eye's ciliary muscle caused by sustained near-point accommodation convergence.
- **Conscious Blink Protocol**: Screen concentration reduces average blink rate by 60% (from 18–20 blinks/min down to 6–8 blinks/min), causing tear film evaporation. Spine & Eye provides guided, paced conscious blinking to restore the meibomian lipid layer.
- **Smooth Pursuit Coordination**: Guided infinity (figure-eight) ocular tracking to coordinate all six extraocular muscles.
- **Reference**: [AAO Computer Displays & Digital Eye Strain](https://www.aao.org/eye-health/tips-prevention/computer-displays).

### 2. Cornell University Ergonomics Web (CUErgo)
- **The Hedge 20-8-2 Work Pattern** *(Prof. Alan Hedge)*:
  - **20 Minutes Sitting** in neutral posture.
  - **8 Minutes Standing** to promote vascular circulation.
  - **2 Minutes Moving & Stretching** to relieve static musculoskeletal loads.
- **Neutral Posture Standards**:
  - Top 1/3 of monitor at or slightly below eye level.
  - 20–28 inch viewing distance (arm's length).
  - Elbows at 90°–100° resting horizontal.
  - Wrists straight and neutral (avoiding carpal tunnel pressure spikes).
  - Lumbar support engaged to preserve natural spinal lordosis.
- **Physical Microbreak Routine**: 6 evidence-based stretches including cervical retraction (chin tucks), thoracic extension, scapular pinching, and median nerve glides.
- **Cornell Ergonomics Self-Audit Tool**: Interactive 7-point clinical checklist assessing workstation ergonomics and providing immediate corrective feedback.
- **Reference**: [Cornell University Ergonomics Web (CUErgo) Computer Workstation Guidelines](https://ergo.human.cornell.edu/cuergoguide.html).

---

## ⚙️ Architecture: Tauri v2 & System Tray

```
┌────────────────────────────────────────────────────────┐
│                   Desktop OS Tray                      │
│      (macOS Menu Bar / Windows System Notification)    │
└──────────────────────────┬─────────────────────────────┘
                           │
             Tray Events & Close Prevention
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 Rust Tauri v2 Backend                  │
│  - System Tray Menu (Pause 30m/1h, Break, Resume, Quit) │
│  - Window Close Interception (Hide to Tray 24/7)       │
│  - Native System Notification Dispatch                 │
│  - Ad-hoc Self-Signature Linker Config                 │
└──────────────────────────┬─────────────────────────────┘
                           │ IPC Events & Commands
┌──────────────────────────▼─────────────────────────────┐
│               Frontend Interface (Vite)                │
│  - Bioluminescent Glassmorphic Design System           │
│  - Circular SVG Ergonomics Progress Timer Ring         │
│  - Procedural Web Audio API Harmonic Chimes (528 Hz)   │
│  - Interactive Guided Break Overlay                    │
│  - Cornell 7-Point Ergonomic Workstation Audit         │
└────────────────────────────────────────────────────────┘
```

- **Always-On Background Daemon**: When closing the window (`X`), the Rust event handler intercepts `WindowEvent::CloseRequested`, cancels exit, and minimizes the window to the tray. Reminders remain active in the background.
- **System Tray Context Menu**:
  - Instant break trigger (`Take Break Now`)
  - Quick pauses (`Pause for 30 Minutes`, `Pause for 1 Hour`)
  - Dashboard show/hide toggle
  - Application exit
- **Zero-Dependency Audio Synthesis**: Pure Web Audio API synthesizes Tibetan singing bowl harmonics (528 Hz Solfeggio frequency) and pacing clicks with zero external audio assets.

---

## 🚀 GitHub Actions CI/CD Pipeline

The workflow file [`.github/workflows/release.yml`](.github/workflows/release.yml) automatically compiles release binaries for macOS and Windows 11 upon pushing a version tag (e.g. `v0.1.0`) or triggering manual `workflow_dispatch`.

- **Node.js Runtime**: Set to `v24.21.0` LTS.
- **macOS Ad-hoc Code Signing (`APPLE_SIGNING_IDENTITY: "-"`)**: Produces ad-hoc signed universal binaries (`universal-apple-darwin` supporting Apple Silicon M1/M2/M3/M4 and Intel x86_64), packaged as DMG and tarball releases.
- **Windows 11**: Produces NSIS standalone setup installers (`.exe`) and Windows Installer packages (`.msi`).

---

## 🔍 Troubleshooting (macOS & Windows)

### 1. Launching from Terminal (Live Output & Diagnostics)
If you want to inspect live runtime events, launch the binary directly from macOS Terminal:
```bash
"/Applications/Spine and Eye.app/Contents/MacOS/spine-eye"
```
This prints all startup hooks, webview events, and diagnostic messages directly to your shell.

### 2. Inspecting the Local Debug Log (`/tmp/spine-eye-debug.log`)
Spine & Eye writes diagnostic records across all initialization stages and captures any panic payloads. You can inspect this log at any time on macOS:
```bash
cat /tmp/spine-eye-debug.log
```
Or stream it live:
```bash
tail -f /tmp/spine-eye-debug.log
```

### 3. Understanding macOS Console (`Console.app`) Messages
When inspecting system logs in macOS Console for ad-hoc signed builds, you may see:
* **`linkd ... Rejecting invalid client due to requiresValidatedBundle`**:  
  On macOS Sonoma and Sequoia, the OS `AppIntents` / Shortcuts framework queries running apps. Because the ad-hoc build does not carry a commercial Apple Team ID, `linkd` logs that it rejected shortcut integration. **This is a non-fatal warning** and does not impair Spine & Eye's operation.
* **`runningboardd RBSStateCapture remove item called for untracked item`**:  
  Indicates that RunningBoard reaped an exited process. If this occurs, inspect `/tmp/spine-eye-debug.log` or run the binary via Terminal to review any trapped errors.

### 4. Background & Menu Bar / System Tray Behavior
* Spine & Eye is designed as an **always-on companion**. Closing the window (`X`) does not terminate the app; it hides it to the system tray/menu bar to keep your reminder cycle active.
* To bring the dashboard back, click the Spine & Eye icon in your menu bar (macOS) or system tray (Windows) and select **Show Dashboard**.
* To terminate the process completely, select **Quit Spine & Eye** from the tray context menu.

---

## 🛠️ Local Development

### Prerequisites
- **Node.js**: `v24.21.0+` (LTS)
- **Rust**: `1.90+` stable toolchain

### Setup
```bash
# Clone the repository
git clone https://github.com/rauleblanco/spine-eye-app.git
cd spine-eye-app

# Install frontend & Tauri CLI dependencies
npm install

# Run frontend dev server
npm run dev

# Verify Tauri Rust backend
cd src-tauri
cargo check
```

### Production Build
```bash
# Build frontend web distribution
npm run build

# Build native desktop application
npx tauri build
```

---

## 📄 License & Attribution

### License
This project is licensed under the **[MIT License](LICENSE)**.
- **Permitted**: Free use, modification, sharing, sublicensing, and distribution for personal and commercial purposes.

### Copyright
Copyright (c) 2026 Raul E. Blanco (rauleblanco).

### ⚡ Vibe Coding Attribution
This entire application and its codebase were **vibe coded with Gemini 3.8 Flash Medium** (Google DeepMind Advanced Agentic Coding).

### 🔬 Clinical Sources & Evidence
- **American Academy of Ophthalmology (AAO)**: [Computers, Digital Devices and Eye Strain](https://www.aao.org/eye-health/tips-prevention/computer-displays)
- **Cornell University Ergonomics Web (CUErgo)**: [Prof. Alan Hedge Workstation Ergonomics & Sit-Stand Guidelines](https://ergo.human.cornell.edu/cuergoguide.html)
- **Ergonomics & Human Factors Research**: Macro transitions for sustained cognitive continuity and musculoskeletal perfusion.

---

## ⚖️ Legal & Medical Disclaimers

### Medical & Wellness Disclaimer
Spine & Eye is an ergonomics habit tracker and wellness reminder utility designed to encourage healthy computer work routines. It is **not** a certified medical device and does **not** provide medical advice, clinical diagnosis, or treatment. It is not intended to replace professional healthcare evaluation. Anyone experiencing persistent musculoskeletal discomfort, carpal tunnel symptoms, repetitive strain injuries (RSI), or chronic vision strain should consult a qualified physician or optometrist.

### Trademark & Nominative Fair Use Notice
All product names, logos, brands, and registered trademarks—including the *American Academy of Ophthalmology*, *Cornell University*, and *CUErgo*—are the property of their respective owners. Their mention in this software, documentation, and user interface is strictly for scientific attribution, educational reference, and nominative fair use. Such reference does not constitute or imply any affiliation, sponsorship, endorsement, or approval by these institutions.
