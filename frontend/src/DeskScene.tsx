import * as THREE from "three";
import { memberName } from "./TeamIdentity";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createScreenSurface, type ScreenKind, type ScreenSurface } from "./ScreenSurface";

export type DeskRole = "leader" | "product" | "backend" | "designer" | "frontend" | "testing";
type Surface = THREE.MeshStandardMaterial;
type Parent = THREE.Group | THREE.Scene;
type Vec3 = [number, number, number];
export type DeskModel = THREE.Group & {
  screens: ScreenSurface[];
  interaction: {
    keyboard: THREE.Vector3;
    mouse: THREE.Mesh | null;
    mouseHome: THREE.Vector3;
    cup: THREE.Group;
    cupHome: THREE.Vector3;
    cupHomeRotation: THREE.Quaternion;
    pen: THREE.Mesh | null;
    penHome: THREE.Vector3;
    penRotation: THREE.Quaternion;
  };
};
export const deskDetails: Record<DeskRole, { name: string; label: string; accent: string }> = {
  leader: { name: memberName("leader"), label: "Ultrawide dashboard · team coordination", accent: "#839b90" },
  product: { name: memberName("product"), label: "Laptop · requirements handbook · sticky notes", accent: "#b6a082" },
  backend: { name: memberName("backend"), label: "Triple monitors · code, terminal, and service monitoring", accent: "#8397ad" },
  designer: { name: memberName("designer"), label: "Large drawing tablet · stylus · color swatches", accent: "#ac9bbb" },
  frontend: { name: memberName("frontend"), label: "Dual monitors · code and page preview", accent: "#86a89e" },
  testing: { name: memberName("testing"), label: "Test monitor · phone, tablet, and checklist", accent: "#b2a57e" },
};

export function material(color: THREE.ColorRepresentation, roughness = .65, metalness = 0): Surface {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function box(parent: Parent, size: Vec3, at: Vec3, surface: Surface, radius = .025) {
  const mesh = new THREE.Mesh(radius ? new RoundedBoxGeometry(...size, 3, Math.min(radius, Math.min(...size) / 2)) : new THREE.BoxGeometry(...size), surface);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function cylinder(parent: Parent, radius: number, height: number, at: Vec3, surface: Surface, topRadius = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, radius, height, 24), surface);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function bar(parent: Parent, from: Vec3, to: Vec3, radius: number, surface: Surface) {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const mesh = cylinder(parent, radius, start.distanceTo(end), [0, 0, 0], surface);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return mesh;
}

type Palette = { white: Surface; frame: Surface; dark: Surface; metal: Surface; accent: Surface; paper: Surface };

function display(parent: Parent, desk: DeskModel, w: number, h: number, kind: ScreenKind, accent: string, palette: Palette) {
  box(parent, [w, h, .065], [0, 0, 0], palette.dark, .035);
  // Independent front-facing plane, above the bezel: no coplanar faces / z fighting.
  const screen = createScreenSurface(w - .07, h - .07, kind, accent);
  screen.mesh.position.z = .034;
  parent.add(screen.mesh);
  desk.screens.push(screen);
  return screen;
}

function monitor(desk: DeskModel, x: number, width: number, kind: ScreenKind, palette: Palette, accent: string, angle = 0) {
  const group = new THREE.Group();
  group.position.set(x, 2.01, -.35);
  group.rotation.y = angle;
  group.rotation.x = -.06;
  desk.add(group);
  display(group, desk, width, .78, kind, accent, palette);
  box(group, [width - .08, .70, .04], [0, 0, -.048], palette.frame, .04);
  box(group, [.075, .34, .07], [0, -.51, -.026], palette.metal);
  box(group, [.44, .035, .30], [0, -.68, .045], palette.frame);
}

function keyboard(parent: DeskModel, palette: Palette, x = 0, z = .39) {
  parent.interaction.keyboard.set(x, 1.435, z);
  box(parent, [.97, .035, .34], [x, 1.375, z], palette.frame, .025);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 11; col++) {
    box(parent, [.067, .01, .048], [x - .417 + col * .083, 1.399, z - .123 + row * .076], palette.white, .008);
  }
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), palette.white);
  mouse.scale.set(.10, .047, .16); mouse.position.set(x + .72, 1.4, z); mouse.castShadow = true; parent.add(mouse);
  parent.interaction.mouse = mouse; parent.interaction.mouseHome.copy(mouse.position);
}

function paper(parent: Parent, x: number, z: number, palette: Palette) {
  const group = new THREE.Group(); group.position.set(x, 1.369, z); group.rotation.y = -.12; parent.add(group);
  box(group, [.43, .018, .54], [0, 0, 0], palette.paper, .008);
  for (let i = 0; i < 5; i++) box(group, [i === 0 ? .21 : .29, .002, .012], [-.025, .011, -.17 + i * .064], i === 0 ? palette.accent : palette.frame, 0);
}

function mug(parent: DeskModel, palette: Palette, x = 1.00, z = .62) {
  cylinder(parent, .145, .018, [x, 1.369, z], palette.accent);
  const cup = parent.interaction.cup;
  cup.name = "drinking-cup"; cup.position.set(x, 1.38, z); parent.add(cup);
  parent.interaction.cupHome.copy(cup.position);
  cup.rotation.y = -.9; parent.interaction.cupHomeRotation.copy(cup.quaternion);
  cylinder(cup, .093, .21, [0, .10, 0], palette.white, .104);
  cylinder(cup, .083, .004, [0, .207, 0], material(0x66554b));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.069, .021, 10, 24), palette.white);
  // Face the handle toward the seated person instead of outward to the side.
  handle.position.set(0, .11, .112); handle.rotation.y = Math.PI / 2;
  handle.castShadow = true; cup.add(handle);
}

function mobileDevice(desk: DeskModel, x: number, z: number, palette: Palette, accent: string, tablet = false) {
  const group = new THREE.Group(); group.position.set(x, 1.56, z); group.rotation.x = -Math.PI / 3; desk.add(group);
  display(group, desk, tablet ? .49 : .25, tablet ? .64 : .43, "checks", accent, palette);
  box(desk, [tablet ? .37 : .18, .035, .28], [x, 1.376, z + .02], palette.frame);
}

function chair(desk: DeskModel, palette: Palette, executive: boolean) {
  const chairGroup = new THREE.Group();
  chairGroup.position.set(0, 0, 1.48); chairGroup.rotation.y = executive ? -.09 : .07; desk.add(chairGroup);
  const fabric = material(executive ? 0x737c79 : 0xb6bab6, .96);
  const shell = material(executive ? 0x747d78 : 0xdaded7, .58);
  box(chairGroup, [.79, .14, .73], [0, .64, 0], shell, .07);
  box(chairGroup, [.72, .105, .65], [0, .72, -.015], fabric, .05);
  const back = box(chairGroup, [.82, executive ? .93 : .79, .12], [0, 1.16, .36], shell, .07); back.rotation.x = -.12;
  const cushion = box(chairGroup, [.71, executive ? .82 : .68, .065], [0, 1.18, .284], fabric, .032); cushion.rotation.x = -.12;
  // A subtle seam on the rear shell and a visible lumbar support.
  box(chairGroup, [.50, .027, .017], [0, 1.08, .435], palette.frame, .006);
  for (const x of [-.47, .47]) {
    bar(chairGroup, [x, .66, .18], [x, 1.0, .12], .025, palette.frame);
    box(chairGroup, [.10, .055, .42], [x, 1.025, .02], shell, .025);
  }
  cylinder(chairGroup, .055, .40, [0, .39, 0], palette.metal);
  cylinder(chairGroup, .085, .12, [0, .18, 0], palette.frame);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5 + .3;
    const x = Math.cos(angle) * .49, z = Math.sin(angle) * .49;
    bar(chairGroup, [0, .19, 0], [x, .105, z], .028, palette.metal);
    const caster = cylinder(chairGroup, .062, .08, [x, .065, z], palette.dark);
    caster.rotation.z = Math.PI / 2;
  }
}

export function createDeskModel(role: DeskRole): DeskModel {
  const desk = new THREE.Group() as DeskModel;
  desk.name = `desk:${role}`;
  desk.screens = [];
  desk.interaction = {
    keyboard: new THREE.Vector3(-.19, 1.44, .14), mouse: null, mouseHome: new THREE.Vector3(-.19, 1.415, .61),
    cup: new THREE.Group(), cupHome: new THREE.Vector3(), cupHomeRotation: new THREE.Quaternion(), pen: null, penHome: new THREE.Vector3(), penRotation: new THREE.Quaternion(),
  };
  const accent = deskDetails[role].accent;
  const palette: Palette = {
    white: material(0xf8f7f3, .48), frame: material(0xd7dcd9, .52),
    dark: material(0x303839, .42), metal: material(0xaeb9b8, .32, .65),
    accent: material(accent), paper: material(0xfffefa, .94),
  };
  box(desk, [3.6, .13, 1.62], [0, 1.28, 0], palette.white, .055);
  box(desk, [3.40, .065, 1.45], [0, 1.19, 0], palette.frame);
  for (const x of [-1.56, 1.56]) {
    for (const z of [-.58, .58]) box(desk, [.085, 1.17, .085], [x, .60, z], palette.frame, .018);
    box(desk, [.09, .08, 1.3], [x, .10, 0], palette.frame);
  }
  box(desk, [2.99, .1, .09], [0, 1.03, -.58], palette.frame);
  box(desk, [.53, .75, .68], [1.13, .79, -.14], palette.frame, .035);
  for (const y of [.57, .92]) {
    box(desk, [.49, .31, .04], [1.13, y, .22], palette.white, .018);
    box(desk, [.16, .018, .027], [1.13, y + .065, .25], palette.metal, .006);
  }
  // Muted desk mats distinguish roles without turning the room into a dashboard.
  box(desk, [2.1, .009, .61], [-.15, 1.35, .35], material(role === "designer" ? 0xe8e1ec : 0xe8ebe7, .96), .05);

  if (role === "designer") {
    const tablet = new THREE.Group(); tablet.name = "drawing-tablet";
    tablet.position.set(-.16, 1.77, -.08); tablet.rotation.x = -1.03; desk.add(tablet);
    display(tablet, desk, 1.89, 1.20, "design", accent, palette);
    box(desk, [.80, .10, .53], [-.16, 1.4, -.25], palette.frame, .04);
    const pen = cylinder(desk, .019, .79, [1.02, 1.377, .20], palette.white); pen.rotation.z = Math.PI / 2; pen.rotation.y = -1.1;
    desk.interaction.pen = pen; desk.interaction.penHome.copy(pen.position); desk.interaction.penRotation.copy(pen.quaternion);
    for (let i = 0; i < 5; i++) box(desk, [.19, .018, .30], [-1.5 + i * .1, 1.37 + i * .009, .2 + i * .026], material([0xab9cbb, 0xc5b3a4, 0xe8ddcc, 0x9bad9f, 0xd5d8d3][i]), .006);
  } else if (role === "backend") {
    monitor(desk, -1.1, 1.03, "terminal", palette, accent, .14);
    monitor(desk, 0, 1.08, "code", palette, accent);
    monitor(desk, 1.1, 1.03, "metrics", palette, accent, -.14);
    keyboard(desk, palette, -.05);
    box(desk, [.39, .75, .67], [-1.08, .42, -.1], palette.dark, .035);
    for (let i = 0; i < 5; i++) box(desk, [.24, .018, .007], [-1.08, .50 + i * .044, .24], palette.frame, .002);
    box(desk, [.035, .035, .008], [-.99, .69, .241], palette.accent, .012);
  } else if (role === "frontend") {
    monitor(desk, -.67, 1.28, "code", palette, accent, .06);
    monitor(desk, .69, 1.28, "preview", palette, accent, -.06);
    keyboard(desk, palette, -.11);
  } else if (role === "leader") {
    monitor(desk, -.12, 1.94, "overview", palette, accent);
    keyboard(desk, palette, -.12);
    box(desk, [.39, .055, .53], [-1.36, 1.379, .21], palette.accent, .018);
    bar(desk, [-1.49, 1.415, .03], [-1.28, 1.415, .35], .013, palette.metal);
  } else if (role === "product") {
    box(desk, [1.38, .04, .90], [-.19, 1.372, .34], palette.frame);
    const lid = new THREE.Group(); lid.position.set(-.19, 1.83, -.15); lid.rotation.x = -.17; desk.add(lid);
    display(lid, desk, 1.39, .89, "roadmap", accent, palette);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 10; col++) box(desk, [.086, .005, .068], [-.68 + col * .11, 1.397, .02 + row * .105], palette.dark, .005);
    box(desk, [.40, .005, .22], [-.19, 1.398, .61], palette.white, .016);
    paper(desk, -1.3, .25, palette);
    for (let i = 0; i < 3; i++) box(desk, [.27, .013, .27], [.88 + (i % 2) * .33, 1.36 + i * .008, -.22 + Math.floor(i / 2) * .34], material([0xded4b8, 0xc3d1c7, 0xd4c8d9][i]), .01);
  } else {
    monitor(desk, -.36, 1.39, "checks", palette, accent);
    keyboard(desk, palette, -.39);
    mobileDevice(desk, .82, -.1, palette, accent);
    mobileDevice(desk, 1.29, -.2, palette, accent, true);
    paper(desk, -1.4, .18, palette);
  }
  mug(desk, palette);
  chair(desk, palette, role === "leader");
  return desk;
}
