/**
 * Clinical Ergonomics Database & Protocols
 * Established by:
 * 1. Cornell University Ergonomics Web (CUErgo) - Directed by Prof. Alan Hedge
 * 2. American Academy of Ophthalmology (AAO) - Digital Eye Strain & Computer Vision Standards
 * 3. Ergonomics Research - Macro Ratio (3:1 to 1:1) for Deep Cognitive Flow
 */

export const CLINICAL_PROTOCOLS = {
  eye_rest: {
    id: 'eye_rest',
    category: 'Eye Rest',
    name: '20-20-20 Rule',
    institution: 'American Academy of Ophthalmology (AAO)',
    type: 'eye',
    accentColor: '#06b6d4',
    accentGlow: 'rgba(6, 182, 212, 0.28)',
    intervalDescription: 'Every 20 minutes for 20 seconds',
    notificationAction: 'Look at an object at least 20 feet away to relax the ciliary muscles and reset your blink rate.',
    clinicalRationale: 'Sustained near-vision locks the intraocular ciliary muscles in continuous accommodation spasm. Gazing 20+ feet away instantly relaxes ciliary muscle tone, and deliberate blinking restores the lipid tear film layer against evaporative dry eye.',
    researchUrl: 'https://www.aao.org/eye-health/tips-prevention/computer-displays',
    researchCitation: 'American Academy of Ophthalmology (AAO) - Digital Eye Strain & 20-20-20 Rule',
    steps: [
      {
        id: 'screen_focus',
        name: 'Screen Focus',
        durationSec: 20 * 60, // 20 min
        icon: '👁️',
        guidance: 'Maintain 20–28 inch viewing distance. Top of monitor at or slightly below eye level. Consciously blink every 4–5 seconds.',
        nextStep: 'Look 20+ feet away for 20 seconds'
      },
      {
        id: 'distance_gaze',
        name: '20-Foot Horizon Gaze',
        durationSec: 20, // 20 sec
        icon: '🌄',
        guidance: 'Look at an object at least 20 feet away to relax the ciliary muscles and reset your blink rate.',
        nextStep: 'Resume focused work'
      }
    ]
  },

  posture_default: {
    id: 'posture_default',
    category: 'Posture (Default)',
    name: '20-8-2 Rule',
    institution: 'Cornell Ergonomics Web (CUErgo)',
    type: 'posture',
    accentColor: '#10b981',
    accentGlow: 'rgba(16, 185, 129, 0.28)',
    intervalDescription: '30-minute recurring cycle: • 20 min Sitting • 8 min Standing • 2 min Movement',
    notificationAction: 'Cycle between neutral sitting, standing, and active movement to protect lumbar discs and capillary perfusion.',
    clinicalRationale: 'Prolonged static sitting elevates lumbar intradiscal pressure and metabolic stagnation, whereas prolonged static standing induces venous pooling and carotid strain. The Hedge 20-8-2 ratio delivers the gold-standard musculoskeletal load balance.',
    researchUrl: 'https://ergo.human.cornell.edu/cuergoguide.html',
    researchCitation: 'Cornell University Ergonomics Web (CUErgo) - Prof. Alan Hedge 20-8-2 Sit-Stand Protocol',
    steps: [
      {
        id: 'sit',
        name: 'Sit (Neutral Posture)',
        shortName: 'Sit',
        durationSec: 20 * 60, // 20 min
        icon: '🪑',
        timestampLabel: '0:00: Sit',
        guidance: 'Sit: Lumbar supported, elbows 90°, top of screen at eye level, feet flat on floor.',
        nextStep: '0:20: Raise desk / Stand for 8 minutes'
      },
      {
        id: 'stand',
        name: 'Raise desk / Stand',
        shortName: 'Stand',
        durationSec: 8 * 60, // 8 min
        icon: '🧍',
        timestampLabel: '0:20: Stand',
        guidance: 'Raise desk / Stand: Weight evenly distributed on both feet, soft knees, forearms parallel to desk at 90°–100°.',
        nextStep: '0:28: Step away, stretch, hydrate for 2 minutes'
      },
      {
        id: 'move',
        name: 'Step away, stretch, hydrate',
        shortName: 'Stretch',
        durationSec: 2 * 60, // 2 min
        icon: '🚶',
        timestampLabel: '0:28: Stretch',
        guidance: 'Step away, stretch, hydrate: Perform cervical retractions and shoulder rolls to eliminate static venous pooling.',
        nextStep: '0:30: Lower desk / Return to seated neutral posture'
      }
    ]
  },

  posture_deep_work: {
    id: 'posture_deep_work',
    category: 'Posture (Deep Work)',
    name: 'Macro Ratio (3:1 to 1:1)',
    institution: 'Ergonomics Research',
    type: 'posture',
    accentColor: '#8b5cf6',
    accentGlow: 'rgba(139, 92, 246, 0.28)',
    intervalDescription: '60-minute recurring cycle: • 45 min Sitting • 15 min Standing',
    notificationAction: 'Deep cognitive immersion with minimal disruption: 45 min seated focus followed by 15 min standing continuation.',
    clinicalRationale: 'Tailored for long compiling, writing, or debugging blocks where a 30-minute transition causes cognitive disruption. Sustains attention flow while preventing static musculoskeletal fatigue.',
    researchUrl: 'https://ergo.human.cornell.edu/',
    researchCitation: 'Ergonomics & Cognitive Performance Research - Macro Sit-to-Stand Transitions',
    steps: [
      {
        id: 'sit',
        name: 'Sit (Deep Work)',
        shortName: 'Sit',
        durationSec: 45 * 60, // 45 min
        icon: '🪑',
        timestampLabel: '0:00: Sit',
        guidance: 'Sit: Lumbar supported, elbows 90° — Sustained deep focus with neutral spine.',
        nextStep: '0:45: Raise desk / Stand for 15 minutes'
      },
      {
        id: 'stand',
        name: 'Raise desk / Stand',
        shortName: 'Stand',
        durationSec: 15 * 60, // 15 min
        icon: '🧍',
        timestampLabel: '0:45: Stand',
        guidance: 'Raise desk / Stand: Continue deep focus while standing. Maintain upright posture and neutral wrists.',
        nextStep: '1:00: Lower desk / Return to seated neutral posture'
      }
    ]
  },

  musculoskeletal_reset: {
    id: 'musculoskeletal_reset',
    category: 'Musculoskeletal Reset',
    name: 'Cornell Microbreak',
    institution: 'Cornell University Ergonomics (CUErgo)',
    type: 'microbreak',
    accentColor: '#f59e0b',
    accentGlow: 'rgba(245, 158, 11, 0.28)',
    intervalDescription: '30-minute recurring cycle: • 30 min Seated Focus • 60s Microbreak',
    notificationAction: 'Decompress cervical spine, thoracic cage, and carpal tunnels with a 60-second microbreak.',
    clinicalRationale: 'Static muscle contractions exceeding 20% of maximum voluntary contraction restrict blood perfusion. 60-second microbreaks restore capillary blood flow and eliminate metabolic byproduct accumulation.',
    researchUrl: 'https://ergo.human.cornell.edu/',
    researchCitation: 'Cornell University Ergonomics Web - Postural Microbreak Capillary Perfusion',
    steps: [
      {
        id: 'focus',
        name: 'Seated Focus',
        shortName: 'Focus',
        durationSec: 30 * 60, // 30 min
        icon: '💻',
        timestampLabel: '0:00: Focus',
        guidance: 'Work in ergonomic neutral position. Relax shoulders and maintain thoracic uprightness.',
        nextStep: '0:30: 60-second postural reset'
      },
      {
        id: 'reset',
        name: 'Musculoskeletal Microbreak',
        shortName: 'Reset',
        durationSec: 60, // 60 sec
        icon: '🧘',
        timestampLabel: '0:30: Reset',
        guidance: 'Cervical retraction (chin tucks), thoracic extension, and carpal tunnel median nerve glide.',
        nextStep: 'Return to neutral seated focus'
      }
    ]
  }
};

export const CORNELL_STRETCHES = [
  {
    id: 'chin_tuck',
    name: 'Cervical Retraction (Chin Tuck)',
    target: 'Deep Cervical Flexors & Suboccipitals',
    durationSec: 15,
    icon: 'neck',
    instruction: 'Look straight ahead. Gently pull your chin straight back like making a double chin, lengthening the back of your neck. Hold for 5 seconds, repeat 3 times.',
    clinicalBenefit: 'Reverses forward head posture (tech neck). Each inch of anterior head carriage adds approximately 10 lbs of extra compressive force onto the cervical spine.'
  },
  {
    id: 'thoracic_opener',
    name: 'Thoracic Extension & Chest Opener',
    target: 'Pectoralis Major & Thoracic Spine',
    durationSec: 20,
    icon: 'chest',
    instruction: 'Interlace fingers behind your head or lower back. Inhale deeply, draw elbows backward, and gently arch your upper back upward toward the ceiling.',
    clinicalBenefit: 'Counters slumped kyphotic thoracic rounding and unloads the anterior spinal discs while expanding lung capacity.'
  },
  {
    id: 'scapular_pinch',
    name: 'Scapular Retraction & Squeeze',
    target: 'Rhomboids & Mid/Lower Trapezius',
    durationSec: 15,
    icon: 'back',
    instruction: 'Sit upright, drop shoulders away from ears. Pinch your shoulder blades down and together as if squeezing a pencil between them. Hold 5 seconds.',
    clinicalBenefit: 'Activates postural phasic muscles that inhibit upper trapezius hyperactivity, alleviating tension headaches and neck spasm.'
  },
  {
    id: 'median_nerve_glide',
    name: 'Wrist & Median Nerve Glide',
    target: 'Flexor Retinaculum & Carpal Tunnel',
    durationSec: 20,
    icon: 'wrist',
    instruction: 'Extend your arm forward with palm facing up. Gently pull fingers back toward your body with the other hand. Next, flex wrist downward. Repeat on both sides.',
    clinicalBenefit: 'Decreases intracarpal tunnel fluid pressure and mobilizes the median nerve to prevent repetitive strain injuries (RSI) and Carpal Tunnel Syndrome.'
  },
  {
    id: 'lumbar_decompression',
    name: 'Seated Spinal Twist & Decompression',
    target: 'Paraspinal & Quadratus Lumborum',
    durationSec: 25,
    icon: 'spine',
    instruction: 'Sit tall with feet flat. Place your right hand on your left knee and look over your left shoulder, breathing deeply. Switch smoothly to the right side.',
    clinicalBenefit: 'Facilitates intervertebral disc imbibition (nutrient hydration) and releases rotational facet joint stiffness.'
  },
  {
    id: 'hip_psoas_reset',
    name: 'Standing Hip Flexor / Psoas Reset',
    target: 'Iliopsoas & Rectus Femoris',
    durationSec: 25,
    icon: 'hip',
    instruction: 'Stand up. Step one foot back into a shallow lunge. Tuck your pelvis underneath (posterior tilt) and squeeze the glute until you feel a front-hip stretch.',
    clinicalBenefit: 'Alleviates chronic hip flexor contracture caused by 90-degree seated flexion, preventing anterior pelvic tilt and lower back pain.'
  }
];

export const AAO_EYE_EXERCISES = [
  {
    id: 'distant_gaze',
    name: '20-Foot Horizon Gaze',
    target: 'Ciliary Muscle & Accommodation Reflex',
    durationSec: 10,
    instruction: 'Look away from all screens. Fixate your eyes on a distant point at least 20 feet away (out a window or down a long hallway). Let your peripheral vision soften.',
    clinicalBenefit: 'Completely unloads the circular fibers of the ciliary muscle from sustained near-point accommodation convergence.'
  },
  {
    id: 'conscious_blink',
    name: 'Conscious Lubricating Blinks',
    target: 'Meibomian Glands & Tear Film',
    durationSec: 10,
    instruction: 'Perform 10 slow, complete, deliberate blinks. Pause for half a second when eyelids meet to express lipid oils across the ocular surface.',
    clinicalBenefit: 'Normal blink rates drop from 18-20/min to 6-8/min during screen focus. Deliberate blinking restores the tear film lipid layer and halts evaporative dry eye.'
  },
  {
    id: 'smooth_pursuit',
    name: 'Smooth Pursuit Infinity (Lazy 8)',
    target: 'Extraocular Recti & Oblique Muscles',
    durationSec: 15,
    instruction: 'Follow the moving focus marker on screen in a gentle horizontal figure-eight without moving your head.',
    clinicalBenefit: 'Coordinates reciprocal innervation of all six cranial extraocular muscles, preventing ocular motor fatigue.'
  }
];

export const CORNELL_ERGONOMICS_AUDIT = [
  {
    id: 'monitor_height',
    title: 'Monitor Height & Tilt',
    standard: 'Eye level should align with the top 1/3 of the screen; display tilted back 10°–20°.',
    clinicalImpact: 'Reduces neck flexion angle to within 10°-15°, minimizing suboccipital strain.'
  },
  {
    id: 'viewing_distance',
    title: 'Viewing Distance (Arm Length)',
    standard: 'Screen placed 20 to 28 inches (50–70 cm) away, roughly fingertips-length with arm extended.',
    clinicalImpact: 'Minimizes convergence fatigue while preserving comfortable 20/20 visual acuity.'
  },
  {
    id: 'elbow_angle',
    title: 'Forearm & Elbow Support (90°–100°)',
    standard: 'Elbows rested at 90°–100° angle with forearms horizontal or sloping gently downward.',
    clinicalImpact: 'Prevents shoulder elevation and latissimus dorsi or trapezius static contraction.'
  },
  {
    id: 'wrist_alignment',
    title: 'Neutral Wrist Posture',
    standard: 'Wrists straight in neutral alignment without resting heavily on hard desk edges while typing.',
    clinicalImpact: 'Prevents elevated carpal tunnel pressures (which spike 300% when wrists are extended >20°).'
  },
  {
    id: 'lumbar_support',
    title: 'Lumbar Lordosis Support',
    standard: 'Chair backrest firmly supports the natural inward curve of the lower back (L1–L5).',
    clinicalImpact: 'Reduces intradiscal pressure in the lumbar spine by up to 40% compared to unsupported slouching.'
  },
  {
    id: 'thigh_feet_clearance',
    title: 'Popliteal Clearance & Flat Feet',
    standard: '2–3 finger widths between back of knees and chair seat pan; feet flat on floor or footrest.',
    clinicalImpact: 'Ensures unimpeded femoral vascular return, reducing lower extremity edema and deep vein pooling.'
  },
  {
    id: 'lighting_glare',
    title: 'Ambient Lighting & Glare Elimination',
    standard: 'Monitor perpendicular to windows; screen brightness matched to ambient room illumination.',
    clinicalImpact: 'Eliminates pupil constriction oscillations caused by high contrast veiling glare.'
  }
];
