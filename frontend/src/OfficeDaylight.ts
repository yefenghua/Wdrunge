import * as THREE from "three";
import { box, cylinder, material } from "./DeskScene";

export const dayDurationMinutes = 15;
export const normalizeHour = (hour: number) => ((hour % 24) + 24) % 24;
export function localClockHour(value = new Date()) {
  return value.getHours() + value.getMinutes() / 60 + value.getSeconds() / 3600 + value.getMilliseconds() / 3_600_000;
}
export function formatOfficeTime(hour: number) {
  const minutes = Math.floor(normalizeHour(hour) * 60 + 1e-6) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** An art-directed 24-hour cycle, not a location-dependent solar ephemeris. */
export function sampleDaylight(hour: number) {
  const phase = (normalizeHour(hour) - 6) / 12 * Math.PI;
  const elevation = Math.sin(phase);
  const daylight = THREE.MathUtils.smoothstep(elevation, -.13, .28);
  const height = Math.max(0, elevation);
  return {
    daylight,
    night: 1 - daylight,
    sunIntensity: 2.7 * Math.pow(height, .6),
    // Warm sunrise/sunset, neutral midday. Night is lit by cool ambient light.
    kelvin: THREE.MathUtils.lerp(2900, 5600, Math.sqrt(height)),
    sunPosition: new THREE.Vector3(-Math.cos(phase) * 17, 2 + height * 18, -8),
    ambientIntensity: THREE.MathUtils.lerp(.20, .85, daylight),
    environmentIntensity: THREE.MathUtils.lerp(.065, .35, daylight),
    fillIntensity: THREE.MathUtils.lerp(.13, .45, daylight),
  };
}

export function createOfficeClock(scene: THREE.Scene) {
  const clock = new THREE.Group(); clock.name = "simulation-clock";
  clock.position.set(0, 1.30, -8.16); clock.rotation.x = -.26;
  scene.add(clock);
  const rim = material(0x7e8c85, .52, .15);
  const dial = material(0xfaf6e8, .85);
  const ink = material(0x43514b, .65);
  const shell = cylinder(clock, .48, .12, [0, 0, 0], rim);
  shell.rotation.x = Math.PI / 2;
  const face = cylinder(clock, .425, .018, [0, 0, .068], dial);
  face.rotation.x = Math.PI / 2;
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6;
    const tick = box(clock, [.022, index % 3 === 0 ? .070 : .042, .009], [Math.sin(angle) * .358, Math.cos(angle) * .358, .086], ink, .004);
    tick.rotation.z = -angle;
  }
  const hourHand = new THREE.Group(), minuteHand = new THREE.Group();
  clock.add(hourHand, minuteHand);
  box(hourHand, [.034, .22, .012], [0, .085, .105], ink, .009);
  box(minuteHand, [.021, .32, .010], [0, .135, .124], ink, .006);
  const pin = cylinder(clock, .033, .028, [0, 0, .14], rim); pin.rotation.x = Math.PI / 2;
  box(clock, [.42, .075, .27], [0, -.47, -.02], rim, .025);
  return {
    anchor: clock.position.clone(),
    update(hour: number) {
      hourHand.rotation.z = -normalizeHour(hour) / 12 * Math.PI * 2;
      minuteHand.rotation.z = -(hour % 1) * Math.PI * 2;
    },
  };
}
