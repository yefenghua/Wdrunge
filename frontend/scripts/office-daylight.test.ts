import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOfficeClock, formatOfficeTime, localClockHour, normalizeHour, sampleDaylight } from '../src/OfficeDaylight';

test('daylight changes intensity, color temperature and direction across a day', () => {
  const dawn = sampleDaylight(6.5), noon = sampleDaylight(12), dusk = sampleDaylight(17.5), night = sampleDaylight(22);
  assert.ok(noon.sunIntensity > dawn.sunIntensity && noon.sunIntensity > dusk.sunIntensity);
  assert.ok(noon.kelvin > dawn.kelvin && noon.kelvin > dusk.kelvin);
  assert.ok(dawn.sunPosition.x < 0 && dusk.sunPosition.x > 0);
  assert.ok(noon.sunPosition.y > dawn.sunPosition.y && noon.sunPosition.y > dusk.sunPosition.y);
  assert.equal(night.sunIntensity, 0);
  assert.equal(night.night, 1);
  assert.equal(noon.night, 0);
  assert.ok(night.ambientIntensity < noon.ambientIntensity);
});

test('lighting stays continuous through dawn, dusk and midnight', () => {
  let previous = sampleDaylight(0);
  for (let minute = 1; minute <= 1441; minute++) {
    const current = sampleDaylight(minute / 60);
    assert.ok(current.sunPosition.distanceTo(previous.sunPosition) < .13);
    for (const property of ['daylight', 'night', 'sunIntensity', 'ambientIntensity', 'environmentIntensity', 'fillIntensity'] as const) {
      assert.ok(Number.isFinite(current[property]) && current[property] >= 0);
      assert.ok(Math.abs(current[property] - previous[property]) < .11, `${property} jumps at minute ${minute}`);
    }
    previous = current;
  }
  assert.deepEqual(sampleDaylight(0), sampleDaylight(24));
});

test('simulated time wraps at midnight and formats minute boundaries correctly', () => {
  assert.equal(normalizeHour(24.5), .5);
  assert.equal(formatOfficeTime(24), '00:00');
  assert.equal(formatOfficeTime(-.5), '23:30');
  assert.equal(formatOfficeTime(6.5), '06:30');
  assert.equal(formatOfficeTime(1439 / 60), '23:59');
});

test('system clock converts local hours, minutes, seconds and milliseconds to a scene hour', () => {
  const value = new Date(2026, 9, 27, 18, 30, 45, 500);
  assert.ok(Math.abs(localClockHour(value) - (18 + 30 / 60 + 45 / 3600 + 500 / 3_600_000)) < 1e-10);
});

test('physical clock hands show the selected time without rebuilding its model', () => {
  const scene = new THREE.Scene();
  const clock = createOfficeClock(scene);
  const model = scene.getObjectByName('simulation-clock')!;
  const hands = model.children.filter(child => child instanceof THREE.Group);
  clock.update(3.5);
  assert.equal(hands.length, 2);
  assert.ok(Math.abs(hands[0].rotation.z + 3.5 / 12 * Math.PI * 2) < 1e-8);
  assert.ok(Math.abs(hands[1].rotation.z + Math.PI) < 1e-8);
  const count = model.children.length;
  clock.update(22);
  assert.equal(model.children.length, count);
});
