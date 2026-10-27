import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { advanceWork } from "./WorkAnimation";
import { createOfficeCharacter } from "./OfficeCharacter";
import { actionDurations, actionNames, type CharacterAction } from "./CharacterBehavior";
import { resolveReview, reviewActions, type CharacterReview, type CharacterReviews } from "./CharacterReview";
import { createOfficeClock, dayDurationMinutes, formatOfficeTime, localClockHour, normalizeHour, sampleDaylight } from "./OfficeDaylight";
import type { TeamMember } from "./api";
import { box, createDeskModel, cylinder, deskDetails, material, type DeskRole } from "./DeskScene";

// All desks face the same direction. A 2.0 m centre aisle and 2.4 m clear
// cross-aisles keep both the physical layout and its orthographic projection open.
export const stations: { role: DeskRole; x: number; z: number }[] = [
  { role: "leader", x: -2.8, z: -5.2 },
  { role: "product", x: 2.8, z: -5.2 },
  { role: "designer", x: -2.8, z: 0 },
  { role: "frontend", x: 2.8, z: 0 },
  { role: "backend", x: -2.8, z: 5.2 },
  { role: "testing", x: 2.8, z: 5.2 },
];

function plant(scene: THREE.Scene, x: number, z: number, scale = 1) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.scale.setScalar(scale); scene.add(group);
  const ceramic = material(0xe1ded5, .8), soil = material(0x716f5e), stem = material(0x77866e);
  cylinder(group, .25, .50, [0, .26, 0], ceramic, .32);
  cylinder(group, .285, .025, [0, .51, 0], soil);
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    const h = .58 + i * .069;
    const branch = cylinder(group, .011, h, [Math.cos(angle) * .12, .52 + h / 2, Math.sin(angle) * .12], stem);
    branch.rotation.z = Math.sin(angle) * .3;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material([0x8c9d7f, 0x9caa8b, 0x798e75][i % 3], .85));
    leaf.position.set(Math.cos(angle) * .22, .62 + h, Math.sin(angle) * .22);
    leaf.scale.set(.14, .35, .055); leaf.rotation.set(.3, angle, Math.cos(angle) * .65);
    leaf.castShadow = true; group.add(leaf);
  }
}

function contactTexture() {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(53,60,55,.24)");
  gradient.addColorStop(.4, "rgba(53,60,55,.13)");
  gradient.addColorStop(1, "rgba(53,60,55,0)");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function floorMaterial() {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(256, 256);
  let seed = 17;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = 247 + (seed % 9);
    pixels.data[i] = grain; pixels.data[i + 1] = grain; pixels.data[i + 2] = grain;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(155, 155); texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ color: 0xf1f1ed, map: texture, bumpMap: texture, bumpScale: .008, roughnessMap: texture, roughness: .96 });
}

function buildOffice() {
  const scene = new THREE.Scene();
  scene.background = null;
  const floor = floorMaterial();
  // A continuous ground plane fills the viewport: no diorama slab, outlined
  // rectangle, or abrupt floor/background transition at the room perimeter.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floor);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.05; ground.receiveShadow = true;
  scene.add(ground);
  // The open space between desks defines the aisles without painted strips.
  // Low rear credenza and plants frame the room without hiding any desk.
  const cabinet = material(0xe4e4dd, .74), white = material(0xf6f5ef, .5);
  box(scene, [5.3, .68, .69], [0, .38, -8.23], cabinet, .045);
  box(scene, [5.46, .075, .78], [0, .765, -8.23], white, .03);
  for (const x of [-1.77, 0, 1.77]) {
    box(scene, [1.72, .53, .028], [x, .4, -7.87], white, .012);
    box(scene, [.22, .018, .025], [x, .58, -7.847], cabinet, .007);
  }
  // Books, a ceramic vase, and a small coffee station.
  for (let i = 0; i < 3; i++) box(scene, [.54, .075, .37], [-1.66 + i * .018, .845 + i * .075, -8.2], material([0xa5b0a3, 0xcebea8, 0xd3d3cf][i]), .01);
  cylinder(scene, .13, .33, [1.05, .97, -8.23], material(0xb5beb1), .09);
  box(scene, [.50, .58, .42], [1.98, 1.08, -8.23], material(0x949d97), .04);
  box(scene, [.36, .25, .018], [1.98, 1.11, -8.009], material(0x414c49), .015);
  cylinder(scene, .06, .09, [1.98, .858, -7.99], white);
  const clock = createOfficeClock(scene);
  plant(scene, -5.42, -7.75, 1.13); plant(scene, 5.42, -7.75, 1.13);
  const shadowTexture = contactTexture();
  const desks = stations.map((station) => {
    const desk = createDeskModel(station.role);
    desk.position.set(station.x, 0, station.z); scene.add(desk);
    for (const [z, w, h, opacity] of [[0, 4.5, 2.7, .58], [1.55, 1.8, 1.8, .76]]) {
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity, depthWrite: false, toneMapped: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.set(station.x, -.038, station.z + z); scene.add(shadow);
    }
    return { role: station.role, model: desk };
  });
  const sky = new THREE.HemisphereLight(0xf8fafb, 0xc5c3b9, .85); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff5e7, 2.7);
  sun.position.set(-8, 15, -8); sun.target.position.set(0, 0, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 13, bottom: -13, near: .5, far: 65 });
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .025;
  sun.shadow.radius = 16; sun.shadow.blurSamples = 16;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xe6efff, .45); fill.position.set(7, 10, 6); scene.add(fill);
  const screenLights = desks.map(({ model }) => {
    const glow = new THREE.PointLight(0xb2d7ff, 0, 2.6, 2);
    glow.position.set(0, 1.95, .65); model.add(glow);
    return glow;
  });
  return { scene, desks, sun, sky, fill, clock, screenLights };
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(surface);
      for (const value of Object.values(surface)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((surface) => surface.dispose());
  textures.forEach((texture) => texture.dispose());
}

export default function OfficeScene({ agents, animate = true, actionOverride = null, poseTime }: {
  agents: TeamMember[]; animate?: boolean; actionOverride?: CharacterAction | null; poseTime?: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const agentsRef = useRef(agents);
  const animationRef = useRef(true);
  const previewRef = useRef({ actionOverride, poseTime });
  const invalidateRef = useRef<() => void>(() => {});
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [clockOpen, setClockOpen] = useState(false);
  const [clockHour, setClockHour] = useState(() => localClockHour());
  const [followSystemTime, setFollowSystemTime] = useState(true);
  const [dayPlaying, setDayPlaying] = useState(false);
  const daylightRef = useRef({ hour: localClockHour(), playing: false, system: true });
  const clockControlRef = useRef<HTMLDivElement>(null);
  const [selectedRole, setSelectedRole] = useState<DeskRole | null>(null);
  const selectedRoleRef = useRef<DeskRole | null>(null);
  const [reviews, setReviews] = useState<CharacterReviews>({});
  const reviewsRef = useRef<CharacterReviews>({});
  const reviewTimesRef = useRef<Partial<Record<DeskRole, number>>>({});
  const [reviewTime, setReviewTime] = useState(0);
  const reviewCardRef = useRef<HTMLDivElement>(null);
  const reviewActionRef = useRef<HTMLButtonElement>(null);
  function editReview(role: DeskRole, value: Omit<CharacterReview, "revision"> | null) {
    const next = { ...reviewsRef.current };
    if (value) next[role] = { ...value, revision: (next[role]?.revision ?? 0) + 1 };
    else delete next[role];
    reviewsRef.current = next; setReviews(next);
    reviewTimesRef.current[role] = value?.time ?? 0; setReviewTime(value?.time ?? 0);
    invalidateRef.current();
  }
  function openReview(role: DeskRole) {
    setSelectedRole(selectedRole === role ? null : role);
    setReviewTime(reviewTimesRef.current[role] ?? 0); setClockOpen(false);
  }
  function closeReview() {
    setSelectedRole(null);
    stageRef.current?.querySelector<HTMLButtonElement>(`[data-station="${selectedRole}"]`)?.focus({ preventScroll: true });
  }
  function changeTime(hour: number) {
    daylightRef.current.hour = normalizeHour(hour); daylightRef.current.playing = false; daylightRef.current.system = false;
    setClockHour(daylightRef.current.hour); setDayPlaying(false); setFollowSystemTime(false); invalidateRef.current();
  }
  function toggleDay() {
    daylightRef.current.system = false;
    daylightRef.current.playing = !daylightRef.current.playing;
    setFollowSystemTime(false); setDayPlaying(daylightRef.current.playing); invalidateRef.current();
  }
  function useSystemTime() {
    daylightRef.current.hour = localClockHour(); daylightRef.current.playing = false; daylightRef.current.system = true;
    setClockHour(daylightRef.current.hour); setDayPlaying(false); setFollowSystemTime(true); invalidateRef.current();
  }

  useEffect(() => { agentsRef.current = agents; invalidateRef.current(); }, [agents]);
  useEffect(() => { animationRef.current = animate; invalidateRef.current(); }, [animate]);
  useEffect(() => { previewRef.current = { actionOverride, poseTime }; invalidateRef.current(); }, [actionOverride, poseTime]);
  useEffect(() => {
    const synchronize = () => {
      if (!daylightRef.current.system) return;
      daylightRef.current.hour = localClockHour();
      setClockHour(daylightRef.current.hour);
      invalidateRef.current();
    };
    const timer = window.setInterval(synchronize, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    selectedRoleRef.current = selectedRole;
    if (!selectedRole) return;
    reviewActionRef.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!reviewCardRef.current?.contains(target) && !target.closest("[data-station]")) setSelectedRole(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [selectedRole]);

  useEffect(() => {
    const mount = renderRef.current, stage = stageRef.current;
    if (!mount || !stage) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setClearColor(0xf5f5f2, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // Soft live shadows follow the simulated sun, including furniture on the
    // floor. A fixed directional bake would leave a second, stationary shadow.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    mount.appendChild(renderer.domElement);
    const { scene, desks, sun, sky, fill, clock, screenLights } = buildOffice();
    const characters = new Map(desks.map(({ role, model }) => [role, createOfficeCharacter(role, model)]));
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentMap = pmrem.fromScene(environment, .04);
    scene.environment = environmentMap.texture;
    scene.environmentIntensity = .35;
    environment.dispose(); pmrem.dispose();
    const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, .1, 80);
    // Elevated from directly behind the chairs: no perspective convergence,
    // so front/back desks retain the same size and screens remain readable.
    camera.position.set(0, 23, 19);
    camera.lookAt(0, .1, -.3);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const renderPass = new RenderPass(scene, camera);
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: .32, thickness: .5, distanceFallOff: 1, samples: 16 });
    ao.updatePdMaterial({ radius: 5, samples: 16 });
    ao.blendIntensity = .75;
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, .4, .72);
    const output = new OutputPass();
    composer.addPass(renderPass); composer.addPass(ao); composer.addPass(bloom); composer.addPass(output);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = true, contextLost = false, frameId = 0, lastPaint = 0, lastSimulation = 0, lastShadow = 0;
    let forcePaint = true, lastClockDisplay = 0;
    const workProgress = new Map(stations.map(({ role }) => [role, { elapsed: 0, editing: 0 }]));
    const reviewPlayback = new Map<DeskRole, { revision: number; time: number }>();
    let lastReviewDisplay = 0;
    let labelNight = sampleDaylight(daylightRef.current.hour).night;
    let chromeAnimating = false;
    const labelPalette = [0xf9faf6, 0xbfc2c1, 0x26364b].map(color => new THREE.Color(color));
    const inkPalette = [0x596459, 0x51575c, 0xc3cdd8].map(color => new THREE.Color(color));
    const clockPalette = [0x303b48, 0x58616d, 0xe3e9f3].map(color => new THREE.Color(color));
    const daySky = new THREE.Color(0xf8fafb), nightSky = new THREE.Color(0x91a9d2);
    const dawnSun = new THREE.Color(0xffba78), noonSun = new THREE.Color(0xfff5e7);

    function placeLabels() {
      const clockAnchor = clock.anchor.clone().project(camera);
      const clockControl = clockControlRef.current;
      if (clockControl) {
        clockControl.style.left = `${(clockAnchor.x + 1) * 50}%`;
        clockControl.style.top = `${(1 - clockAnchor.y) * 50}%`;
        const edge = clock.anchor.clone().add(new THREE.Vector3(.55, 0, 0)).project(camera);
        clockControl.style.setProperty("--clock-size", `${Math.max(30, (edge.x - clockAnchor.x) * mount!.clientWidth)}px`);
      }
      for (const station of stations) {
        const label = stage!.querySelector<HTMLElement>(`[data-station="${station.role}"]`);
        if (!label) continue;
        const anchor = new THREE.Vector3(station.x, 2.95, station.z - .52).project(camera);
        label.style.left = `${(anchor.x + 1) * 50}%`;
        label.style.top = `${(1 - anchor.y) * 50}%`;
      }
    }
    function paint(now: number) {
      frameId = 0;
      if (contextLost || document.hidden || !inView) { lastSimulation = 0; return; }
      const motion = animationRef.current && !reducedMotion.matches;
      const dayMotion = daylightRef.current.playing && motion;
      if (forcePaint || now - lastPaint >= 1000 / 30 - 1) {
        let changed = forcePaint;
        const delta = lastSimulation ? Math.min((now - lastSimulation) / 1000, .1) : 0;
        lastSimulation = now;
        if (daylightRef.current.system && (forcePaint || now - lastClockDisplay >= 1000)) {
          daylightRef.current.hour = localClockHour();
          setClockHour(daylightRef.current.hour); lastClockDisplay = now; changed = true;
        } else if (dayMotion) {
          daylightRef.current.hour = normalizeHour(daylightRef.current.hour + delta * 24 / (dayDurationMinutes * 60));
          if (now - lastClockDisplay > 200) { setClockHour(daylightRef.current.hour); lastClockDisplay = now; }
          changed = true;
        }
        const lighting = sampleDaylight(daylightRef.current.hour);
        clock.update(daylightRef.current.hour);
        sun.position.copy(lighting.sunPosition); sun.intensity = lighting.sunIntensity;
        sun.color.copy(dawnSun).lerp(noonSun, (lighting.kelvin - 2900) / 2700);
        sky.color.copy(nightSky).lerp(daySky, lighting.daylight); sky.intensity = lighting.ambientIntensity;
        fill.intensity = lighting.fillIntensity; scene.environmentIntensity = lighting.environmentIntensity;
        bloom.strength = .13 * lighting.night; bloom.enabled = lighting.night > .01;
        screenLights.forEach(light => { light.intensity = .4 * lighting.night; });
        // No day/night threshold: fade through a neutral grey before blue.
        // This UI transition also finishes when character motion is paused.
        labelNight = THREE.MathUtils.damp(labelNight, lighting.night, 1.6, delta);
        chromeAnimating = Math.abs(labelNight - lighting.night) > .001;
        if (!chromeAnimating) labelNight = lighting.night;
        const paletteColor = (palette: THREE.Color[]) => {
          const index = labelNight < .5 ? 0 : 1;
          return palette[index].clone().lerp(palette[index + 1], THREE.MathUtils.smoothstep(labelNight * 2 - index, 0, 1)).getStyle();
        };
        stage!.style.setProperty("--station-bg", `color-mix(in srgb, ${paletteColor(labelPalette)} 85%, transparent)`);
        stage!.style.setProperty("--station-ink", paletteColor(inkPalette));
        stage!.style.setProperty("--clock-ink", paletteColor(clockPalette));
        for (const desk of desks) {
          const actualState = agentsRef.current.find((agent) => agent.id === desk.role)?.status ?? "idle";
          const review = reviewsRef.current[desk.role];
          const resolved = resolveReview(desk.role, actualState === "waiting" ? "idle" : actualState, review);
          const manual = !!resolved.action && !!review;
          const state = resolved.state;
          let frameTime = previewRef.current.poseTime;
          if (manual) {
            let playback = reviewPlayback.get(desk.role);
            if (!playback || playback.revision !== review.revision) {
              playback = { revision: review.revision, time: review.time }; reviewPlayback.set(desk.role, playback);
            } else if (review.playing && motion) playback.time += delta;
            frameTime = playback.time;
            reviewTimesRef.current[desk.role] = playback.time;
            if (selectedRoleRef.current === desk.role && (forcePaint || now - lastReviewDisplay > 100)) {
              setReviewTime(playback.time); lastReviewDisplay = now;
            }
          } else reviewPlayback.delete(desk.role);
          const roleMotion = motion && (!manual || review.playing);
          const clip = characters.get(desk.role)!.update(delta, state, roleMotion, manual ? resolved.action : previewRef.current.actionOverride, frameTime, daylightRef.current.hour);
          const progress = workProgress.get(desk.role)!;
          advanceWork(progress, roleMotion && !manual ? delta : 0, state === "running", clip.input);
          const work = frameTime === undefined ? progress : { elapsed: frameTime, editing: frameTime };
          const label = stage!.querySelector<HTMLElement>(`[data-station="${desk.role}"]`);
          if (label) { label.dataset.action = clip.action; label.dataset.input = clip.input; label.dataset.reachError = characters.get(desk.role)!.group.userData.reachError.toFixed(3); label.dataset.wristAngle = characters.get(desk.role)!.group.userData.wristAngle.toFixed(1); }
          changed = motion || changed;
          for (const [screenIndex, screen] of desk.model.screens.entries()) {
            const lightScreen = screen.kind !== "code" && screen.kind !== "terminal" && screen.kind !== "metrics";
            screen.mesh.material.color.setScalar(lightScreen ? 1 - lighting.night * .55 : 1 + lighting.night * .05);
            changed = screen.update(work.elapsed, state, roleMotion, { role: desk.role, clip, screenIndex, previewTime: frameTime, work }) || changed;
          }
          if (label) { label.dataset.screenMode = desk.model.screens.map(screen => screen.mesh.userData.mode).join(","); label.dataset.editing = work.editing.toFixed(2); }
        }
        if (changed) {
          if (forcePaint || now - lastShadow >= 1000 / 15) { renderer.shadowMap.needsUpdate = true; lastShadow = now; }
          composer.render();
        }
        lastPaint = now; forcePaint = false;
      }
      if (motion || chromeAnimating) frameId = requestAnimationFrame(paint);
    }
    function invalidate() {
      forcePaint = true;
      // Status refreshes must not discard elapsed time in an active loop.
      // Reset only when waking a stopped loop (pause, hidden, or offscreen).
      if (!frameId) { lastSimulation = 0; frameId = requestAnimationFrame(paint); }
    }
    function resize() {
      const width = mount!.clientWidth, height = mount!.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      // Fit both axes, including the floor edge and plants. Narrow
      // windows gain vertical space instead of cropping the outer stations.
      const halfHeight = Math.max(7.65, 6.85 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      placeLabels(); invalidate();
    }
    function onContextLost(event: Event) { event.preventDefault(); contextLost = true; setUnavailable(true); }
    function onContextRestored() { setGeneration((value) => value + 1); }
    const observer = new ResizeObserver(resize); observer.observe(mount);
    const intersection = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (inView) invalidate(); }); intersection.observe(mount);
    document.addEventListener("visibilitychange", invalidate);
    reducedMotion.addEventListener("change", invalidate);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    invalidateRef.current = invalidate;
    resize();
    return () => {
      cancelAnimationFrame(frameId); observer.disconnect(); intersection.disconnect();
      document.removeEventListener("visibilitychange", invalidate);
      reducedMotion.removeEventListener("change", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      invalidateRef.current = () => {};
      disposeScene(scene); sun.shadow.dispose(); environmentMap.dispose();
      ao.dispose(); ao.gtaoMaterial.dispose(); ao.blendMaterial.dispose();
      bloom.dispose(); output.dispose(); renderPass.dispose(); composer.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [generation]);

  return <div className={`office-scene${unavailable ? " is-unavailable" : ""}`} ref={stageRef} aria-label="后方俯视的三维办公室，两列三排角色工位，中央与横向通道保持畅通">
    <div className="office-scene-render" ref={renderRef} role="img" aria-label="Leader 宽屏、产品笔记本、美工绘图板、前端双屏、后端三屏、测试多设备工位" />
    {!unavailable && stations.map(({ role }) => {
      const actualState = agents.find((agent) => agent.id === role)?.status ?? "idle";
      const status = resolveReview(role, actualState === "waiting" ? "idle" : actualState, reviews[role]).state;
      return <button type="button" className={`station-label ${status}${reviews[role] ? " is-manual" : ""}`} data-station={role} key={role} title={`${deskDetails[role].label} · 点击选择动作`} aria-label={`${deskDetails[role].name}，选择动作`} aria-expanded={selectedRole === role} onClick={() => openReview(role)}>
        <span>{deskDetails[role].name}</span><i aria-label={status === "running" ? "工作中" : status === "failed" ? "需要关注" : actualState === "waiting" ? "等待消息" : "待命"} />{reviews[role] ? <small>手动</small> : actualState === "waiting" && <small>等待消息</small>}
      </button>;
    })}
    {!unavailable && selectedRole && <div className={`character-review${stations.find(station => station.role === selectedRole)!.x > 0 ? " is-left" : ""}`} ref={reviewCardRef} role="dialog" aria-label={`${deskDetails[selectedRole].name}动作验收`} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeReview(); } }}>
      <div className="character-review-heading"><div><strong>{deskDetails[selectedRole].name}</strong><span>动作验收</span></div><button aria-label="关闭动作卡片" onClick={closeReview}>×</button></div>
      <button ref={reviewActionRef} className="character-review-auto" aria-pressed={!reviews[selectedRole]} onClick={() => editReview(selectedRole, null)}>跟随真实状态</button>
      <div className="character-review-actions">{reviewActions(selectedRole).map(action => <button key={action} aria-pressed={reviews[selectedRole]?.action === action} onClick={() => editReview(selectedRole, { action, playing: true, time: 0 })}>{action === "gaming" ? "打游戏" : actionNames[action]}</button>)}</div>
      {reviews[selectedRole] && <>
        <div className="character-review-playback">
          <button onClick={() => { const review = reviews[selectedRole]!; editReview(selectedRole, { ...review, playing: !review.playing, time: reviewTimesRef.current[selectedRole] ?? 0 }); }}>{reviews[selectedRole]!.playing ? "暂停动作" : "播放动作"}</button>
          <button onClick={() => editReview(selectedRole, { ...reviews[selectedRole]!, playing: true, time: 0 })}>从头播放</button>
        </div>
        <label className="character-review-timeline">动作进度 <output aria-live="off">{(reviewTime % actionDurations[reviews[selectedRole]!.action]).toFixed(1)} / {actionDurations[reviews[selectedRole]!.action]} 秒</output>
          <input aria-label="动作进度" type="range" min="0" max={actionDurations[reviews[selectedRole]!.action] - .01} step="0.01" value={reviewTime % actionDurations[reviews[selectedRole]!.action]} onChange={event => editReview(selectedRole, { ...reviews[selectedRole]!, playing: false, time: Number(event.target.value) })} />
        </label>
      </>}
      <p>{reviews[selectedRole] ? reviews[selectedRole]!.playing ? "当前动作循环播放 · 拖动进度可定格" : "已暂停 · 拖动进度检查动作细节" : "根据真实状态与时间自然切换动作"}</p>
    </div>}
    {!unavailable && <div className="office-clock-control" ref={clockControlRef} onKeyDown={(event) => { if (event.key === "Escape") { setClockOpen(false); clockControlRef.current?.querySelector("button")?.focus(); } }}>
      <button className="office-clock-hit" aria-label={`${followSystemTime ? "系统" : "模拟"}时钟 ${formatOfficeTime(clockHour)}，调整光线`} aria-expanded={clockOpen} onClick={() => setClockOpen(!clockOpen)} title="点击时钟，调整一天的光线"><span>{formatOfficeTime(clockHour)}</span></button>
      {clockOpen && <div className="office-clock-popover" role="group" aria-label="时间与光照">
        <div className="office-clock-heading"><label htmlFor="office-time">{followSystemTime ? "系统时间" : "模拟时间"}</label><button aria-label="关闭时钟设置" onClick={() => setClockOpen(false)}>×</button></div>
        <button className="office-clock-system" aria-pressed={followSystemTime} onClick={useSystemTime}>{followSystemTime ? "✓ 正在跟随系统时间" : "跟随系统时间"}</button>
        <input id="office-time" aria-label="模拟时间" type="time" value={formatOfficeTime(clockHour)} onChange={(event) => { if (event.target.value) { const [h, m] = event.target.value.split(":").map(Number); changeTime(h + m / 60); } }} />
        <input aria-label="一天的时间" type="range" min="0" max="1439" step="1" value={Math.floor(normalizeHour(clockHour) * 60)} onChange={(event) => changeTime(Number(event.target.value) / 60)} />
        <div className="office-clock-presets">{[[6.5, "清晨"], [12, "正午"], [17.5, "傍晚"], [22, "夜晚"]].map(([hour, label]) => <button key={hour} onClick={() => changeTime(Number(hour))}>{label}</button>)}</div>
        <button className="office-day-play" aria-pressed={dayPlaying} onClick={toggleDay}>{dayPlaying ? "暂停时间" : "播放一天"}</button>
        <small>{followSystemTime ? "钟表与场景光线会随电脑时间自动变化" : `${dayDurationMinutes} 分钟走过一天 · 拖动可定格`}</small>
      </div>}
    </div>}
    {unavailable && <div className="scene-fallback" role="status"><strong>暂时无法显示 3D 办公室</strong><p>请重试以恢复画面，团队对话仍可正常使用。</p><button onClick={() => setGeneration((value) => value + 1)}>重新加载场景</button><ul>{stations.map(({ role }) => <li key={role}>{deskDetails[role].name} · {deskDetails[role].label}</li>)}</ul></div>}
  </div>;
}
