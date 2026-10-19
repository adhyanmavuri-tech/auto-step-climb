import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AirportIndex } from '../src/airports.ts'
import { LaunchTrigger } from '../src/launch-trigger.ts'
import type { Snapshot } from '../src/types.ts'

const EGLL = { icao: 'EGLL', name: 'London Heathrow Airport', lat: 51.4706, lon: -0.4619, elevFt: 83 }

/** A reading of an A330 parked at Heathrow, with anything overridden. */
function reading(over: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 0,
    title: 'A330-300 iniBuilds',
    aircraftOk: true,
    onGround: true,
    lat: EGLL.lat + 0.001,
    lon: EGLL.lon,
    altFt: 83,
    vsFpm: 0,
    mach: 0,
    gsKt: 0,
    weightKg: 200_000,
    fcuSelectedFt: 0,
    apTargetFt: 0,
    control: 'knob',
    ...over
  }
}

/** Feeds a trigger one reading a second for `seconds`, and says when it fired. */
function feed(trigger: LaunchTrigger, from: number, seconds: number, snap: Snapshot | null, connected = true): { firedAt: number[]; last: ReturnType<LaunchTrigger['update']> } {
  const firedAt: number[] = []
  let last = trigger.update(from, connected, snap)
  if (last.fire) firedAt.push(from)
  for (let s = 1; s <= seconds; s++) {
    last = trigger.update(from + s * 1000, connected, snap)
    if (last.fire) firedAt.push(from + s * 1000)
  }
  return { firedAt, last }
}

describe('launch trigger', () => {
  it('waits for the sim, then for a flight, and says which', () => {
    const t = new LaunchTrigger()
    assert.equal(t.update(0, false, null).state.phase, 'no-sim')
    assert.equal(t.update(1000, true, null).state.phase, 'no-aircraft')
    assert.equal(t.update(2000, true, reading({ title: '' })).state.phase, 'no-aircraft')
    assert.equal(t.update(3000, true, reading({ lat: 0, lon: 0 })).state.phase, 'no-aircraft', 'no position yet: still loading')
  })

  it('ignores an aircraft it does not support, however long it sits at an airport', () => {
    const t = new LaunchTrigger()
    const { firedAt, last } = feed(t, 0, 120, reading({ title: 'Cessna 172', aircraftOk: false }))
    assert.deepEqual(firedAt, [])
    assert.equal(last.state.phase, 'other-aircraft')
  })

  it('fires once, after the A330 has been at the airport for the hold time', () => {
    const t = new LaunchTrigger({ holdMs: 8_000 })
    const { firedAt, last } = feed(t, 0, 60, reading())
    assert.deepEqual(firedAt, [8_000])
    assert.equal(last.state.phase, 'launched')
  })

  it('shows "at airport" while it holds, and a short stay does not count', () => {
    const t = new LaunchTrigger({ holdMs: 8_000 })
    const { firedAt, last } = feed(t, 0, 5, reading())
    assert.deepEqual(firedAt, [])
    assert.equal(last.state.phase, 'at-airport')
  })

  it('restarts the hold when the aircraft moves off and comes back', () => {
    const t = new LaunchTrigger({ holdMs: 8_000 })
    feed(t, 0, 5, reading())
    t.update(6_000, true, reading({ gsKt: 120 })) // a take-off roll
    const { firedAt } = feed(t, 7_000, 20, reading())
    assert.deepEqual(firedAt, [15_000], 'a fresh 8 seconds from 7 s')
  })

  it('names the airport when the list knows it, and still fires at one it does not know', () => {
    const named = new LaunchTrigger({ holdMs: 1_000, airports: new AirportIndex([EGLL]) })
    const a = feed(named, 0, 3, reading())
    assert.equal(a.last.state.place?.icao, 'EGLL')
    assert.equal(a.last.state.place?.name, 'London Heathrow Airport')
    assert.ok((a.last.state.place?.nm ?? 99) < 0.2)

    const unknown = new LaunchTrigger({ holdMs: 1_000, airports: new AirportIndex([EGLL]) })
    const b = feed(unknown, 0, 3, reading({ lat: -33.9, lon: 151.2 }))
    assert.deepEqual(b.firedAt, [1_000])
    assert.equal(b.last.state.place?.icao, null)
  })

  it('does not fire for an A330 that is flying, and stays quiet through the whole flight', () => {
    const t = new LaunchTrigger({ holdMs: 1_000 })
    const { firedAt, last } = feed(t, 0, 600, reading({ onGround: false, altFt: 36000, gsKt: 480 }))
    assert.deepEqual(firedAt, [])
    assert.equal(last.state.phase, 'away')
  })

  it('fires again at the next airport, but not for the same stay', () => {
    const t = new LaunchTrigger({ holdMs: 1_000, rearmAirborneMs: 30_000 })
    assert.deepEqual(feed(t, 0, 10, reading()).firedAt, [1_000])
    // taxi about at the same airport: nothing more
    assert.deepEqual(feed(t, 11_000, 30, reading({ gsKt: 20 })).firedAt, [])
    // a flight
    feed(t, 50_000, 120, reading({ onGround: false, altFt: 30000, gsKt: 450 }))
    // and the arrival
    assert.deepEqual(feed(t, 200_000, 10, reading({ lat: 40.64, lon: -73.78 })).firedAt, [201_000])
  })

  it('does not count a bounce as a new arrival', () => {
    const t = new LaunchTrigger({ holdMs: 1_000, rearmAirborneMs: 30_000 })
    feed(t, 0, 10, reading())
    feed(t, 20_000, 5, reading({ onGround: false, altFt: 100, gsKt: 150 })) // a few seconds in the air
    assert.deepEqual(feed(t, 30_000, 10, reading()).firedAt, [])
  })

  it('arms again after the sim closes, and when the aircraft is changed and changed back', () => {
    const t = new LaunchTrigger({ holdMs: 1_000 })
    assert.equal(feed(t, 0, 5, reading()).firedAt.length, 1)
    t.update(10_000, false, null) // the sim closed
    assert.deepEqual(feed(t, 20_000, 5, reading()).firedAt, [21_000])

    feed(t, 30_000, 3, reading({ title: 'Cessna 172', aircraftOk: false }))
    assert.deepEqual(feed(t, 40_000, 5, reading()).firedAt, [41_000], 'a different aircraft in between counts as a new load')
  })

  it('arms again when the flight is reloaded in the same aircraft', () => {
    const t = new LaunchTrigger({ holdMs: 1_000 })
    assert.equal(feed(t, 0, 5, reading()).firedAt.length, 1)
    t.update(10_000, true, reading({ title: '' })) // the loading screen of "fly again"
    assert.deepEqual(feed(t, 20_000, 5, reading()).firedAt, [21_000])
  })

  it('treats a taxi speed as being at the airport and a fast roll as not', () => {
    const slow = new LaunchTrigger({ holdMs: 1_000, maxGroundSpeedKt: 60 })
    assert.equal(feed(slow, 0, 3, reading({ gsKt: 25 })).firedAt.length, 1)
    const fast = new LaunchTrigger({ holdMs: 1_000, maxGroundSpeedKt: 60 })
    assert.equal(feed(fast, 0, 30, reading({ gsKt: 90 })).firedAt.length, 0)
  })
})
