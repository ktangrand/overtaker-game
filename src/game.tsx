import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const SPEED_STAGES = [
  { capKmh: 100, goal: 3 },
  { capKmh: 130, goal: 4 },
  { capKmh: 160, goal: 5 },
  { capKmh: 190, goal: 6 },
  { capKmh: 220, goal: 7 },
  { capKmh: 250, goal: 8 },
  { capKmh: 280, goal: 9 },
];

const TUNING = {
  lateralAccel: 28,
  dampingX: 6,
  baseAccel: 9.5,
  brakeAccel: 16,
  autoUp: 2.4,
  autoDown: 3,
  oncomingSeedCount: 4,
  oncomingSeedZStart: 80,
  oncomingSpacing: 70,
  oncomingSeedRand: 30,
  sameSeedCount: 6,
  sameSeedZStart: 50,
  sameSeedSpacing: 35,
  sameSeedRand: 30,
  oncomingSpawnProb: 0.35,
  oncomingRespawnMin: 180,
  oncomingRespawnVar: 140,
  sameRespawnMin: 120,
  sameRespawnVar: 160,
  oncomingSpeedMin: 16,
  oncomingSpeedMax: 24,
  sameSpeedMin: 12,
  sameSpeedMax: 23,
  ttcDanger: 1,
  ttcWarn: 2.2,
  laneMarginX: 0.15,
  corridorRedSec: 1.2,
  corridorAmberSec: 2.5,
  corridorWidthMargin: 0.45,
  followHeadwaySec: 1.3,
  followMinGap: 3,
  followBrakeSoft: 3,
  followBrakeHard: 8.5,
  followLeadMargin: 0.4,
  npcAccel: 3,
  npcMinSpeed: 6,
  minSpawnGapSame: 22,
  minSpawnGapOncoming: 26,
  overtakeIntentSec: 0.6,
  followBandScale: 0.6,
  camFollowLerp: 0.22,
  camYawFactor: 0.06,
  camRollFactor: 0.02,
  lookSensitivity: 0.0025,
  lookPitchLimit: 0.35,
  lookYawLimit: 0.6,
  leanX: -0.55,
  leanY: 0.08,
  leanYaw: -0.5,
  leanHoldScale: 1.5,
  scrapePushK: 24,
  scrapeSlowK: 2.2,
  crashRelSpeedSame: 7,
  crashImpactOncoming: 2,
  laneOffsetMax: 0.35,
  laneWanderAmpSame: 0.1,
  laneWanderAmpOncoming: 0.14,
  laneWanderFreqMin: 0.4,
  laneWanderFreqMax: 0.9,
  laneEdgeMargin: 0.22,
  avoidLookaheadSec: 1.6,
  avoidLookaheadDist: 38,
  avoidTriggerGap: 1.25,
  avoidXMax: 0.55,
  avoidLerp: 0.08,
  avoidRelaxLerp: 0.04,
  avoidSkillThreshold: 0.35,
  comboAdd: 0.5,
  comboDecay: 0.28,
};

const DEFAULT_PARAMS = {
  ...TUNING,
  speedScale: 1,
  hitboxXExtra: 0.85,
  hitboxZExtra: 1.6,
  fovMin: 40,
  fovMax: 58,
};

const CURVE = { A1: 2.2, A2: 1.2, F1: (2 * Math.PI) / 520, F2: (2 * Math.PI) / 810, PH2: 2.1 };
const curveXAtS = (s: number) => CURVE.A1 * Math.sin(CURVE.F1 * s) + CURVE.A2 * Math.sin(CURVE.F2 * s + CURVE.PH2);
const kmh = (mps: number) => (mps * 3.6) | 0;

const loadMeta = () => {
  try {
    const s = localStorage.getItem('eo_meta');
    if (!s) throw new Error('missing');
    const m = JSON.parse(s);
    return {
      c: m.c | 0,
      u: {
        a: m.u?.a | 0,
        b: m.u?.b | 0,
        s: m.u?.s | 0,
        l: m.u?.l | 0,
      },
    };
  } catch {
    return { c: 0, u: { a: 0, b: 0, s: 0, l: 0 } };
  }
};
const saveMeta = (m: { c: number; u: { a: number; b: number; s: number; l: number } }) => {
  try {
    localStorage.setItem('eo_meta', JSON.stringify(m));
  } catch (e) {
    console.warn('Unable to save meta', e);
  }
};
const upCost = (lvl: number) => 10 * (1 << Math.min(10, lvl));

const MODS = {
  list: [
    { n: 'Nitro', d: 'Accel +25%, Max +5%', ma: 0.25, ms: 0.05 },
    { n: 'Sharp Brakes', d: 'Brake +30%', mb: 0.3 },
    { n: 'Sticky Tires', d: 'Lateral +25%', ml: 0.25 },
    { n: 'Hot Streak', d: 'Combo +0.15', hc: 0.15 },
  ],
  pick: (k: number) => {
    const arr: number[] = [];
    const used = new Set<number>();
    while (arr.length < k && used.size < MODS.list.length) {
      const i = (Math.random() * MODS.list.length) | 0;
      if (!used.has(i)) {
        used.add(i);
        arr.push(i);
      }
    }
    return arr;
  },
};

const GLITCHES = {
  list: [
    { n: 'Bullet Time', d: 'Time slows near danger. +20% score', dur: 22, a: (m: any) => { m.near = 1; m.score *= 1.2; } },
    { n: 'Needle Threader', d: 'Half width hitbox; –10% score', dur: 28, a: (m: any) => { m.hitX = 0.5; m.score *= 0.9; } },
    { n: 'Truck Mode', d: 'Long hitbox, heavier scrapes', dur: 30, a: (m: any) => { m.hitZ = 1.6; m.scrape = 1.4; } },
    { n: 'Reverse Flow', d: 'More oncoming spawns. +30% score', dur: 26, a: (m: any) => { m.spawn = 0.35; m.score *= 1.3; } },
    { n: 'Snake Road', d: 'Road curves swell', dur: 24, a: (m: any) => { m.curve = 1.8; } },
    { n: 'Lean Ghost', d: 'Leaning shrinks width by 50%', dur: 25, a: (m: any) => { m.ghost = 1; } },
    { n: 'Fog Bank', d: 'Heavy fog. +15% score', dur: 22, a: (m: any) => { m.fog = 1; m.score *= 1.15; } },
    { n: 'Nitro Drip', d: '+20% accel', dur: 24, a: (m: any) => { m.acc = 1.2; } },
    { n: 'Mirror Controls', d: 'Steering inverted', dur: 18, a: (m: any) => { m.inv = 1; } },
    { n: 'Tunnel Vision', d: 'Tighter FOV. +10% score', dur: 20, a: (m: any) => { m.fovTight = 1; m.score *= 1.1; } },
    { n: 'Fisheye', d: 'Wider FOV. –10% score', dur: 20, a: (m: any) => { m.fovWide = 1; m.score *= 0.9; } },
    { n: 'Slipstream Draft', d: 'Boost when tailing', dur: 26, a: (m: any) => { m.slip = 1; } },
    { n: 'Drift King', d: '+50% lateral, –40% damping', dur: 22, a: (m: any) => { m.lat = 1.5; m.damp = 0.6; } },
    { n: 'Greased Road', d: '–30% lateral, –30% brake', dur: 22, a: (m: any) => { m.lat = 0.7; m.brk = 0.7; } },
    { n: 'Blade Runner', d: 'Faster oncoming. +20% score', dur: 24, a: (m: any) => { m.onc = 1.35; m.score *= 1.2; } },
    { n: 'Car-nival', d: 'More same-lane spawns', dur: 24, a: (m: any) => { m.spawnSame = 0.3; } },
    { n: 'Quake', d: 'Cab shakes', dur: 18, a: (m: any) => { m.shake = 1; } },
    { n: 'Straight Shot', d: 'Road straightens', dur: 22, a: (m: any) => { m.curve = 0.6; } },
  ],
  pick: (k: number) => {
    const arr: number[] = [];
    const used = new Set<number>();
    while (arr.length < k && used.size < GLITCHES.list.length) {
      const i = (Math.random() * GLITCHES.list.length) | 0;
      if (!used.has(i)) {
        used.add(i);
        arr.push(i);
      }
    }
    return arr;
  },
};

(() => {
  try {
    for (let i = 1; i < SPEED_STAGES.length; i++) console.assert(SPEED_STAGES[i].capKmh > SPEED_STAGES[i - 1].capKmh, 'stages increasing');
    console.assert(kmh(10 / 3.6) === 10, 'kmh conv');
    console.assert(TUNING.followHeadwaySec > 0 && TUNING.followHeadwaySec < 5, 'headway sanity');
    console.assert(DEFAULT_PARAMS.fovMax > DEFAULT_PARAMS.fovMin && DEFAULT_PARAMS.fovMin > 30, 'fov bounds');
    const mp = MODS.pick(3);
    console.assert(new Set(mp).size === mp.length && mp.length <= MODS.list.length, 'unique mod picks');
    const gp = GLITCHES.pick(2);
    console.assert(new Set(gp).size === gp.length && gp.length <= GLITCHES.list.length, 'unique glitch picks');
    console.assert(upCost(0) === 10 && upCost(1) === 20, 'upCost');
    const a = curveXAtS(1000), b = curveXAtS(1001);
    console.assert(Math.abs(a - b) < 10, 'curve continuity');
  } catch (e) {
    console.warn('Sanity checks failed', e);
  }
})();

function randRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(x: number, a: number, b: number) {
  return Math.min(Math.max(x, a), b);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

type Npc = {
  mesh: THREE.Mesh;
  lane: number;
  z: number;
  speed: number;
  same: boolean;
  respawn: number;
  wanderPhase: number;
  wanderFreq: number;
  wanderAmp: number;
  avoidX: number;
};

type PlayerState = {
  speed: number;
  x: number;
  z: number;
  vx: number;
  gear: number;
  combo: number;
  heat: number;
  score: number;
};

type Params = typeof DEFAULT_PARAMS;

type ModRun = {
  lat?: number;
  damp?: number;
  acc?: number;
  brk?: number;
  ms?: number;
  curve?: number;
  ghost?: number;
  fog?: number;
  score?: number;
  leanX?: number;
  leanY?: number;
  leanYaw?: number;
  near?: number;
  hitX?: number;
  hitZ?: number;
  spawn?: number;
  spawnSame?: number;
  onc?: number;
  inv?: number;
  shake?: number;
  fovTight?: number;
  fovWide?: number;
  slip?: number;
};

type GlitchState = {
  list: number[] | null;
  time: number;
  mod: ModRun;
};

function RacingGame() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const vignetteRef = useRef<HTMLDivElement | null>(null);
  const hudSpeedRef = useRef<HTMLDivElement | null>(null);
  const hudOvertakesRef = useRef<HTMLDivElement | null>(null);
  const hudGoalRef = useRef<HTMLDivElement | null>(null);
  const hudStageRef = useRef<HTMLDivElement | null>(null);
  const hudSpeedBarRef = useRef<HTMLDivElement | null>(null);
  const hudScoreRef = useRef<HTMLDivElement | null>(null);
  const hudComboRef = useRef<HTMLDivElement | null>(null);
  const hudHeatBarRef = useRef<HTMLDivElement | null>(null);

  const restartRef = useRef<() => void>(() => {});
  const startRunRef = useRef<() => void>(() => {});

  const [crashed, setCrashed] = useState(false);
  const [leanHeld, setLeanHeld] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [inRun, setInRun] = useState(false);
  const inRunRef = useRef(false);
  useEffect(() => { inRunRef.current = inRun; }, [inRun]);
  const [meta, setMeta] = useState(loadMeta());
  const metaRef = useRef(meta);
  useEffect(() => { metaRef.current = meta; }, [meta]);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const [modPick, setModPick] = useState<number[] | null>(null);
  const [runMod, setRunMod] = useState<ModRun>({});
  const [glitchPick, setGlitchPick] = useState<number[] | null>(null);
  const [glitch, setGlitch] = useState<GlitchState>({ list: null, time: 0, mod: {} });
  const [lastEarn, setLastEarn] = useState(0);
  const [lastStats, setLastStats] = useState({ score: 0, overtakes: 0, meters: 0 });

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x0b0c10);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 500);
    camera.position.set(0, 1.8, -5);
    camera.lookAt(new THREE.Vector3(0, 0.8, 12));

    const fog = new THREE.FogExp2(0x0b0c10, 0.03);
    scene.fog = fog;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 6, 5);
    scene.add(dir);

    const roadMat = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.8, metalness: 0.1 });
    const roadGeo = new THREE.BoxGeometry(5, 0.2, 400);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(0, -0.1, 180);
    scene.add(road);

    const dividerMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, emissive: 0x111111 });
    const dividerGeo = new THREE.BoxGeometry(0.1, 0.05, 6);
    const dividerCount = 32;
    const dividers: THREE.Mesh[] = [];
    for (let i = 0; i < dividerCount; i++) {
      const d = new THREE.Mesh(dividerGeo, dividerMat);
      d.position.set(0, 0.03, i * 12);
      scene.add(d);
      dividers.push(d);
    }

    const createCarMesh = (color: number) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 2.1), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }));
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 1.1), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
      cab.position.set(0, 0.35, -0.05);
      body.add(cab);
      return body;
    };

    const player = createCarMesh(0x2be3f0);
    scene.add(player);

    const npcColors = [0xff6b6b, 0xffc857, 0x8aff80, 0xd980ff, 0x80b3ff];
    const npcs: Npc[] = [];

    const spawnNpc = (same: boolean, seedIdx: number) => {
      const mesh = createCarMesh(npcColors[(Math.random() * npcColors.length) | 0]);
      const lane = same ? (Math.random() > 0.5 ? 1 : -1) : (Math.random() > 0.5 ? 1 : -1);
      const zStartBase = same ? paramsRef.current.sameSeedZStart + seedIdx * paramsRef.current.sameSeedSpacing : paramsRef.current.oncomingSeedZStart + seedIdx * paramsRef.current.oncomingSpacing;
      const z = zStartBase + randRange(-paramsRef.current.sameSeedRand, paramsRef.current.sameSeedRand);
      const speed = (same ? randRange(paramsRef.current.sameSpeedMin, paramsRef.current.sameSpeedMax) : randRange(paramsRef.current.oncomingSpeedMin, paramsRef.current.oncomingSpeedMax)) * (same ? 1 : -1);
      const wanderAmp = (same ? paramsRef.current.laneWanderAmpSame : paramsRef.current.laneWanderAmpOncoming) * randRange(0.7, 1.3);
      const npc: Npc = {
        mesh,
        lane,
        z,
        speed,
        same,
        respawn: 0,
        wanderPhase: Math.random() * Math.PI * 2,
        wanderFreq: randRange(paramsRef.current.laneWanderFreqMin, paramsRef.current.laneWanderFreqMax),
        wanderAmp,
        avoidX: 0,
      };
      npcs.push(npc);
      scene.add(mesh);
    };

    for (let i = 0; i < paramsRef.current.oncomingSeedCount; i++) spawnNpc(false, i);
    for (let i = 0; i < paramsRef.current.sameSeedCount; i++) spawnNpc(true, i);

    const state: PlayerState = { speed: 0, x: 0, z: 0, vx: 0, gear: 1, combo: 1, heat: 0, score: 0 };
    let meters = 0;
    let overtakes = 0;
    let crashedLocal = false;
    let crashCooldown = 0;
    let goal = SPEED_STAGES[0].goal;
    let stageIdx = 0;
    let runTime = 0;

    const pressed: Record<string, boolean> = {};
    const handleKey = (e: KeyboardEvent, d: boolean) => {
      pressed[e.code] = d;
      if (['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => handleKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => handleKey(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const pointer = { x: 0, y: 0, down: false };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    };
    const onPointerDown = () => { pointer.down = true; setLeanHeld(true); };
    const onPointerUp = () => { pointer.down = false; setLeanHeld(false); };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    const vignette = vignetteRef.current;
    const hudSpd = hudSpeedRef.current;
    const hudOver = hudOvertakesRef.current;
    const hudGoal = hudGoalRef.current;
    const hudStage = hudStageRef.current;
    const hudBar = hudSpeedBarRef.current;
    const hudScore = hudScoreRef.current;
    const hudCombo = hudComboRef.current;
    const hudHeat = hudHeatBarRef.current;

    const resetRun = () => {
      state.speed = 0;
      state.x = 0;
      state.z = 0;
      state.vx = 0;
      state.gear = 1;
      state.combo = 1;
      state.heat = 0;
      state.score = 0;
      meters = 0;
      overtakes = 0;
      crashedLocal = false;
      crashCooldown = 0;
      goal = SPEED_STAGES[0].goal;
      stageIdx = 0;
      runTime = 0;
      player.position.set(curveXAtS(0), 0.2, 0);
      player.rotation.set(0, 0, 0);
      npcs.forEach((npc) => {
        respawnNpc(npc, npc.same);
        updateNpc(npc, 0, {});
      });
      setGlitch({ list: null, time: 0, mod: {} });
      setGlitchPick(null);
      setCrashed(false);
      setInRun(true);
      inRunRef.current = true;
    };

    restartRef.current = resetRun;

    const applyMod = (m: ModRun) => {
      const p = { ...paramsRef.current } as Params;
      p.lateralAccel *= m.lat ?? 1;
      p.dampingX *= m.damp ?? 1;
      p.baseAccel *= m.acc ?? 1;
      p.brakeAccel *= m.brk ?? 1;
      p.fovMin *= m.fovTight ? 0.85 : 1;
      p.fovMax *= m.fovWide ? 1.15 : m.fovTight ? 0.85 : 1;
      p.laneWanderAmpOncoming *= m.onc ?? 1;
      p.laneWanderAmpSame *= m.spawnSame ? 1.3 : 1;
      return p;
    };

    startRunRef.current = () => {
      resetRun();
      setRunMod((prev) => ({ ...prev }));
    };

    const resize = () => {
      if (!mountRef.current) return;
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);

    const checkCrash = (npc: Npc, hitX: number, hitZ: number) => {
      const dx = (npc.mesh.position.x - player.position.x) / (0.45 + hitX);
      const dz = (npc.mesh.position.z - player.position.z) / (1.1 + hitZ);
      return Math.abs(dx) < 1 && Math.abs(dz) < 1;
    };

    const queueGlitch = () => {
      const picks = GLITCHES.pick(3);
      setGlitchPick(picks);
      setInRun(false);
      inRunRef.current = false;
    };

    const chooseGlitch = (idx: number) => {
      setGlitch((g) => {
        const mod: ModRun = { ...g.mod };
        GLITCHES.list[g.list![idx]].a(mod);
        return { list: null, time: GLITCHES.list[g.list![idx]].dur, mod };
      });
      setGlitchPick(null);
      setInRun(true);
      inRunRef.current = true;
    };

    const updateHud = () => {
      if (!hudSpd || !hudOver || !hudGoal || !hudStage || !hudBar || !hudScore || !hudCombo || !hudHeat) return;
      hudSpd.textContent = `${kmh(state.speed)} km/h`;
      hudOver.textContent = `${overtakes}`;
      hudGoal.textContent = `${goal}`;
      hudStage.textContent = `Stage ${stageIdx + 1}`;
      hudBar.style.width = `${clamp(state.speed / ((SPEED_STAGES[stageIdx]?.capKmh || 280) / 3.6), 0, 1) * 100}%`;
      hudScore.textContent = `${state.score.toFixed(0)}`;
      hudCombo.textContent = `${state.combo.toFixed(2)}×`;
      hudHeat.style.width = `${clamp(state.heat / 1.5, 0, 1) * 100}%`;
    };

    const updateGoal = () => {
      const stage = SPEED_STAGES[stageIdx];
      if (overtakes >= goal) {
        stageIdx = Math.min(SPEED_STAGES.length - 1, stageIdx + 1);
        goal = (SPEED_STAGES[stageIdx] ?? stage).goal + overtakes;
      }
    };

    const respawnNpc = (npc: Npc, same: boolean) => {
      npc.same = same;
      npc.lane = Math.random() > 0.5 ? 1 : -1;
      npc.z = (same ? paramsRef.current.sameSeedZStart : paramsRef.current.oncomingSeedZStart) + randRange(-10, 10);
      npc.speed = (same ? randRange(paramsRef.current.sameSpeedMin, paramsRef.current.sameSpeedMax) : randRange(paramsRef.current.oncomingSpeedMin, paramsRef.current.oncomingSpeedMax)) * (same ? 1 : -1);
      npc.respawn = same ? paramsRef.current.sameRespawnMin + Math.random() * paramsRef.current.sameRespawnVar : paramsRef.current.oncomingRespawnMin + Math.random() * paramsRef.current.oncomingRespawnVar;
    };

    const updateNpc = (npc: Npc, dt: number, mod: ModRun) => {
      npc.respawn = Math.max(0, npc.respawn - dt);
      const curveX = curveXAtS(state.z + npc.z);
      npc.wanderPhase += npc.wanderFreq * dt;
      const wander = Math.sin(npc.wanderPhase) * npc.wanderAmp;
      const avoid = npc.avoidX * paramsRef.current.avoidXMax;
      npc.mesh.position.set(npc.lane * (1 + paramsRef.current.laneMarginX + wander + avoid) + curveX, 0, npc.z);
      npc.z -= (state.speed + npc.speed) * dt;

      if (!npc.same && mod.spawn && Math.random() < mod.spawn * dt) npc.respawn = 0;
      if (npc.same && mod.spawnSame && Math.random() < mod.spawnSame * dt) npc.respawn = 0;

      if (npc.z < -20 || npc.z > 200) {
        if (npc.respawn <= 0) respawnNpc(npc, npc.same);
      }
    };

    const checkAvoid = (npc: Npc, dt: number) => {
      const gap = npc.z - state.z;
      const relSpeed = state.speed + npc.speed;
      if (relSpeed <= 0) return;
      const ttc = gap / relSpeed;
      if (ttc < paramsRef.current.avoidLookaheadSec && gap > 0) {
        const avoidDir = npc.lane > 0 ? -1 : 1;
        npc.avoidX += (paramsRef.current.avoidLerp * dt) * avoidDir;
        npc.avoidX = clamp(npc.avoidX, -paramsRef.current.avoidSkillThreshold, paramsRef.current.avoidSkillThreshold);
      } else {
        npc.avoidX *= 1 - paramsRef.current.avoidRelaxLerp * dt;
      }
    };

    const crash = (npc: Npc, relSpeed: number) => {
      crashedLocal = true;
      setCrashed(true);
      setInRun(false);
      inRunRef.current = false;
      crashCooldown = 1.5;
      const scoreEarned = Math.round(state.score * 0.2 + overtakes * 2);
      setLastEarn(scoreEarned);
      setLastStats({ score: state.score, overtakes, meters });
      setMeta((m) => ({ ...m, c: m.c + scoreEarned }));
      saveMeta({ ...metaRef.current, c: metaRef.current.c + scoreEarned });
      const dirNorm = new THREE.Vector3().subVectors(player.position, npc.mesh.position).normalize();
      player.position.addScaledVector(dirNorm, 0.5);
      state.vx = dirNorm.x * 6;
      state.speed = Math.max(0, state.speed - relSpeed * (npc.same ? paramsRef.current.crashRelSpeedSame : paramsRef.current.crashImpactOncoming));
    };

    const tick = (dt: number) => {
      if (!inRunRef.current) return;
      runTime += dt;
      const mod = { ...runMod, ...glitch.mod };
      if (glitch.time > 0) setGlitch((g) => ({ ...g, time: Math.max(0, g.time - dt) }));
      if (glitch.time <= 0 && glitch.list === null && Math.random() < 0.005 && runTime > 10) {
        setGlitch((g) => ({ ...g, list: GLITCHES.pick(3) }));
        queueGlitch();
      }

      const paramsNow = applyMod(mod);
      const accel = paramsNow.baseAccel * (1 + (metaRef.current.u?.a || 0) * 0.05);
      const maxSpeed = (SPEED_STAGES[stageIdx]?.capKmh || 280) / 3.6 * (1 + (metaRef.current.u?.s || 0) * 0.03 + (mod.ms || 0));
      const brakeAccel = paramsNow.brakeAccel * (1 + (metaRef.current.u?.b || 0) * 0.05) * (mod.brk ?? 1);
      const lateralAccel = paramsNow.lateralAccel * (1 + (metaRef.current.u?.l || 0) * 0.05) * (mod.lat ?? 1) * (leanHeld ? paramsNow.leanHoldScale : 1);

      const steer = (pressed.KeyA || pressed.ArrowLeft ? -1 : 0) + (pressed.KeyD || pressed.ArrowRight ? 1 : 0) + (mod.inv ? -pointer.x * 1.5 : pointer.x * 1.5);
      state.vx += steer * lateralAccel * dt;
      state.vx -= state.vx * paramsNow.dampingX * dt;
      state.x += state.vx * dt;
      state.x = clamp(state.x, -1 - paramsNow.laneOffsetMax, 1 + paramsNow.laneOffsetMax);

      const accelInput = pressed.Space || pointer.down || pressed.KeyW || pressed.ArrowUp;
      const brakeInput = pressed.ShiftLeft || pressed.KeyS || pressed.ArrowDown;
      if (accelInput) state.speed += accel * dt;
      else state.speed -= paramsNow.autoDown * dt;
      if (brakeInput) state.speed -= brakeAccel * dt;
      state.speed = clamp(state.speed, 0, maxSpeed * paramsNow.speedScale * (mod.ms ? 1 + mod.ms : 1));
      state.z += state.speed * dt;
      meters += state.speed * dt;

      state.heat = Math.max(0, state.heat - paramsNow.comboDecay * dt);
      state.combo = 1 + state.heat * paramsNow.comboAdd;

      dividers.forEach((d) => {
        d.position.z -= state.speed * dt;
        if (d.position.z < -10) d.position.z += dividerCount * 12;
      });

      player.position.set(state.x + curveXAtS(state.z) + (mod.leanX || 0), 0.2 + (mod.leanY || 0), 0);
      player.rotation.y = (steer + (mod.leanYaw || 0)) * 0.12;


      camera.position.lerp(new THREE.Vector3(state.x + curveXAtS(state.z), 1.8, -5), paramsNow.camFollowLerp);

      const lookAheadZ = 12;
      const lookS = state.z + lookAheadZ;
      const lookPos = new THREE.Vector3(curveXAtS(lookS), 0.8, lookAheadZ);
      camera.lookAt(lookPos);
      camera.rotation.y += pointer.x * paramsNow.lookYawLimit;
      camera.rotation.x = clamp(camera.rotation.x + pointer.y * paramsNow.lookPitchLimit, -0.3, 0.3);
      camera.fov = clamp(paramsNow.fovMin + (state.speed / (maxSpeed * 1.2)) * (paramsNow.fovMax - paramsNow.fovMin), 35, 95);
      camera.updateProjectionMatrix();
      if (mod.shake) camera.position.x += Math.sin(runTime * 20) * 0.02;

      fog.density = 0.03 + (mod.fog ? 0.03 : 0);

      const hitX = paramsNow.hitboxXExtra * (mod.ghost ? 0.5 : mod.hitX || 1);
      const hitZ = paramsNow.hitboxZExtra * (mod.ghost ? 0.5 : mod.hitZ || 1);

      npcs.forEach((npc) => {
        updateNpc(npc, dt, mod);
        checkAvoid(npc, dt);
        const relSpeed = state.speed + npc.speed;
        if (!crashedLocal && checkCrash(npc, hitX, hitZ)) crash(npc, relSpeed);
        if (!npc.same && npc.z < -2 && relSpeed > 0) { overtakes += 1; state.heat += 0.15; updateGoal(); }
        if (npc.same && npc.z < -2 && relSpeed > 0) { overtakes += 1; state.heat += 0.08; updateGoal(); }
        if (npc.z < -paramsNow.avoidLookaheadDist) npc.respawn = 0;
      });

      if (crashCooldown > 0) crashCooldown -= dt;
      if (!crashedLocal) state.score += dt * state.speed * 0.5 * state.combo * (mod.score || 1);
      if (mod.slip) state.score *= 1 + Math.max(0, 0.3 - Math.abs(state.x)) * 0.02;

      if (vignette) vignette.style.opacity = `${smoothstep(paramsNow.corridorAmberSec, paramsNow.corridorRedSec, state.heat) * 0.5}`;
      updateHud();
    };

    let frame = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tick(dt);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const handleGlitchChoice = (idx: number) => chooseGlitch(idx);
    (window as any).chooseGlitch = handleGlitchChoice;

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      cancelAnimationFrame(frame);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const openModPick = () => setModPick(MODS.pick(3));
  const chooseMod = (i: number) => {
    const m = MODS.list[modPick![i]];
    const mod: ModRun = {};
    if (m.ma) mod.acc = 1 + m.ma;
    if (m.ms) mod.ms = m.ms;
    if (m.mb) mod.brk = 1 + m.mb;
    if (m.ml) mod.lat = 1 + m.ml;
    if (m.hc) mod.score = (mod.score || 1) + m.hc;
    setRunMod(mod);
    setModPick(null);
    startRunRef.current();
  };

  const buy = (k: 'a' | 'b' | 's' | 'l') => {
    const cost = upCost(metaRef.current.u[k]);
    if (metaRef.current.c < cost) return;
    const next = { ...metaRef.current, c: metaRef.current.c - cost, u: { ...metaRef.current.u, [k]: metaRef.current.u[k] + 1 } };
    setMeta(next);
    saveMeta(next);
  };

  const bankAndReturn = () => {
    setCrashed(false);
    setInRun(false);
    inRunRef.current = false;
  };

  const lean = leanHeld ? 'opacity-100' : 'opacity-50';

  return (
    <div className="h-full relative" ref={mountRef}>
      <div ref={vignetteRef} className="pointer-events-none absolute inset-0 bg-red-500/20 mix-blend-overlay opacity-0 transition-opacity"></div>
      <div className="absolute top-3 left-3 text-white space-y-1">
        <div className="text-3xl font-bold drop-shadow" ref={hudSpeedRef}>0 km/h</div>
        <div className="w-40 h-2 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-400" ref={hudSpeedBarRef}></div>
        </div>
        <div className="text-sm opacity-80">Stage <span ref={hudStageRef}>1</span> · Goal <span ref={hudGoalRef}>3</span></div>
      </div>

      <div className="absolute top-3 right-3 text-white text-right space-y-1">
        <div className="text-xl font-bold">Overtakes <span ref={hudOvertakesRef}>0</span></div>
        <div className="text-sm">Score <span ref={hudScoreRef}>0</span></div>
        <div className="text-sm">Combo <span ref={hudComboRef}>1.00×</span></div>
        <div className="w-36 h-2 bg-white/20 rounded-full overflow-hidden ml-auto">
          <div className="h-full bg-orange-400" ref={hudHeatBarRef}></div>
        </div>
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white text-xs opacity-90 bg-black/30 px-3 py-2 rounded-full flex gap-2 items-center">
        <span className={lean}>Lean (hold)</span>
        <span className="opacity-60">W/↑ accel</span>
        <span className="opacity-60">S/↓ brake</span>
      </div>

      <div className="absolute bottom-3 right-3 text-white text-xs opacity-80">
        <button onClick={() => setShowPanel((s) => !s)} className="bg-white/10 px-3 py-1 rounded hover:bg-white/20">{showPanel ? 'Hide' : 'Show'} settings</button>
      </div>

      {showPanel && (
        <div className="absolute bottom-14 right-3 w-80 max-w-[90vw] backdrop-blur-md bg-black/70 text-white rounded-2xl p-4 shadow-2xl space-y-2">
          <div className="font-semibold">Tuning (per-run)</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-xs opacity-80">Speed scale: <span className="font-mono">{params.speedScale.toFixed(2)}×</span></label>
              <input type="range" min={0.5} max={2} step={0.01} value={params.speedScale} onChange={(e) => setParams({ ...params, speedScale: parseFloat(e.target.value) })} className="w-full" />
            </div>
            <div>
              <label className="text-xs opacity-80">Accel (m/s²): <span className="font-mono">{params.baseAccel.toFixed(1)}</span></label>
              <input type="range" min={1} max={25} step={0.1} value={params.baseAccel} onChange={(e) => setParams({ ...params, baseAccel: parseFloat(e.target.value) })} className="w-full" />
            </div>
            <div>
              <label className="text-xs opacity-80">Brake (m/s²): <span className="font-mono">{params.brakeAccel.toFixed(1)}</span></label>
              <input type="range" min={2} max={60} step={0.1} value={params.brakeAccel} onChange={(e) => setParams({ ...params, brakeAccel: parseFloat(e.target.value) })} className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs opacity-80">FOV Min: <span className="font-mono">{params.fovMin.toFixed(0)}°</span></label>
                <input type="range" min={40} max={85} step={1} value={params.fovMin} onChange={(e) => setParams({ ...params, fovMin: parseFloat(e.target.value) })} className="w-full" />
              </div>
              <div>
                <label className="text-xs opacity-80">FOV Max: <span className="font-mono">{params.fovMax.toFixed(0)}°</span></label>
                <input type="range" min={params.fovMin + 1} max={95} step={1} value={params.fovMax} onChange={(e) => setParams({ ...params, fovMax: parseFloat(e.target.value) })} className="w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs opacity-80">Hitbox +W (m): <span className="font-mono">{params.hitboxXExtra.toFixed(2)}</span></label>
                <input type="range" min={0.2} max={1.5} step={0.01} value={params.hitboxXExtra} onChange={(e) => setParams({ ...params, hitboxXExtra: parseFloat(e.target.value) })} className="w-full" />
              </div>
              <div>
                <label className="text-xs opacity-80">Hitbox +L (m): <span className="font-mono">{params.hitboxZExtra.toFixed(2)}</span></label>
                <input type="range" min={0.4} max={3} step={0.01} value={params.hitboxZExtra} onChange={(e) => setParams({ ...params, hitboxZExtra: parseFloat(e.target.value) })} className="w-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {inRun && glitchPick && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="backdrop-blur-xl bg-purple-900/40 ring-1 ring-white/10 text-white p-6 rounded-2xl shadow-2xl text-center max-w-md mx-auto space-y-3">
            <div className="text-xl font-bold">⚡ Anomaly!</div>
            <div className="grid grid-cols-1 gap-2">
              {glitchPick.map((idx, i) => (
                <button key={idx} onClick={() => setTimeout(() => (window as any).chooseGlitch(i), 0)} className="px-3 py-2 rounded-xl bg-white/90 text-black font-semibold hover:bg-white">
                  {GLITCHES.list[idx].n} — <span className="opacity-80">{GLITCHES.list[idx].d}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showPanel && inRun && (
        <div className="absolute bottom-3 left-3 text-xs text-white opacity-70">Run mods active: {JSON.stringify(runMod)}</div>
      )}

      {!inRun && !crashed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="backdrop-blur-xl bg-black/60 text-white p-6 rounded-2xl shadow-2xl text-center max-w-md mx-auto space-y-3">
            <div className="text-2xl font-bold">Endless Overtake</div>
            {modPick ? (
              <>
                <div className="text-sm opacity-80">Pick a run mod</div>
                <div className="grid grid-cols-1 gap-2">
                  {modPick.map((idx, i) => (
                    <button key={idx} onClick={() => chooseMod(i)} className="px-3 py-2 rounded-xl bg-white/90 text-black font-semibold hover:bg-white">
                      {MODS.list[idx].n} — <span className="opacity-80">{MODS.list[idx].d}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm opacity-80">Start a run, then overtake to build heat &amp; score. Crash to bank credits.</div>
                <div className="font-mono text-sm">💰 Credits: {meta.c}</div>
                <div className="flex gap-2 justify-center">
                  <button onClick={openModPick} className="px-4 py-2 rounded-xl bg-white/90 text-black font-semibold hover:bg-white">Start Run</button>
                  <button onClick={() => setShowPanel((s) => !s)} className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/25">Tuning</button>
                  <button onClick={() => setModPick(MODS.pick(3))} className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/25">Mods</button>
                  <button onClick={() => setShowPanel((s) => !s)} className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/25">Garage</button>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1 items-center text-xs">
                  <div>Accel +5%/lvl (lv {meta.u.a})</div><div className="opacity-80">{upCost(meta.u.a)}$</div><button onClick={() => buy('a')} className="bg-white/90 text-black px-2 py-1 rounded">Buy</button>
                  <div>Brake +5%/lvl (lv {meta.u.b})</div><div className="opacity-80">{upCost(meta.u.b)}$</div><button onClick={() => buy('b')} className="bg-white/90 text-black px-2 py-1 rounded">Buy</button>
                  <div>MaxSpeed +3%/lvl (lv {meta.u.s})</div><div className="opacity-80">{upCost(meta.u.s)}$</div><button onClick={() => buy('s')} className="bg-white/90 text-black px-2 py-1 rounded">Buy</button>
                  <div>Lateral +5%/lvl (lv {meta.u.l})</div><div className="opacity-80">{upCost(meta.u.l)}$</div><button onClick={() => buy('l')} className="bg-white/90 text-black px-2 py-1 rounded">Buy</button>
                </div>
                <div className="text-[11px] opacity-70">Upgrades are permanent. Apply on next run.</div>
              </>
            )}
          </div>
        </div>
      )}

      {crashed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="backdrop-blur-xl bg-black/60 text-white p-6 rounded-2xl shadow-2xl text-center max-w-sm mx-auto space-y-2">
            <div className="text-3xl font-bold">Run Over</div>
            <div className="text-sm opacity-90">Score {lastStats.score.toFixed(0)} · Overtakes {lastStats.overtakes} · Meters {lastStats.meters.toFixed(0)}</div>
            <div className="text-lg">💰 Earned: <span className="font-bold">{lastEarn}</span></div>
            <div className="flex gap-2 justify-center mt-2">
              <button onClick={() => { bankAndReturn(); openModPick(); }} className="px-4 py-2 rounded-xl bg-white/90 text-black font-semibold hover:bg-white">Bank &amp; New Run</button>
              <button onClick={bankAndReturn} className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/25">Bank &amp; Menu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RacingGame;
