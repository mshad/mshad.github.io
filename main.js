/* ============================================================
   Matthias Markowski — Portfolio
   Background: Three.js deep-sea scene + GPU fluid solver (stable fluids)
   Bioluminescent microbes stir the fluid (the mouse swims along as one
   of them); sparkles ride the velocity field like drifting plankton.
   ============================================================ */

(function background3D() {
  const canvas = document.getElementById("bg-canvas");

  if (!window.THREE) {
    canvas.style.background =
      "radial-gradient(ellipse at 50% 120%, #0e2233 0%, #070b12 70%)";
    return;
  }

  // With reduced motion preferred (e.g. Windows animation effects off) we
  // don't freeze the centerpiece — we run it calmer and slower instead.
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motionScale = reducedMotion ? 0.4 : 1;

  // layout size of the fixed canvas — measured from the element, not from
  // window.innerHeight. Its CSS height is 100lvh, which mobile browsers
  // keep stable while their URL bar collapses on scroll, so scrolling never
  // triggers a real resize (rebuilding mid-scroll made the paint slide).
  const viewW = () => canvas.clientWidth || window.innerWidth;
  const viewH = () => canvas.clientHeight || window.innerHeight;

  /* ============================================================
     CONFIG — every tunable dial in one place
     ============================================================ */

  const CONFIG = {
    // --- fluid solver ---
    sim: {
      simRes: 128,       // velocity / pressure grid (short side)
      dyeRes: 256,       // dye wisps — high res for fine filaments (short side)
      readRes: 64,       // CPU readback grid for particle advection (short side)
      speed: 1.5,        // timestep multiplier — slow, deliberate
      pressureIterations: 20,     // Jacobi solve quality (incompressibility)
      viscosityIterations: 3,     // velocity diffusion passes: the "oil paint" thickness
      viscosity: 0.5,             // drag per diffusion pass
      vorticity: 1,               // low: paint smears laminar, it doesn't whirl
      pressureDecay: 0.2,         // pressure kept between frames (0..1)
      velocityDissipation: 0.995, // momentum kept per step — lower dies faster
      dyeDissipation: 0.88,       // pigment kept per step — how fast paint dissolves
      velEncodeMax: 600,          // texels/s mapped to the byte readback
    },

    // --- warm-up: the field opens mid-motion instead of blank ---
    warmup: {
      span: 6,      // seconds of microbe history reconstructed at load
      interval: 0.2,// seconds between history splats along each path
      steps: 48,    // solver steps to smear the seeds into coherent paint
    },

    // --- intro: the microbes open tracing a heart, then wander off ---
    intro: {
      cx: 0.5,    // center of the heart (uv, y up)
      cy: 0.5,
      size: 0.2,    // scale — roughly half the heart's height in uv
      trace: 0.05,  // how fast each microbe crawls along the outline (loops/s)
      reveal: 1.2,  // seconds for the outline to light up end to end — the
                    // slots ignite one by one in path order, so the heart
                    // draws itself on starting at the top cleft
      ignite: 0.5,  // each slot's fade-in once its turn on the path comes
      hold: 2.5,    // seconds the heart is held before the swarm departs —
                    // right after the reveal sweep completes (reveal + ignite)
      blend: 2,     // seconds to ease from the outline into wandering
      force: 0.2,   // stir velocity multiplier on the heart — all microbes circle
                    // in step there, so full force whips up one big vortex
      glow: 1,      // emission multiplier on the heart — the slow trace re-seeds
                    // the same spots over and over, full dye pools into blobs
      stagger: 0.1, // seconds between consecutive microbes leaving the heart —
                    // the swarm disperses one by one instead of all at once
                    // (also paces the ghosts' fade ripple, ~ghosts×stagger)
      ghosts: 16,   // extra intro-only microbes interleaved between the real
                    // ones — they thicken the heart outline, then fade out
                    // instead of swarming off
    },

    // --- paint look: surface relief + fake lighting ---
    paint: {
      // ramp from darkest (wisp edges) to brightest (dense core); paste hex
      // stops from a gradient tool (e.g. colordesigner.io) — any count works
      // sampled from the anglerfish photo (03-popup-jpg--965-.jpg), applied
      // INVERTED like a backlit translucent microbe culture: the thinnest
      // veils glow electric ice-blue (the membrane edge) and dense cores
      // sink back into abyssal blue-black — no warm hues; the lure keeps
      // the only one
      rampColors: [
        "#93d1e8", "#65b4d6", "#3b93bd", "#2374a0",
        "#175a7d", "#113f5b", "#0b2033", "#060b14",
      ],
      densityCurve: 1.6,      // how fast dye density saturates the ramp
      rampFadeIn: 0.35,       // density range over which dye eases in from black
      coreClear: 0.55,        // translucent cores: how quickly dense paint goes
                              // glassy and lets the water behind show through —
                              // only the fringe keeps the glow (0 = opaque body)
      heightCompression: 1.4, // thick paint plateaus instead of spiking
      bump: 7.5,              // relief strength of the paint surface
      parallax: 0,        // thick paint shifts its color lookup slightly
      diffuseBase: 0.38,      // glow brightness in shadow
      diffuseGain: 0.85,      // glow brightness added by the key light
      specStrength: 0.3,      // gloss on the ridges
      specPower: 40,          // gloss tightness — higher = smaller highlight
      valleyShadow: 0.15,     // how far valleys sink into shadow
      exposure: 1.35,         // filmic knee — overlapping glow burns, never clips
    },

    // --- bioluminescence color cycle ---
    biolume: {
      // cooler, bluer pair: cold lagoon aqua drifting into abyssal violet
      aqua: [0.05, 0.26, 0.3],
      violet: [0.14, 0.1, 0.38],
      cycleSpeed: 0.07, // slow, coherent drift between the two hues
      whiteLift: 0.06,  // small white lift so dense cores burn bright
    },

    // --- mouse brush: a microbe that chases the cursor ---
    mouse: {
      follow: 2,       // chase rate (1/s) — lower = lazier, trails further behind
      maxSpeed: 1.8,   // uv/s cap on the brush — a fast flick can't blast the paint
      orbit: 0.02,     // wobble radius around a resting cursor — keeps dye flowing
      orbitSpeed: 0.6, // tempo of that wobble — lower = slower circling
      force: 40,       // brush velocity -> fluid velocity (same scale as idle)
      radius: 0.0002,  // same tight nib as the idle microbes
      glowBase: 0.5,   // pigment from a slow drag
      glowGain: 0.14,  // extra pigment from a brisk stroke
    },

    // --- idle microbes: keep the paint alive without input ---
    idle: {
      force: 30,
      radius: 0.0002,
      glowBase: 0.5,
      glowGain: 0.14,
      // sixteen wandering lissajous points — a loose culture of microbes
      // spread across the whole canvas, the first biased right of the hero
      // text. Differing frequencies and phases keep them from ever moving
      // in sync. `pulse` is each one's swim beat (seconds per
      // thrust-and-glide cycle, see gait below)
      microbes: [
        { cx: 0.64, cy: 0.55, ax: 0.24, ay: 0.26, ax2: 0.06, ay2: 0.08, fx: 0.31, fx2: 0.117, fy: 0.23, fy2: 0.083, phase: 0.0, pulse: 3.4 },
        { cx: 0.80, cy: 0.30, ax: 0.15, ay: 0.22, ax2: 0.05, ay2: 0.07, fx: 0.35, fx2: 0.127, fy: 0.26, fy2: 0.091, phase: 1.3, pulse: 2.8 },
        { cx: 0.60, cy: 0.85, ax: 0.19, ay: 0.09, ax2: 0.06, ay2: 0.03, fx: 0.18, fx2: 0.103, fy: 0.28, fy2: 0.073, phase: 5.5, pulse: 3.9 },
        { cx: 0.06, cy: 0.72, ax: 0.05, ay: 0.14, ax2: 0.03, ay2: 0.05, fx: 0.28, fx2: 0.107, fy: 0.21, fy2: 0.081, phase: 0.9, pulse: 3.1 },
        { cx: 0.22, cy: 0.18, ax: 0.10, ay: 0.09, ax2: 0.04, ay2: 0.03, fx: 0.26, fx2: 0.093, fy: 0.19, fy2: 0.071, phase: 2.1, pulse: 3.6 },
        { cx: 0.45, cy: 0.30, ax: 0.12, ay: 0.13, ax2: 0.05, ay2: 0.04, fx: 0.22, fx2: 0.111, fy: 0.30, fy2: 0.087, phase: 3.8, pulse: 2.9 },
        { cx: 0.90, cy: 0.14, ax: 0.07, ay: 0.10, ax2: 0.03, ay2: 0.04, fx: 0.33, fx2: 0.097, fy: 0.24, fy2: 0.079, phase: 1.7, pulse: 4.1 },
        { cx: 0.93, cy: 0.70, ax: 0.06, ay: 0.15, ax2: 0.03, ay2: 0.05, fx: 0.21, fx2: 0.089, fy: 0.27, fy2: 0.069, phase: 4.4, pulse: 3.3 },
        { cx: 0.35, cy: 0.62, ax: 0.11, ay: 0.10, ax2: 0.04, ay2: 0.04, fx: 0.29, fx2: 0.121, fy: 0.20, fy2: 0.091, phase: 0.6, pulse: 2.7 },
        { cx: 0.13, cy: 0.40, ax: 0.08, ay: 0.12, ax2: 0.03, ay2: 0.04, fx: 0.24, fx2: 0.101, fy: 0.31, fy2: 0.077, phase: 5.9, pulse: 3.8 },
        { cx: 0.50, cy: 0.08, ax: 0.13, ay: 0.06, ax2: 0.05, ay2: 0.02, fx: 0.20, fx2: 0.113, fy: 0.25, fy2: 0.083, phase: 2.9, pulse: 3.0 },
        { cx: 0.27, cy: 0.90, ax: 0.12, ay: 0.07, ax2: 0.04, ay2: 0.03, fx: 0.32, fx2: 0.091, fy: 0.18, fy2: 0.067, phase: 1.1, pulse: 4.3 },
        { cx: 0.74, cy: 0.68, ax: 0.10, ay: 0.12, ax2: 0.04, ay2: 0.05, fx: 0.25, fx2: 0.119, fy: 0.22, fy2: 0.093, phase: 3.2, pulse: 2.6 },
        { cx: 0.88, cy: 0.45, ax: 0.07, ay: 0.11, ax2: 0.03, ay2: 0.04, fx: 0.30, fx2: 0.099, fy: 0.29, fy2: 0.073, phase: 5.2, pulse: 3.5 },
        { cx: 0.42, cy: 0.78, ax: 0.10, ay: 0.08, ax2: 0.04, ay2: 0.03, fx: 0.19, fx2: 0.109, fy: 0.26, fy2: 0.081, phase: 0.3, pulse: 3.7 },
        { cx: 0.08, cy: 0.12, ax: 0.06, ay: 0.08, ax2: 0.03, ay2: 0.03, fx: 0.27, fx2: 0.103, fy: 0.23, fy2: 0.089, phase: 4.0, pulse: 3.2 },
      ],
    },

    // --- swarm: the microbes school toward the cursor ---
    swarm: {
      follow: 0.8, // base chase responsiveness (1/s) — how hard each microbe
                   // steers toward the cursor once the pull is on
      vary: 2,   // ± spread of chase rates across the swarm — leaders dart
                   // ahead, stragglers trail behind, so the school stretches
      spread: 2,   // how much of its own wander each microbe keeps around the
                   // cursor — 0 stacks the whole swarm on one point
      gather: 1.2, // seconds to ease the pull in when a pointer shows up, and
                   // back out when it leaves (they resume wandering)
    },

    // --- swim gait: the microbes thrust and glide, run-and-tumble style ---
    // time along each lissajous path is warped so speed pulses smoothly
    // between (1 - depth) and (1 + depth); emission follows speed, so every
    // thrust blooms a glowing puff of culture while the faint base glow of
    // the glide trails behind it like a flagellar wake
    gait: {
      period: 3.2, // fallback beat (s) when a microbe sets no `pulse`
      depth: 0.8,  // pulse depth: 1 = dead stop between thrusts (the trail
                   // visibly cuts out), lower keeps the glide emitting
      rise: 0.03,  // uv bob per beat — the body lifts on the thrust and
                   // settles back during the glide
    },

    // --- sparkles riding the fluid ---
    particles: {
      count: 196,
      size: 26,      // sprite size in px
      flowGain: 1.2, // velocity field -> ride speed
      inertia: 1.5,  // lower = heavier, lags further behind the paint
      depth: -8,     // z in the angler layer — negative sits behind the fish
      // filament blues from the same photo as the paint ramp
      palette: [0x79bfda, 0xecf9ff, 0xa8d8ee], // steel / ice white / pale ice
    },

    // --- the anglerfish looming behind the paint ---
    angler: {
      url: "anglerfish/scene.gltf",
      height: 0.72,  // fraction of the view height the body spans
      x: 0.26,       // offset from screen center, fraction of view width
      y: -0.02,      // offset from screen center, fraction of view height
      // --- scroll stations: as each section scrolls into view the fish
      // swims to its spot (x/y like above; keys are section ids, page order).
      // yaw is the resting heading: 0.5 faces left toward the center,
      // Math.PI - 0.5 is its mirror — parked on the left, looking right.
      // One slow leftward drift across the whole page: each section nudges
      // it a little further, and it only reaches the left edge at the end.
      // The yaw turns in even fifths from 0.55 (facing left) around to its
      // mirror Math.PI - 0.55 (facing right) as it crosses
      stations: {
        top:        { x:  0.26, y: -0.02, yaw: 0.55 },
        work:       { x:  0.16, y:  0.06, yaw: 0.55 + (Math.PI - 1.1) * 0.2 },
        about:      { x: -0.12, y: -0.08, yaw: 0.55 + (Math.PI - 1.1) * 0.7 },
        experience: { x: -0.12, y:  0.04, yaw: 0.55 + (Math.PI - 1.1) * 0.7 },
        skills:     { x: -0.18, y:  -0.08, yaw: 0.55 + (Math.PI - 1.1) * 0.8 },
        contact:    { x: -0.30, y: 0, yaw: Math.PI - 0.55 },
      },
      travel: {
        ease: 0.7,     // 1/s — cruise speed toward the new station
        turnEase: 1.6, // 1/s — how quickly it swings between headings
        swimYaw: 0.2,  // heading under way: near-profile, nose to its goal
                       // (0 = exact profile, more = angled toward the camera)
        arrive: 0.18,  // remaining distance (view widths) over which the
                       // heading blends from swimming into the rest pose
      },
      // --- intro: on page load it swims in from the deep back-right; the
      // fog hides the body at first, so the lure's glow (fog-proof) shows
      // up alone and the silhouette materializes around it as it closes in
      intro: {
        x: 0.55,    // start, view widths right of center
        y: 0.06,    // a touch above its hero station
        z: -18,     // world units behind the resting plane, deep in the fog
        delay: 2,   // seconds it holds in the dark first — the heart and the
                    // headline (index.html --d cascade) get the stage alone
      },
      sway: 0.16,    // idle yaw sway (radians)
      roll: 0.035,   // idle roll around the view axis (radians)
      bob: 0.25,     // idle vertical bob (world units)
      // the fish turns with the pointer's horizontal position from center
      pointerTurn: 0.6,  // extra yaw toward the cursor side (radians, ±)
      pointerEase: 0.8,   // how quickly it chases the pointer (1/s)
      drift: 0.05,   // tempo of the idle motion
      fadeIn: 2,     // seconds to emerge from the dark once its cue comes
      dimming: 0.6,  // how fast dye density swallows the silhouette — kept
                     // low so the fish stays visible through translucent blooms
      shimmer: 0.8,  // how much the fluid flow warps its outline
      // surface finish — the asset's spec/gloss looks harsh under our lights,
      // so override it on load (KHR spec-gloss: .specular color + .glossiness)
      material: {
        specular: 0x2a3038, // specular tint — dim, cool grey = wet-but-matte
        glossiness: 0,   // 0 = matte, 1 = mirror-sharp highlight
      },
      // --- render quality ---
      quality: {
        anisotropy: 8, // texture sharpness at grazing angles — the fish sits
                       // yawed, so plain trilinear smears its flank (GPU-capped)
        msaa: 4,       // MSAA samples on the offscreen fish target; its
                       // silhouette is the page's only hard geometric edge
      },
      // the lantern: a glow sprite + point light at the lure bulb
      glow: {
        color: 0xd8c878, // gloomy bioluminescent yellow
        offset: [-0.47, 0.06, 0], // bulb position, fractions of the body bbox
        size: 1.3,      // sprite diameter as a fraction of the body height
        intensity: 4.6,  // point light strength
        reach: 34,       // light falloff distance (screen-space units)
        pulse: 0.3,      // how deeply the glow breathes (0 = steady)
        pulseSpeed: 0.2, // tempo of the breathing
      },
      // deep-water fog: with camera distance the fish dissolves into the
      // background color — the far flank and tail sink into the dark
      fog: {
        color: 0x0e101c, // the visible night background (CSS --bg-raised) —
                         // a fogged fragment melts into the surrounding water
        near: 24,        // world units from the camera where fading starts
        far: 31,         // fully swallowed here (camera sits at z = 30)
      },
    },
  };

  // format a JS number as a GLSL float literal — paint constants are baked
  // into the shader source at startup, they are not live uniforms
  const fl = (x) => (String(x).includes(".") ? String(x) : x + ".0");

  /* ---------- renderer / scene / camera ---------- */

  // no MSAA: the scene is a fullscreen quad + soft alpha sprites, so there
  // are no geometric edges to smooth — multisampling would only cost bandwidth
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  // updateStyle false: the stylesheet alone places and sizes the canvas
  // (fixed, bottom-anchored, 100lvh) — setSize only allocates the buffer.
  // Inline px styles would override the CSS and re-pin it to the moving
  // viewport top on mobile.
  renderer.setSize(viewW(), viewH(), false);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    viewW() / -2, viewW() / 2,
    viewH() / 2, viewH() / -2,
    1, 1000
  );
  camera.position.z = 10;
  scene.add(camera);

  const PASSTHROUGH_VERT = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  /* ============================================================
     GPU fluid solver (Stam "stable fluids", ping-pong targets)
     ============================================================ */

  const gl = renderer.getContext();
  const fluidSupported =
    renderer.capabilities.isWebGL2 && !!gl.getExtension("EXT_color_buffer_float");

  let fluid = null;

  // aspect-corrected grid: texels stay square on screen, so vortices are
  // round instead of stretched to the viewport's aspect ratio
  function gridRes(base) {
    const aspect = viewW() / viewH();
    const long = Math.round(base * Math.max(aspect, 1 / aspect));
    return aspect >= 1 ? { w: long, h: base } : { w: base, h: long };
  }

  function createFluid() {
    const aspect = () => viewW() / viewH();

    const simSize = gridRes(CONFIG.sim.simRes);
    const dyeSize = gridRes(CONFIG.sim.dyeRes);
    const readSize = gridRes(CONFIG.sim.readRes);

    function makeTarget(w, h, type, filter) {
      return new THREE.WebGLRenderTarget(w, h, {
        type,
        format: THREE.RGBAFormat,
        minFilter: filter,
        magFilter: filter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
    }

    function doubleTarget(w, h, type, filter) {
      let a = makeTarget(w, h, type, filter);
      let b = makeTarget(w, h, type, filter);
      return {
        get read() { return a; },
        get write() { return b; },
        swap() { const t = a; a = b; b = t; },
      };
    }

    const half = THREE.HalfFloatType;
    const velocity = doubleTarget(simSize.w, simSize.h, half, THREE.LinearFilter);
    const dye = doubleTarget(dyeSize.w, dyeSize.h, half, THREE.LinearFilter);
    const pressure = doubleTarget(simSize.w, simSize.h, half, THREE.NearestFilter);
    const divergence = makeTarget(simSize.w, simSize.h, half, THREE.NearestFilter);
    const curl = makeTarget(simSize.w, simSize.h, half, THREE.NearestFilter);
    const readback = makeTarget(readSize.w, readSize.h, THREE.UnsignedByteType, THREE.NearestFilter);
    const height = makeTarget(dyeSize.w, dyeSize.h, half, THREE.LinearFilter);

    const texel = new THREE.Vector2(1 / simSize.w, 1 / simSize.h);
    const dyeTexel = new THREE.Vector2(1 / dyeSize.w, 1 / dyeSize.h);

    /* ---------- pass materials ---------- */

    function passMaterial(fragment, uniforms) {
      return new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        vertexShader: PASSTHROUGH_VERT,
        fragmentShader: fragment,
        uniforms,
      });
    }

    const advectMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      uniform float uDt;
      uniform float uDissipation;
      void main() {
        vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexel;
        gl_FragColor = uDissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
      }
    `, {
      uVelocity: { value: null },
      uSource: { value: null },
      uTexel: { value: texel },
      uDt: { value: 0 },
      uDissipation: { value: 1 },
    });

    // all of a frame's splats (idle microbes + brush) are summed in a single
    // pass per target — gaussians are additive, so this matches applying them
    // one ping-pong pass each, at a fraction of the fill cost
    const MAX_SPLATS = 24;
    const splatMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float uAspect;
      uniform int uCount;
      uniform vec3 uPoints[${MAX_SPLATS}]; // xy = position, z = radius
      uniform vec3 uColors[${MAX_SPLATS}];
      void main() {
        vec3 acc = texture2D(uTarget, vUv).xyz;
        for (int i = 0; i < ${MAX_SPLATS}; i++) {
          if (i >= uCount) break;
          vec2 p = vUv - uPoints[i].xy;
          p.x *= uAspect;
          acc += exp(-dot(p, p) / uPoints[i].z) * uColors[i];
        }
        gl_FragColor = vec4(acc, 1.0);
      }
    `, {
      uTarget: { value: null },
      uAspect: { value: 1 },
      uCount: { value: 0 },
      uPoints: { value: Array.from({ length: MAX_SPLATS }, () => new THREE.Vector3()) },
      uColors: { value: Array.from({ length: MAX_SPLATS }, () => new THREE.Vector3()) },
    });

    const curlMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 uTexel;
      void main() {
        float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
        float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }
    `, {
      uVelocity: { value: null },
      uTexel: { value: texel },
    });

    const vorticityMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform vec2 uTexel;
      uniform float uStrength;
      uniform float uDt;
      void main() {
        float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= uStrength * C * vec2(1.0, -1.0);
        vec2 vel = texture2D(uVelocity, vUv).xy + force * uDt;
        gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
      }
    `, {
      uVelocity: { value: null },
      uCurl: { value: null },
      uTexel: { value: texel },
      uStrength: { value: CONFIG.sim.vorticity },
      uDt: { value: 0 },
    });

    const divergenceMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 uTexel;
      void main() {
        float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }
    `, {
      uVelocity: { value: null },
      uTexel: { value: texel },
    });

    const clearMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uValue;
      void main() {
        gl_FragColor = uValue * texture2D(uTexture, vUv);
      }
    `, {
      uTexture: { value: null },
      uValue: { value: CONFIG.sim.pressureDecay },
    });

    const pressureMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      uniform vec2 uTexel;
      void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
        float div = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
      }
    `, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel: { value: texel },
    });

    const gradientMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform vec2 uTexel;
      void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
        vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexel: { value: texel },
    });

    // height map: 3x3 tent-smoothed dye density — the paint's relief surface
    const heightMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uDye;
      uniform vec2 uTexel;
      void main() {
        float h = length(texture2D(uDye, vUv).rgb) * 4.0;
        h += length(texture2D(uDye, vUv + vec2( uTexel.x, 0.0)).rgb) * 2.0;
        h += length(texture2D(uDye, vUv + vec2(-uTexel.x, 0.0)).rgb) * 2.0;
        h += length(texture2D(uDye, vUv + vec2(0.0,  uTexel.y)).rgb) * 2.0;
        h += length(texture2D(uDye, vUv + vec2(0.0, -uTexel.y)).rgb) * 2.0;
        h += length(texture2D(uDye, vUv + vec2( uTexel.x,  uTexel.y)).rgb);
        h += length(texture2D(uDye, vUv + vec2(-uTexel.x,  uTexel.y)).rgb);
        h += length(texture2D(uDye, vUv + vec2( uTexel.x, -uTexel.y)).rgb);
        h += length(texture2D(uDye, vUv + vec2(-uTexel.x, -uTexel.y)).rgb);
        h /= 16.0;
        h = 1.0 - exp(-h * ${fl(CONFIG.paint.heightCompression)}); // compress: thick paint plateaus instead of spiking
        gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
      }
    `, {
      uDye: { value: null },
      uTexel: { value: dyeTexel },
    });

    // viscous diffusion (Jacobi): each iteration lets neighboring velocities
    // drag on each other — this is what makes the fluid thick and sticky
    const viscosityMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 uTexel;
      uniform float uAmount;
      void main() {
        vec2 L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).xy;
        vec2 R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).xy;
        vec2 B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).xy;
        vec2 T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).xy;
        vec2 C = texture2D(uVelocity, vUv).xy;
        vec2 vel = (C + uAmount * (L + R + B + T)) / (1.0 + 4.0 * uAmount);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `, {
      uVelocity: { value: null },
      uTexel: { value: texel },
      uAmount: { value: CONFIG.sim.viscosity },
    });

    // encode velocity (rg) and dye density (b) into bytes,
    // sqrt curves for precision near zero
    const encodeMat = passMaterial(`
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uDye;
      uniform float uMax;
      void main() {
        vec2 v = texture2D(uVelocity, vUv).xy / uMax;
        v = clamp(v, -1.0, 1.0);
        v = sign(v) * sqrt(abs(v));
        float d = length(texture2D(uDye, vUv).rgb);
        d = sqrt(clamp(d * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(v * 0.5 + 0.5, d, 1.0);
      }
    `, {
      uVelocity: { value: null },
      uDye: { value: null },
      uMax: { value: CONFIG.sim.velEncodeMax },
    });

    /* ---------- blit helper ---------- */

    const simScene = new THREE.Scene();
    const simCamera = new THREE.Camera();
    const simMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), advectMat);
    simMesh.frustumCulled = false;
    simScene.add(simMesh);

    function blit(material, target) {
      simMesh.material = material;
      renderer.setRenderTarget(target);
      renderer.render(simScene, simCamera);
    }

    /* ---------- splats ---------- */

    const pendingSplats = [];

    // one velocity pass + one dye pass per chunk of MAX_SPLATS
    function applySplats(splats, first, count) {
      const points = splatMat.uniforms.uPoints.value;
      const colors = splatMat.uniforms.uColors.value;
      splatMat.uniforms.uAspect.value = aspect();
      splatMat.uniforms.uCount.value = count;

      for (let i = 0; i < count; i++) {
        const s = splats[first + i];
        points[i].set(s.x, s.y, s.radius);
        colors[i].set(s.dx, s.dy, 0);
      }
      splatMat.uniforms.uTarget.value = velocity.read.texture;
      blit(splatMat, velocity.write);
      velocity.swap();

      for (let i = 0; i < count; i++) {
        const s = splats[first + i];
        if (s.color) colors[i].copy(s.color);
        else colors[i].set(0, 0, 0);
      }
      splatMat.uniforms.uTarget.value = dye.read.texture;
      blit(splatMat, dye.write);
      dye.swap();
    }

    /* ---------- readback for CPU particles ----------
       async: readPixels lands in a pixel-pack buffer on the GPU's timeline
       and a fence marks its completion; the CPU collects it a frame or two
       later instead of stalling the pipeline every frame. The particles ride
       velocity data that is one frame stale — imperceptible. */

    const readBuffer = new Uint8Array(readSize.w * readSize.h * 4);
    // pre-fill with the byte encoding of "zero velocity, no dye" so the
    // first frames (before the first async read lands) decode harmlessly
    for (let i = 0; i < readBuffer.length; i += 4) {
      readBuffer[i] = 128;
      readBuffer[i + 1] = 128;
      readBuffer[i + 3] = 255;
    }
    const readPBO = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readPBO);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, readBuffer.byteLength, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let readFence = null;

    function decodeVel(byte) {
      const s = byte / 127.5 - 1;
      return s * Math.abs(s) * CONFIG.sim.velEncodeMax;
    }

    // bilinear sample of the readback: velocity in out.x/out.y,
    // local dye density in out.z — x/y in 0..1 (y up)
    function sampleVelocity(x, y, out) {
      const rw = readSize.w, rh = readSize.h;
      const fx = Math.min(Math.max(x, 0), 0.999) * (rw - 1);
      const fy = Math.min(Math.max(y, 0), 0.999) * (rh - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, rw - 1), y1 = Math.min(y0 + 1, rh - 1);
      const tx = fx - x0, ty = fy - y0;
      const i00 = (y0 * rw + x0) * 4, i10 = (y0 * rw + x1) * 4;
      const i01 = (y1 * rw + x0) * 4, i11 = (y1 * rw + x1) * 4;
      const b = readBuffer;
      const u = (b[i00] * (1 - tx) + b[i10] * tx) * (1 - ty) +
                (b[i01] * (1 - tx) + b[i11] * tx) * ty;
      const v = (b[i00 + 1] * (1 - tx) + b[i10 + 1] * tx) * (1 - ty) +
                (b[i01 + 1] * (1 - tx) + b[i11 + 1] * tx) * ty;
      const d = (b[i00 + 2] * (1 - tx) + b[i10 + 2] * tx) * (1 - ty) +
                (b[i01 + 2] * (1 - tx) + b[i11 + 2] * tx) * ty;
      out.x = decodeVel(u);
      out.y = decodeVel(v);
      const dn = d / 255;
      out.z = dn * dn * 2; // undo sqrt encode -> dye density
    }

    /* ---------- one simulation step ---------- */

    function step(dt) {
      for (let i = 0; i < pendingSplats.length; i += MAX_SPLATS) {
        applySplats(pendingSplats, i, Math.min(MAX_SPLATS, pendingSplats.length - i));
      }
      pendingSplats.length = 0;

      curlMat.uniforms.uVelocity.value = velocity.read.texture;
      blit(curlMat, curl);

      vorticityMat.uniforms.uVelocity.value = velocity.read.texture;
      vorticityMat.uniforms.uCurl.value = curl.texture;
      vorticityMat.uniforms.uDt.value = dt;
      blit(vorticityMat, velocity.write);
      velocity.swap();

      for (let i = 0; i < CONFIG.sim.viscosityIterations; i++) {
        viscosityMat.uniforms.uVelocity.value = velocity.read.texture;
        blit(viscosityMat, velocity.write);
        velocity.swap();
      }

      divergenceMat.uniforms.uVelocity.value = velocity.read.texture;
      blit(divergenceMat, divergence);

      clearMat.uniforms.uTexture.value = pressure.read.texture;
      blit(clearMat, pressure.write);
      pressure.swap();

      pressureMat.uniforms.uDivergence.value = divergence.texture;
      for (let i = 0; i < CONFIG.sim.pressureIterations; i++) {
        pressureMat.uniforms.uPressure.value = pressure.read.texture;
        blit(pressureMat, pressure.write);
        pressure.swap();
      }

      gradientMat.uniforms.uPressure.value = pressure.read.texture;
      gradientMat.uniforms.uVelocity.value = velocity.read.texture;
      blit(gradientMat, velocity.write);
      velocity.swap();

      advectMat.uniforms.uVelocity.value = velocity.read.texture;
      advectMat.uniforms.uSource.value = velocity.read.texture;
      advectMat.uniforms.uDt.value = dt;
      advectMat.uniforms.uDissipation.value = CONFIG.sim.velocityDissipation;
      blit(advectMat, velocity.write);
      velocity.swap();

      advectMat.uniforms.uVelocity.value = velocity.read.texture;
      advectMat.uniforms.uSource.value = dye.read.texture;
      advectMat.uniforms.uDissipation.value = CONFIG.sim.dyeDissipation;
      blit(advectMat, dye.write);
      dye.swap();

      heightMat.uniforms.uDye.value = dye.read.texture;
      blit(heightMat, height);

      // collect the previous frame's readback if the GPU is done with it...
      if (readFence) {
        const status = gl.clientWaitSync(readFence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          gl.deleteSync(readFence);
          readFence = null;
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readPBO);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, readBuffer);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        }
      }
      // ...and kick off the next one (at most a single transfer in flight)
      if (!readFence) {
        encodeMat.uniforms.uVelocity.value = velocity.read.texture;
        encodeMat.uniforms.uDye.value = dye.read.texture;
        blit(encodeMat, readback);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, readPBO);
        gl.readPixels(0, 0, readSize.w, readSize.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        readFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      }

      renderer.setRenderTarget(null);
    }

    // carry the paint across a rebuild (resize): stretch-blit the previous
    // fluid's velocity and dye into the freshly allocated grids
    function seedFrom(prev) {
      clearMat.uniforms.uValue.value = 1;
      clearMat.uniforms.uTexture.value = prev.velocity.read.texture;
      blit(clearMat, velocity.write);
      velocity.swap();
      clearMat.uniforms.uTexture.value = prev.dye.read.texture;
      blit(clearMat, dye.write);
      dye.swap();
      clearMat.uniforms.uValue.value = CONFIG.sim.pressureDecay;
      renderer.setRenderTarget(null);
    }

    function dispose() {
      [velocity.read, velocity.write, dye.read, dye.write,
       pressure.read, pressure.write, divergence, curl, readback, height]
        .forEach((t) => t.dispose());
      if (readFence) gl.deleteSync(readFence);
      gl.deleteBuffer(readPBO);
    }

    return {
      velocity, dye, height, pendingSplats,
      texel, dyeTexel,
      step, sampleVelocity, seedFrom, dispose,
    };
  }

  if (fluidSupported) fluid = createFluid();

  /* ---------- color ramp LUT (stops come from CONFIG.paint.rampColors) ---------- */

  function makeRampTexture(stops) {
    const w = 256;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = 1;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, 0);
    stops.forEach((hex, i) => g.addColorStop(i / (stops.length - 1), hex));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 1);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /* ---------- aurora background (dye + velocity feed into it) ---------- */

  const auroraMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: viewW() / viewH() },
      uDye: { value: null },
      uVelocity: { value: null },
      uDyeTexel: { value: fluid ? fluid.dyeTexel.clone() : new THREE.Vector2(1 / CONFIG.sim.dyeRes, 1 / CONFIG.sim.dyeRes) },
      uHasFluid: { value: fluid ? 1 : 0 },
      uRamp: { value: makeRampTexture(CONFIG.paint.rampColors) },
      uHeight: { value: null },
      uBump: { value: CONFIG.paint.bump },
      uBack: { value: null },
      uBackFade: { value: 0 },
    },
    vertexShader: PASSTHROUGH_VERT,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAspect;
      uniform sampler2D uDye;
      uniform sampler2D uVelocity;
      uniform vec2 uDyeTexel;
      uniform float uHasFluid;
      uniform sampler2D uRamp;
      uniform sampler2D uHeight;
      uniform float uBump;
      uniform sampler2D uBack;   // the anglerfish, rendered offscreen
      uniform float uBackFade;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = rot * p * 2.05 + vec2(3.7);
          a *= 0.5;
        }
        return v;
      }

      // density ramp from the LUT texture (CONFIG.paint.rampColors), eased in
      // from black over a wide density range so faint dye emerges gently
      vec3 colorRamp(float t) {
        return texture2D(uRamp, vec2(t, 0.5)).rgb * smoothstep(0.0, ${fl(CONFIG.paint.rampFadeIn)}, t);
      }

      void main() {
        vec2 uv = vUv;

        // the fluid gently warps the depth layer
        vec2 flow = uHasFluid * texture2D(uVelocity, uv).xy * 0.0004;
        vec2 p = (uv + flow) * vec2(uAspect, 1.0);

        float t = uTime * 0.05;

        // base: muted night with a faint violet-grey cast (ref: right example)
        vec3 col = vec3(0.028, 0.032, 0.052);
        col += vec3(0.016, 0.014, 0.030) * smoothstep(0.2, 1.0, uv.x + uv.y);

        // one soft depth layer, barely there
        float depth = fbm(p * 1.6 + vec2(t * 0.6, -t * 0.3));
        col += vec3(0.040, 0.070, 0.110) * pow(depth, 2.5);

        // ---- paint relief: normal from the height map ----
        float hC = texture2D(uHeight, uv).x;
        float hL = texture2D(uHeight, uv - vec2(uDyeTexel.x, 0.0)).x;
        float hR = texture2D(uHeight, uv + vec2(uDyeTexel.x, 0.0)).x;
        float hB = texture2D(uHeight, uv - vec2(0.0, uDyeTexel.y)).x;
        float hT = texture2D(uHeight, uv + vec2(0.0, uDyeTexel.y)).x;
        vec3 n = normalize(vec3((hL - hR) * uBump, (hB - hT) * uBump, 1.0));

        // subtle parallax: thick paint sits above the canvas, so its color
        // is looked up slightly shifted along the surface normal
        vec2 uvP = uv + n.xy * hC * ${fl(CONFIG.paint.parallax)};
        vec3 dye = texture2D(uDye, uvP).rgb;
        float d = length(dye);
        float t01 = 1.0 - exp(-d * ${fl(CONFIG.paint.densityCurve)}); // soft-saturating density
        vec3 glow = colorRamp(t01); // the ramp is the single source of color
        // translucent cores: the densest culture goes glassy — its color
        // falls back out and the water behind carries the body of the bloom
        glow *= exp(-d * ${fl(CONFIG.paint.coreClear)});

        // the anglerfish looms BEHIND the paint: the flow field warps its
        // silhouette a touch, and dense culture swallows it entirely.
        // premultiplied-style composite — the opaque body (alpha 1) swaps in,
        // while the lantern's additive halo (bright rgb, low alpha) adds glow
        vec4 back = texture2D(uBack, uv + flow * ${fl(CONFIG.angler.shimmer)});
        float occl = uBackFade * exp(-d * ${fl(CONFIG.angler.dimming)});
        col = col * (1.0 - back.a * occl) + back.rgb * occl;

        // fake lighting: key light from the upper left, viewer straight on
        vec3 lightDir = normalize(vec3(-0.45, 0.65, 0.6));
        float diff = clamp(dot(n, lightDir), 0.0, 1.0);
        vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));
        float spec = pow(max(dot(n, halfDir), 0.0), ${fl(CONFIG.paint.specPower)});

        col += uHasFluid * glow * (${fl(CONFIG.paint.diffuseBase)} + ${fl(CONFIG.paint.diffuseGain)} * diff);
        // glossy sheen on the ridges — only where there is paint
        col += uHasFluid * spec * ${fl(CONFIG.paint.specStrength)} * smoothstep(0.035, 0.32, hC);
        // valleys sink into shadow — eased in, so no hard contour where paint begins
        col *= mix(1.0, ${fl(1 - CONFIG.paint.valleyShadow)} + ${fl(CONFIG.paint.valleyShadow)} * hC, uHasFluid * smoothstep(0.0, 0.12, hC));

        // soft filmic knee: overlapping glow burns toward white, never clips
        col = 1.0 - exp(-col * ${fl(CONFIG.paint.exposure)});

        // vignette + grain
        float vig = smoothstep(1.35, 0.4, length(uv - 0.5));
        col *= vig;
        col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const auroraMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), auroraMaterial);
  auroraMesh.frustumCulled = false;
  auroraMesh.renderOrder = -1;
  scene.add(auroraMesh);

  /* ---------- the anglerfish looming behind the paint ----------
     A GLTF model in its own scene, rendered to an offscreen target every
     frame and composited by the aurora shader UNDER the culture — the paint
     literally swims in front of it. */

  // horizontal pointer position, -1 (left edge) .. +1 (right edge), 0 center.
  // separate from the brush's pointerTarget: this one persists after the
  // cursor leaves so the fish holds its lean instead of snapping back.
  // pointerAim is the raw target; pointerLean is the eased value the fish uses
  let pointerAim = 0;
  const angler = {
    root: null, fade: 0, pointerLean: 0, clock: 0,
    // eased home position and heading. It starts at the intro spot, deep in
    // the fog behind its resting plane (z 0), and swims to the hero station
    homeX: CONFIG.angler.intro.x, homeY: CONFIG.angler.intro.y,
    homeZ: CONFIG.angler.intro.z,
    faceYaw: CONFIG.angler.stations.top.yaw,
  };
  window.addEventListener("mousemove", (e) => { pointerAim = (e.clientX / window.innerWidth) * 2 - 1; });
  window.addEventListener("touchmove", (e) => { pointerAim = (e.touches[0].clientX / window.innerWidth) * 2 - 1; }, { passive: true });

  // which section owns the viewport center — the fish's station follows it
  let anglerStation = CONFIG.angler.stations.top || CONFIG.angler;
  {
    const ids = Object.keys(CONFIG.angler.stations);
    const pick = () => {
      const mid = window.scrollY + window.innerHeight * 0.5;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= mid) current = id;
      }
      anglerStation = CONFIG.angler.stations[current];
    };
    window.addEventListener("scroll", pick, { passive: true });
    pick();
  }

  const anglerScene = new THREE.Scene();
  anglerScene.fog = new THREE.Fog(
    CONFIG.angler.fog.color, CONFIG.angler.fog.near, CONFIG.angler.fog.far
  );
  const anglerCamera = new THREE.PerspectiveCamera(
    35, viewW() / viewH(), 0.1, 200
  );
  anglerCamera.position.set(0, 0, 30);

  const anglerRT = new THREE.WebGLRenderTarget(
    Math.round(viewW() * renderer.getPixelRatio()),
    Math.round(viewH() * renderer.getPixelRatio())
  );
  // WebGL2: multisample the fish's target — the main renderer runs without
  // MSAA on purpose (all soft sprites), but the fish is real geometry and
  // its silhouette aliases without it
  if (renderer.capabilities.isWebGL2) anglerRT.samples = CONFIG.angler.quality.msaa;
  auroraMaterial.uniforms.uBack.value = anglerRT.texture;

  // moody deep-sea light: cold ambient plus a key from the upper left that
  // matches the paint shader's fake light — the lure adds its own glow
  anglerScene.add(new THREE.AmbientLight(0x33506a, 0.6));
  const anglerKey = new THREE.DirectionalLight(0x9fd8d0, 0.85);
  anglerKey.position.set(-6, 7, 9);
  anglerScene.add(anglerKey);

  // view size of the fish camera's frustum at the model's depth (z = 0)
  function anglerViewSize() {
    const h = 2 * anglerCamera.position.z * Math.tan((anglerCamera.fov * Math.PI) / 360);
    return { w: h * anglerCamera.aspect, h };
  }

  if (THREE.GLTFLoader) {
    new THREE.GLTFLoader().load(
      CONFIG.angler.url,
      (gltf) => {
        const A = CONFIG.angler;
        const model = gltf.scene;
        model.rotation.y = Math.PI; // nose points +x — turn it toward the text

        // tame the spec-gloss finish — the raw asset is too shiny/plasticky
        // under our lights. The eyes keep their own look (they're emissive).
        const M = A.material;
        const maxAniso = renderer.capabilities.getMaxAnisotropy();
        model.traverse((o) => {
          if (!o.isMesh) return; // Sphere = eyes
          const mat = o.material;
          if (mat.specular) mat.specular.setHex(M.specular);
          if (mat.glossiness !== undefined) mat.glossiness = M.glossiness;
          // texture filtering: the asset already asks for trilinear
          // mipmapping, but anisotropy defaults to 1, which smears the
          // texture at the fish's grazing angles — raise it on every slot
          for (const slot of ["map", "specularMap", "glossinessMap", "normalMap", "emissiveMap", "aoMap"]) {
            const tex = mat[slot];
            if (!tex) continue;
            tex.anisotropy = Math.min(A.quality.anisotropy, maxAniso);
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.generateMipmaps = true;
            tex.needsUpdate = true;
          }
          mat.needsUpdate = true;
        });

        // center the pivot on the body, scale to the configured screen share
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        const wrap = new THREE.Group();
        wrap.add(model);
        const s = (A.height * anglerViewSize().h) / size.y;
        wrap.scale.setScalar(s);

        // the lantern: a mysterious glow at the lure bulb — an additive
        // sprite for the halo and a point light spilling onto the face
        const G = A.glow;
        const bulb = new THREE.Group();
        bulb.position.set(
          G.offset[0] * size.x,
          G.offset[1] * size.y,
          G.offset[2] * size.z
        );
        const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: makeGlowTexture(),
          color: G.color,
          fog: false, // the lure's glow pierces the deep-water fog
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          depthTest: false, // the halo floats over the bulb geometry
        }));
        const glowSize = G.size * size.y;
        glowSprite.scale.set(glowSize, glowSize, 1);
        const glowLight = new THREE.PointLight(G.color, G.intensity, G.reach / s, 2);
        bulb.add(glowSprite);
        bulb.add(glowLight);
        wrap.add(bulb);

        anglerScene.add(wrap);
        angler.root = wrap;
        angler.glowSprite = glowSprite;
        angler.glowLight = glowLight;
        angler.glowSize = glowSize;
      },
      undefined,
      (err) => console.warn("anglerfish failed to load — background stays empty:", err)
    );
  }

  function updateAngler(time, dt) {
    const A = CONFIG.angler;

    // intro hold: the fish (and the sparkle layer with it) waits in the
    // dark until its cue, while the heart and the headline open the page
    angler.clock += dt;
    const waiting = angler.clock < A.intro.delay;

    // then the layer fades in — the fish (when the model arrives) and the
    // sparkles behind it emerge from the dark together
    if (!waiting) angler.fade = Math.min(angler.fade + dt / A.fadeIn, 1);
    const e = angler.fade * angler.fade * (3 - 2 * angler.fade);
    auroraMaterial.uniforms.uBackFade.value = e;

    // ease the fish's lean toward the pointer's horizontal position
    angler.pointerLean += (pointerAim - angler.pointerLean) *
      Math.min(dt * A.pointerEase, 1);

    // cruise toward the active section's station; homeZ carries the intro
    // swim-in from the deep and then settles at the resting plane (z 0).
    // While it waits in the dark it stays put (the heading below still runs,
    // so it sets off already nose-first)
    const k = waiting ? 0 : Math.min(dt * A.travel.ease, 1);
    angler.homeX += (anglerStation.x - angler.homeX) * k;
    angler.homeY += (anglerStation.y - angler.homeY) * k;
    angler.homeZ += (0 - angler.homeZ) * k;

    // heading: under way it faces its direction of travel like a swimming
    // fish, nose first — swimYaw biases the nose toward the camera so it
    // never goes paper-thin in profile. Over the final stretch the heading
    // blends smoothly (smoothstep) into the station's resting pose
    const view = anglerViewSize();
    const dxW = (anglerStation.x - angler.homeX) * view.w; // world units
    const dzW = -angler.homeZ;                             // toward the camera
    const swimYaw = Math.atan2(dzW + A.travel.swimYaw * Math.abs(dxW), -dxW);
    const s = Math.min(Math.hypot(dxW, dzW) / view.w / A.travel.arrive, 1);
    const blend = s * s * (3 - 2 * s); // 1 = full swim, 0 = at rest
    const yawGoal = anglerStation.yaw + (swimYaw - anglerStation.yaw) * blend;
    angler.faceYaw += (yawGoal - angler.faceYaw) *
      Math.min(dt * A.travel.turnEase, 1);

    if (angler.root) {
      // slow idle hover, like it's holding its place in the current, plus a
      // drift toward the pointer's side of the window
      const t = time * A.drift * Math.PI * 2;
      angler.root.position.set(
        angler.homeX * view.w + Math.sin(t * 0.9) * 0.4,
        angler.homeY * view.h + Math.sin(t * 1.4 + 1.0) * A.bob,
        angler.homeZ
      );
      angler.root.rotation.y = angler.faceYaw + Math.sin(t * 0.7) * A.sway +
        angler.pointerLean * A.pointerTurn;
      angler.root.rotation.z = Math.sin(t * 1.1 + 2.0) * A.roll;

      // the lantern breathes — two offset sines make it slow and irregular,
      // more bioluminescence than blinker
      if (angler.glowSprite) {
        const pt = time * A.glow.pulseSpeed * Math.PI * 2;
        const breathe =
          1 - A.glow.pulse * (0.5 + 0.3 * Math.sin(pt) + 0.2 * Math.sin(pt * 2.7 + 1.3));
        angler.glowSprite.material.opacity = breathe;
        const ps = angler.glowSize * (0.85 + 0.15 * breathe);
        angler.glowSprite.scale.set(ps, ps, 1);
        angler.glowLight.intensity = A.glow.intensity * breathe;
      }
    }

    renderer.setRenderTarget(anglerRT);
    renderer.setClearColor(0x000000, 0); // transparent where there is no fish
    renderer.clear();
    renderer.render(anglerScene, anglerCamera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
  }

  /* ---------- glowing sprite texture (generated, no asset) ---------- */

  function makeGlowTexture() {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.15, "rgba(255,255,255,0.4)");
    g.addColorStop(0.45, "rgba(255,255,255,0.07)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- sparkles riding the fluid, glowing inside the dye ---------- */

  const COUNT = CONFIG.particles.count;
  const dummy = new THREE.Object3D();
  const particles = [];
  const velSample = new THREE.Vector3(); // x/y velocity, z dye density
  const tmpColor = new THREE.Color();

  const particleMaterial = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    transparent: true,
    fog: false, // sparkles keep their own brightness logic, unfogged
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const instancedMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    particleMaterial,
    COUNT
  );
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedMesh.frustumCulled = false;
  // the sparkles render in the angler layer, at a depth behind the fish —
  // its body genuinely occludes them, and the paint dims them like the fish
  anglerScene.add(instancedMesh);

  // one family of tones — sparkles matching the ramp palette
  const palette = CONFIG.particles.palette.map((hex) => new THREE.Color(hex));

  for (let i = 0; i < COUNT; ++i) {
    particles.push({
      x: Math.random(),
      y: Math.random(),
      vx: 0,
      vy: 0,
      drift: Math.random() * Math.PI * 2,
      twinkle: 1 + Math.random() * 3,
      base: palette[i % palette.length],
      scale: 0.5 + Math.random() * 1.0,
    });
    instancedMesh.setColorAt(i, palette[i % palette.length]);
  }
  instancedMesh.instanceColor.needsUpdate = true;

  /* ---------- input: the mouse stirs the FLUID, not the particles ---------- */

  // the bioluminescence drifts slowly between aqua and violet-blue —
  // a slow, coherent cycle, not per-splat randomness
  const aquaGlow = new THREE.Vector3(...CONFIG.biolume.aqua);
  const violetGlow = new THREE.Vector3(...CONFIG.biolume.violet);
  const glowNow = new THREE.Vector3();

  function biolumeAt(timeSec, intensity) {
    const m = 0.5 + 0.5 * Math.sin(timeSec * CONFIG.biolume.cycleSpeed);
    glowNow.copy(aquaGlow).lerp(violetGlow, m);
    glowNow.addScalar(CONFIG.biolume.whiteLift);
    return glowNow.clone().multiplyScalar(intensity);
  }

  // splats are never injected at raw pointer positions — a virtual brush
  // eases toward the cursor once per frame, so fast flicks become smooth,
  // speed-limited strokes with the same character as the idle microbes
  let pointerTarget = null;
  const brush = { x: 0.5, y: 0.5, active: false };

  function onPointer(clientX, clientY) {
    // uv on the canvas — its top can sit above the visible viewport (the
    // bottom-anchored 100lvh box), so map through its actual client rect
    const rect = canvas.getBoundingClientRect();
    pointerTarget = {
      x: (clientX - rect.left) / rect.width,
      y: 1 - (clientY - rect.top) / rect.height,
    };
  }

  window.addEventListener("mousemove", (e) => onPointer(e.clientX, e.clientY));
  window.addEventListener("touchmove", (e) => onPointer(e.touches[0].clientX, e.touches[0].clientY));
  window.addEventListener("mouseleave", () => {
    pointerTarget = null;
    brush.active = false;
  });

  function updateBrush(time, dt) {
    if (!fluid || !pointerTarget || dt <= 0) return;
    // the brush chases the cursor plus a small drifting orbit, so it keeps
    // circling — and emitting — even while the pointer rests
    const ot = time * CONFIG.mouse.orbitSpeed;
    const tx = pointerTarget.x + (Math.sin(ot * 1.3) + 0.5 * Math.sin(ot * 2.17)) * CONFIG.mouse.orbit;
    const ty = pointerTarget.y + (Math.cos(ot * 1.1) + 0.5 * Math.cos(ot * 1.93)) * CONFIG.mouse.orbit;
    if (!brush.active) {
      // first contact: appear at the cursor instead of streaking toward it
      brush.x = tx;
      brush.y = ty;
      brush.active = true;
      return;
    }
    const k = 1 - Math.exp(-dt * CONFIG.mouse.follow); // framerate-independent chase
    let vx = ((tx - brush.x) * k) / dt;                // uv/s
    let vy = ((ty - brush.y) * k) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > CONFIG.mouse.maxSpeed) {
      vx *= CONFIG.mouse.maxSpeed / sp;
      vy *= CONFIG.mouse.maxSpeed / sp;
    }
    brush.x += vx * dt;
    brush.y += vy * dt;
    if (sp < 0.01) return; // resting on the cursor — don't pile up paint
    const dx = vx * CONFIG.mouse.force * motionScale;
    const dy = vy * CONFIG.mouse.force * motionScale;
    // pigment scales with the brush's speed, like the idle microbes
    const speed = Math.min(Math.hypot(dx, dy) / 60, 1);
    fluid.pendingSplats.push({
      x: brush.x, y: brush.y, dx, dy,
      color: biolumeAt(time, CONFIG.mouse.glowBase + CONFIG.mouse.glowGain * speed),
      radius: CONFIG.mouse.radius,
    });
  }

  /* ---------- idle microbe: keeps the fluid (and swarm) alive ---------- */

  function microbePos(s, time) {
    // run-and-tumble gait: warp time so travel along the path pulses. tau'(t) =
    // 1 - depth * cos(...) sweeps (1-depth) → (1+depth) each beat: a thrust,
    // then a slow — but never dead — glide, so the trail never cuts out.
    // Still a pure function of time, so the warm-up and the heart-departure
    // blending stay valid.
    const w = (Math.PI * 2) / (s.pulse || CONFIG.gait.period);
    const beat = time * w + s.phase * 3.7;
    const tau = time - CONFIG.gait.depth * Math.sin(beat) / w;
    // the body lifts with each thrust and settles during the glide
    const bob = -Math.cos(beat) * CONFIG.gait.rise;
    const t = tau + s.phase;
    return [
      s.cx + Math.sin(t * s.fx) * s.ax + Math.sin(t * s.fx2) * s.ax2,
      s.cy + Math.cos(t * s.fy) * s.ay + Math.cos(t * s.fy2) * s.ay2 + bob,
    ];
  }

  // the lissajous paths never sync, but at any given moment a few microbes
  // can happen to clump — scan the first minutes of the combined motion for
  // the pose where the closest pair is furthest apart, and start there
  const IDLE_TIME_OFFSET = (() => {
    const microbes = CONFIG.idle.microbes;
    const aspect = viewW() / viewH();
    let best = 0;
    let bestScore = -1;
    for (let T = 0; T <= 300; T += 0.5) {
      let minD = Infinity;
      // score the pose around the moment the microbes actually arrive on
      // their lissajous paths — after the intro heart has dissolved and the
      // last straggler of the staggered departure has blended in
      const arrive = CONFIG.intro.hold + CONFIG.intro.blend
        + CONFIG.intro.stagger * (microbes.length - 1);
      for (const sample of [T + arrive, T + arrive + 2, T + arrive + 4]) {
        const pos = microbes.map((s) => microbePos(s, sample));
        for (let i = 0; i < pos.length; i++) {
          for (let j = i + 1; j < pos.length; j++) {
            const dx = (pos[i][0] - pos[j][0]) * aspect;
            const dy = pos[i][1] - pos[j][1];
            minD = Math.min(minD, dx * dx + dy * dy);
          }
        }
      }
      if (minD > bestScore) { bestScore = minD; best = T; }
    }
    return best;
  })();

  /* ---------- intro pose ----------
     The microbe slots sit spaced along a heart outline and ignite one
     after another in path order — the heart draws itself on. They trace
     the outline slowly (a static pose would dissolve — tracing keeps the
     line re-seeded); after a hold they ease onto their lissajous paths and
     the heart dissolves into the ambient field. */

  // classic parametric heart, normalized to roughly ±1, y up
  function heartXY(a) {
    return [
      (16 * Math.pow(Math.sin(a), 3)) / 17,
      (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17,
    ];
  }

  // the heart parametrization stalls at the top cleft and bottom cusp, so
  // uniform parameter steps bunch microbes there and their dye merges into
  // blobs — remap through an arc-length table for even spacing on the outline
  const heartArcParam = (() => {
    const N = 512;
    const cum = new Float32Array(N + 1);
    let px = 0, py = 0;
    for (let k = 0; k <= N; k++) {
      const [x, y] = heartXY((k / N) * Math.PI * 2);
      if (k > 0) cum[k] = cum[k - 1] + Math.hypot(x - px, y - py);
      px = x; py = y;
    }
    const total = cum[N];
    return (u) => {
      const target = (u - Math.floor(u)) * total;
      let lo = 1, hi = N;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid + 1; else hi = mid;
      }
      const seg = cum[lo] - cum[lo - 1] || 1;
      const f = (target - cum[lo - 1]) / seg;
      return ((lo - 1 + f) / N) * Math.PI * 2;
    };
  })();

  /* ---------- intro pose: the heart ----------
     At load the microbes (and their ghosts) sit spaced along the heart
     outline, slowly tracing it — a static pose would dissolve, tracing
     keeps the line re-seeded. After the hold they ease onto their lissajous
     paths one by one and the heart dissolves into the ambient field. */

  // where intro slot uHome sits at a live time: crawling around the heart
  // outline at the trace speed (the arc-length remap keeps spacing even)
  function introPoint(uHome, time) {
    const I = CONFIG.intro;
    const [hx, hy] = heartXY(heartArcParam(uHome + time * I.trace));
    const aspect = viewW() / viewH();
    return [I.cx + (hx * I.size) / aspect, I.cy + hy * I.size];
  }

  // eased 0..1 ignition of the slot at outline position u — the reveal
  // sweep lights the slots up in path order, so the outline appears drawn
  // on rather than all at once
  function introIgnite(u, time) {
    const I = CONFIG.intro;
    const k = Math.min(Math.max((time - u * I.reveal) / I.ignite, 0), 1);
    return k * k * (3 - 2 * k);
  }

  // eased 0..1 departure of microbe i from the heart — staggered by index,
  // so the swarm peels off the outline one microbe at a time
  function introEase(i, time) {
    const I = CONFIG.intro;
    const k = Math.min(Math.max((time - I.hold - i * I.stagger) / I.blend, 0), 1);
    return k * k * (3 - 2 * k);
  }

  // where microbe i actually is at a live time: on the heart during the
  // intro (negative times = the warm-up's reconstructed past), on its
  // lissajous path afterwards, eased between the two
  function microbeLivePos(s, i, time) {
    const heart = introPoint(i / CONFIG.idle.microbes.length, time);
    const e = introEase(i, time);
    if (e <= 0) return heart;
    const liss = microbePos(s, IDLE_TIME_OFFSET + time);
    return [heart[0] + (liss[0] - heart[0]) * e, heart[1] + (liss[1] - heart[1]) * e];
  }

  // ghost microbe j lives at the midpoints between the real microbes — it
  // has no lissajous path to leave for; its glow simply fades at departure
  function ghostLivePos(j, time) {
    return introPoint((j + 0.5) / CONFIG.intro.ghosts, time);
  }

  /* ---------- swarm: the microbes school toward the cursor ----------
     Each microbe chases its own smoothed copy of the pointer (per-microbe
     rates → leaders and stragglers) and blends toward it with an eased
     0..1 pull. The pull only engages once a microbe has left the intro
     heart, and decays when the pointer leaves, so the lissajous wander —
     still a pure function of time — remains the resting behaviour. */

  const swarmState = CONFIG.idle.microbes.map((s, i) => {
    // deterministic golden-ratio jitter — no Math.random, same swarm every load
    const frac = (i * 0.618 + 0.31) % 1;
    return {
      x: 0.5, y: 0.5, f: 0,    // chased cursor point + eased pull
      px: 0.5, py: 0.5, pf: 0, // previous frame's state, for the splat velocity
      rate: CONFIG.swarm.follow * (1 + CONFIG.swarm.vary * (frac - 0.5)),
    };
  });

  // where microbe i sits once the swarm pull is applied: its own wander
  // pattern re-centred on its chased cursor point and scaled down, so the
  // school keeps its individual wiggle instead of stacking on one spot.
  // The x offset is aspect-corrected (like introPoint), so the cloud stays
  // round on any screen instead of stretching with the uv square
  function swarmWarp(s, time, base, cx, cy, f) {
    if (f <= 0.001) return base;
    const liss = microbePos(s, IDLE_TIME_OFFSET + time);
    const aspect = viewW() / viewH();
    const tx = cx + ((liss[0] - s.cx) * CONFIG.swarm.spread) / aspect;
    const ty = cy + (liss[1] - s.cy) * CONFIG.swarm.spread;
    return [base[0] + (tx - base[0]) * f, base[1] + (ty - base[1]) * f];
  }

  // scale > 1 lets the warm-up compress many frames' worth of stirring into
  // one splat; during live frames it stays at 1
  function idleStir(time, scale = 1) {
    if (!fluid) return;
    const microbes = CONFIG.idle.microbes;
    const h = 1 / 60;
    const I = CONFIG.intro;
    for (let i = 0; i < microbes.length; i++) {
      const s = microbes[i];
      // each slot ignites when the reveal sweep reaches its spot on the
      // outline — before its turn it lays down nothing at all
      const ig = introIgnite(i / microbes.length, time);
      if (ig <= 0) continue;
      // intro stirs run at reduced force, easing up to full as each microbe
      // disperses — same staggered ease as microbeLivePos, so force, pigment
      // and path track together per microbe
      const eIntro = introEase(i, time);
      const introForce = (I.force + (1 - I.force) * eIntro) * ig;
      const introGlow = (I.glow + (1 - I.glow) * eIntro) * ig;
      // swarm pull — advanced on live frames only (scale 1), so warm-up
      // reconstruction stays a pure function of time
      const sw = swarmState[i];
      if (scale === 1) {
        sw.px = sw.x; sw.py = sw.y; sw.pf = sw.f;
        // the pull eases in while a pointer is present (gated by the intro
        // departure, so nothing tugs on the heart) and back out when it leaves
        const want = pointerTarget ? eIntro : 0;
        sw.f += (want - sw.f) * (1 - Math.exp(-h / CONFIG.swarm.gather));
        if (pointerTarget) {
          const k = 1 - Math.exp(-h * sw.rate);
          sw.x += (pointerTarget.x - sw.x) * k;
          sw.y += (pointerTarget.y - sw.y) * k;
        }
      }
      // numeric path derivative — valid on the heart, the lissajous paths
      // and every eased blend in between; the previous sample uses last
      // frame's swarm state, so the chase itself pushes fluid too
      const [x, y] = swarmWarp(s, time, microbeLivePos(s, i, time), sw.x, sw.y, sw.f);
      const [px, py] = swarmWarp(s, time - h, microbeLivePos(s, i, time - h), sw.px, sw.py, sw.pf);
      // cap the chase speed like the brush — a fast flick tugs the whole
      // school, and 16 uncapped splats at once would blast the paint
      let vx = (x - px) / h;
      let vy = (y - py) / h;
      const vsp = Math.hypot(vx, vy);
      if (vsp > CONFIG.mouse.maxSpeed) {
        vx *= CONFIG.mouse.maxSpeed / vsp;
        vy *= CONFIG.mouse.maxSpeed / vsp;
      }
      const dx = vx * CONFIG.idle.force * introForce * motionScale;
      const dy = vy * CONFIG.idle.force * introForce * motionScale;
      // pigment scales with the microbe's speed, like the mouse strokes
      const speed = Math.min(Math.hypot(dx, dy) / 60, 1);
      fluid.pendingSplats.push({
        x, y, dx: dx * scale, dy: dy * scale,
        color: biolumeAt(time, (CONFIG.idle.glowBase + CONFIG.idle.glowGain * speed) * scale * introGlow),
        radius: CONFIG.idle.radius,
      });
    }

    // ghost microbes: intro-only line thickeners. They ride the same shapes
    // at half-slot offsets, ignite in the same path-order sweep, and fade
    // out in the staggered ripple the real microbes leave in, instead of
    // joining the ambient swarm.
    for (let j = 0; j < I.ghosts; j++) {
      const ig = introIgnite((j + 0.5) / I.ghosts, time);
      const gFade = (1 - introEase(j + 0.5, time)) * ig;
      if (gFade <= 0) continue;
      const [x, y] = ghostLivePos(j, time);
      const [px, py] = ghostLivePos(j, time - h);
      const dx = ((x - px) / h) * CONFIG.idle.force * I.force * motionScale * ig;
      const dy = ((y - py) / h) * CONFIG.idle.force * I.force * motionScale * ig;
      const speed = Math.min(Math.hypot(dx, dy) / 60, 1);
      fluid.pendingSplats.push({
        x, y, dx: dx * scale, dy: dy * scale,
        color: biolumeAt(time, (CONFIG.idle.glowBase + CONFIG.idle.glowGain * speed) * scale * I.glow * gFade),
        radius: CONFIG.idle.radius,
      });
    }
  }

  /* ---------- warm-up: reconstruct the microbes' recent past ----------
     The idle paths are analytic, so they can be evaluated at negative
     times: lay their last few seconds of paint down in one burst (older
     paint pre-faded by the dye dissipation rate), then let the solver
     smear it. The live loop starts at t=0 and continues seamlessly. */

  function warmup() {
    if (!fluid) return;
    const W = CONFIG.warmup;
    // how much of a splat survives one second of live dissipation (~60 steps)
    const dyeSurvivalPerSec = Math.pow(CONFIG.sim.dyeDissipation, 60);
    // the settle steps below fade every seed too — age the history against
    // the settle time, not against t=0, so the field doesn't open dim
    const settle = W.steps / 60;
    for (let t = -W.span; t < 0; t += W.interval) {
      const age = Math.max(0, -t - settle);
      const survives = Math.pow(dyeSurvivalPerSec, age);
      // interval * 60 = how many live-frame splats each history splat stands in for
      idleStir(t, W.interval * 60 * survives);
    }
    for (let i = 0; i < W.steps; i++) {
      fluid.step((1 / 60) * CONFIG.sim.speed);
    }
  }

  // warmup(); // experiment: disabled — the field starts blank

  /* ---------- resize ---------- */

  let resizeTimer;

  let lastW = viewW(), lastH = viewH();

  function onResize() {
    const w = viewW();
    const h = viewH();
    // mobile browsers fire resize when the URL bar collapses on scroll, but
    // the canvas layout (100lvh) hasn't changed — nothing to do then, and
    // rebuilding anyway made the background visibly slide
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    camera.left = w / -2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = h / -2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false); // buffer only — CSS owns the placement
    auroraMaterial.uniforms.uAspect.value = w / h;

    anglerCamera.aspect = w / h;
    anglerCamera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    anglerRT.setSize(Math.round(w * pr), Math.round(h * pr));

    // grids are allocated for the current aspect ratio — rebuild them
    // (debounced) and copy the old paint over so nothing visibly resets
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!fluidSupported) return;
      const prev = fluid;
      fluid = createFluid();
      if (prev) {
        fluid.seedFrom(prev);
        prev.dispose();
      }
      auroraMaterial.uniforms.uDyeTexel.value.copy(fluid.dyeTexel);
    }, 250);
  }
  window.addEventListener("resize", onResize);

  /* ---------- scroll: fade the visual once past the hero ---------- */

  function onScroll() {
    const fade = 1 - Math.min(window.scrollY / window.innerHeight, 1) * 0.75;
    canvas.style.opacity = fade.toFixed(3);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- particle update: advected by the velocity field ---------- */

  function updateParticles(time, dt) {
    const size = CONFIG.particles.size;
    // the uv field maps onto the angler camera's frustum at the sparkle
    // depth, so they still cover the whole screen behind the fish
    const depth = CONFIG.particles.depth;
    const dist = anglerCamera.position.z - depth;
    const wh = 2 * dist * Math.tan((anglerCamera.fov * Math.PI) / 360);
    const ww = wh * anglerCamera.aspect;
    const pxToWorld = wh / viewH(); // sprite sizes stay in px terms

    for (let i = 0; i < COUNT; ++i) {
      const p = particles[i];
      let dyeHere = 0;

      if (fluid) {
        fluid.sampleVelocity(p.x, p.y, velSample);
        dyeHere = velSample.z;
        // texels/s -> uv/s per axis, with a bit of gain so the ride is visible
        const fx = velSample.x * fluid.texel.x * CONFIG.particles.flowGain;
        const fy = velSample.y * fluid.texel.y * CONFIG.particles.flowGain;
        // heavy inertia: the paint drags the sparkles along sluggishly
        p.vx += (fx - p.vx) * Math.min(dt * CONFIG.particles.inertia, 1);
        p.vy += (fy - p.vy) * Math.min(dt * CONFIG.particles.inertia, 1);
      }

      // faint ambient drift so calm regions still breathe
      const ax = Math.sin(time * 0.3 + p.drift) * 0.006 * motionScale;
      const ay = Math.cos(time * 0.26 + p.drift * 1.7) * 0.005 * motionScale;

      p.x += (p.vx + ax) * dt;
      p.y += (p.vy + ay) * dt;

      // wrap around the edges with a margin
      if (p.x < -0.05) p.x += 1.1;
      if (p.x > 1.05) p.x -= 1.1;
      if (p.y < -0.05) p.y += 1.1;
      if (p.y > 1.05) p.y -= 1.1;

      // sparkles live in the culture: near-invisible outside the wisps,
      // twinkling bright inside them (ref: right example)
      const twinkle = 0.75 + 0.25 * Math.sin(time * p.twinkle * 2.2 + p.drift * 7.0);
      const brightness = fluid
        ? 0.12 + Math.min(dyeHere * 2.8, 1.8) * twinkle
        : 0.42;
      tmpColor.copy(p.base).multiplyScalar(brightness);
      instancedMesh.setColorAt(i, tmpColor);

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const pulse = 1 + Math.min(speed * 2, 0.35);

      dummy.position.set((p.x - 0.5) * ww, (p.y - 0.5) * wh, depth);
      const sc = size * p.scale * pulse * pxToWorld;
      dummy.scale.set(sc, sc, 1);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.instanceColor.needsUpdate = true;
  }

  /* ---------- animation loop ---------- */

  // on-screen FPS meter (real wall-clock frames, unaffected by
  // motionScale) — hidden unless the page is loaded with ?fps
  const showFps = new URLSearchParams(location.search).has("fps");
  let fpsEl = null;
  if (showFps) {
    fpsEl = document.createElement("div");
    fpsEl.style.cssText =
      "position:fixed;top:70px;left:10px;z-index:9999;padding:4px 8px;" +
      "font:12px/1.4 monospace;color:#7de8d8;background:rgba(0,0,0,0.55);" +
      "border-radius:4px;pointer-events:none;";
    document.body.appendChild(fpsEl);
  }
  let fpsFrames = 0;
  let fpsLast = performance.now();

  const clock = new THREE.Clock();

  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30) * motionScale;
    const time = clock.getElapsedTime();

    if (fpsEl) {
      fpsFrames++;
      const fpsNow = performance.now();
      if (fpsNow - fpsLast >= 500) {
        fpsEl.textContent = ((fpsFrames * 1000) / (fpsNow - fpsLast)).toFixed(1) + " fps";
        fpsFrames = 0;
        fpsLast = fpsNow;
      }
    }

    if (fluid) {
      idleStir(time);
      updateBrush(time, dt);
      fluid.step(dt * CONFIG.sim.speed);
      auroraMaterial.uniforms.uDye.value = fluid.dye.read.texture;
      auroraMaterial.uniforms.uVelocity.value = fluid.velocity.read.texture;
      auroraMaterial.uniforms.uHeight.value = fluid.height.texture;
    }

    auroraMaterial.uniforms.uTime.value = time * motionScale;
    updateParticles(time, dt);
    updateAngler(time, dt);
    renderer.render(scene, camera);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();

/* ---------- Scroll reveal ---------- */

(function scrollReveal() {
  const els = document.querySelectorAll(".reveal");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => {
    // hero elements are on screen at load — the -40px bottom rootMargin would
    // keep the ones hugging the viewport edge (scroll hint, coords) hidden
    // until the first scroll, so reveal them right away instead
    if (el.closest(".hero")) {
      el.classList.add("is-visible");
    } else {
      io.observe(el);
    }
  });
})();

/* ---------- Nav scrolled state ---------- */

(function navState() {
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 30);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
