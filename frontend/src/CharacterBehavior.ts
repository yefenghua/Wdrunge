import type { DeskRole } from "./DeskScene";
import type { ScreenState } from "./ScreenSurface";

export type CharacterAction = "rest" | "typing" | "mouse" | "drawing" | "sleeping" | "phone" | "drinking" | "stretching" | "gaming";
export type InputMode = "keyboard" | "mouse" | "pen" | "keyboard-mouse" | "none";
export interface ActionSample { action: CharacterAction; time: number; duration: number; input: InputMode }
export const actionNames: Record<CharacterAction, string> = {
  rest: "Rest", typing: "Type", mouse: "Pointer", drawing: "Draw", sleeping: "Sleep",
  phone: "Use phone", drinking: "Drink", stretching: "Stretch", gaming: "Game (Backend / Testing)",
};
export const actionDurations: Record<CharacterAction, number> = {
  rest: 7, typing: 10, mouse: 6, drawing: 16, sleeping: 15, phone: 10, drinking: 7, stretching: 7, gaming: 12,
};
export function easeAction(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/** Rest → operate → release → rest, with zero velocity at both ends. */
export function actionEnvelope(time: number, duration: number, enter = 1, leave = 1.4) {
  return easeAction(time / enter) * easeAction((duration - time) / leave);
}
export function canPlayAction(role: DeskRole, state: ScreenState, action: CharacterAction) {
  if (state === "failed") return action === "rest";
  if (action === "gaming") return state === "idle" && (role === "backend" || role === "testing");
  if (state === "idle") return ["rest", "sleeping", "phone", "drinking", "stretching", "gaming"].includes(action);
  if (action === "sleeping" || action === "phone") return false;
  if (action === "drawing") return role === "designer";
  if (action === "typing" || action === "mouse") return role !== "designer";
  return true;
}
export function actionSample(action: CharacterAction, time: number, duration = actionDurations[action]): ActionSample {
  const input: InputMode = action === "typing" ? "keyboard" : action === "mouse" ? "mouse"
    : action === "drawing" ? "pen" : action === "gaming" ? "keyboard-mouse" : "none";
  return { action, time, duration, input };
}
/** Deterministic single-clip sampling for manual review and scrubbing only. */
export function sampleAction(role: DeskRole, state: ScreenState, elapsed: number, override: CharacterAction | null = null): ActionSample {
  const fallback = state === "running" ? role === "designer" ? "drawing" : "typing" : "rest";
  const action = override && canPlayAction(role, state, override) ? override : fallback;
  return actionSample(action, Math.max(0, elapsed) % actionDurations[action]);
}

type Choice = readonly [CharacterAction, number];
export function actionWeights(role: DeskRole, state: ScreenState, hour = 10): readonly Choice[] {
  if (state === "failed") return [["rest", 100]];
  if (state === "running") return role === "designer" ? [["drawing", 92], ["stretching", 5], ["drinking", 3]]
    : [["typing", 65], ["mouse", 27], ["stretching", 5], ["drinking", 3]];
  const gamer = role === "backend" || role === "testing";
  if (!isSleepTime(hour)) return [["rest", gamer ? 60 : 64], ["phone", 14], ["sleeping", 6], ["stretching", 9], ["drinking", 7], ...(gamer ? [["gaming", 4] as const] : [])];
  return [["rest", gamer ? 68 : 71], ["phone", 12], ["sleeping", 8], ["stretching", 5], ["drinking", 4], ...(gamer ? [["gaming", 3] as const] : [])];
}
const hourOfDay = (hour: number) => ((hour % 24) + 24) % 24;
export const isSleepTime = (hour: number) => hourOfDay(hour) >= 22 || hourOfDay(hour) < 8;

/** One persistent scheduler per person; random choices happen only at boundaries. */
export function createCharacterBehavior(role: DeskRole, random: () => number = Math.random) {
  let previousState: ScreenState | undefined;
  let previousHour: number | undefined;
  let action: CharacterAction = "rest", time = 0, duration = 7;
  let restStreak = 0;
  let asleep = false, morning: "rise" | "stretch" | null = null;
  function start(next: CharacterAction) {
    action = next; time = 0;
    restStreak = previousState === "idle" && next === "rest" ? restStreak + 1 : 0;
    // Awake idle has short pauses; work and nighttime stay calmer. Prop choreography retains
    // its authored duration so cup placement and wake-up phases stay intact.
    duration = next === "rest" ? previousState === "idle" && !isSleepTime(previousHour ?? 10) ? 4 + random() * 3 : 18 + random() * 14
      : next === "typing" || next === "drawing" ? 18 + random() * 14
      : next === "mouse" ? 7 + random() * 5 : actionDurations[next];
  }
  function choose(state: ScreenState) {
    // Prevent unlucky repeated draws from leaving an awake person still for
    // minutes. Keep weighted randomness among the remaining eligible actions.
    const choices = actionWeights(role, state, previousHour).filter(([next]) =>
      !(state === "idle" && !isSleepTime(previousHour ?? 10) && restStreak >= 2 && next === "rest"));
    let value = random() * choices.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [next, weight] of choices) {
      if (value < weight) { start(next); return; }
      value -= weight;
    }
    start("rest");
  }
  function reset() { restStreak = 0; previousState = undefined; previousHour = undefined; asleep = false; morning = null; }
  function update(delta: number, state: ScreenState, hour = 10): ActionSample {
    const currentHour = hourOfDay(hour);
    const advance = previousHour === undefined ? 0 : hourOfDay(currentHour - previousHour);
    const toMorning = previousHour === undefined ? 0 : hourOfDay(8 - previousHour);
    const crossedMorning = advance > 0 && toMorning > 0 && toMorning <= advance;
    previousHour = currentHour;
    if (state !== previousState) {
      previousState = state; restStreak = 0; asleep = false; morning = null;
      // Actual work starts at a tool, never with a drink. Idle starts quietly.
      start(state === "running" ? role === "designer" ? "drawing" : random() < 65 / 92 ? "typing" : "mouse" : "rest");
    }
    if (state === "failed") return actionSample("rest", 0);
    if (state === "idle" && asleep && (!isSleepTime(hour) || crossedMorning)) {
      asleep = false; morning = "rise";
      time = duration - 1.2; // Play the sleep release before lifting the arms.
    }
    if (state === "idle" && action === "sleeping" && !morning && isSleepTime(hour)) asleep = true;
    time += Math.max(0, delta);
    if (asleep) {
      // Hold the settled sleeping pose; breathing uses the independent rig clock.
      time = Math.min(time, duration / 2);
    } else if (time >= duration) {
      if (morning === "rise") { start("stretching"); morning = "stretch"; }
      else if (morning === "stretch") { start("rest"); morning = null; }
      else choose(state);
    }
    return actionSample(action, time, duration);
  }
  return { update, reset };
}
