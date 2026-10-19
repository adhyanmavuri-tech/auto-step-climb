import { distanceNm, interpolate } from './geo.ts'
import type { AtcState, Command, LatLon, Snapshot } from './types.ts'

export interface FakeAircraftInit {
  route: LatLon[]
  startAlongNm: number
  altFt: number
  gsKt?: number
  weightKg?: number
}

/**
 * A stand-in for the sim: flies along a route and reacts to the engine's commands. Used by the
 * tests and by `npm run demo`, so none of it ever touches Microsoft Flight Simulator.
 */
export class FakeAircraft {
  t = 0
  title = 'A330-300 (RR)'
  aircraftOk = true
  onGround = false
  altFt: number
  vsFpm = 0
  mach = 0.82
  gsKt: number
  weightKg: number
  fcuSelectedFt: number
  apTargetFt: number
  alongNm: number
  /** Sideways offset from the route, NM (to test the off-route guard). */
  offsetNm = 0
  control: 'knob' | 'direct' | 'none' = 'knob'

  // Behaviour switches for tests.
  knobStepFt = 100
  knobInverted = false
  knobResponds = true
  /** direct control: the altitude lands this far from what was asked (0 = exact). */
  directError = 0
  pushWorks = true
  pullWorks = true
  canClimb = true
  climbRateFpm = 1500
  descentRateFpm = 1500
  canDescend = true
  /** Time acceleration: sim seconds flown per second of snapshot time. 0 = the sim is paused. */
  rate = 1
  /** A stand-in for the ATC program, for the engine tests. null = none connected. */
  atc: AtcState | null = null
  /** How it answers a request: clear it, refuse it, say nothing, or fail to ask at all. */
  atcReply: 'grant' | 'refuse' | 'silent' | 'unavailable' = 'grant'
  atcDelayMs = 3000

  readonly commands: Command[] = []
  private readonly route: LatLon[]
  private readonly cum: number[]
  private climbing = false
  private descending = false
  private atcAskedAt: number | null = null

  constructor(init: FakeAircraftInit) {
    this.route = init.route
    this.cum = [0]
    for (let i = 1; i < init.route.length; i++) {
      this.cum.push(this.cum[i - 1]! + distanceNm(init.route[i - 1]!, init.route[i]!))
    }
    this.alongNm = init.startAlongNm
    this.altFt = init.altFt
    this.gsKt = init.gsKt ?? 480
    this.weightKg = init.weightKg ?? 180_000
    this.fcuSelectedFt = init.altFt
    this.apTargetFt = init.altFt
  }

  get totalNm(): number {
    return this.cum[this.cum.length - 1]!
  }

  private position(): LatLon {
    let i = 0
    while (i < this.route.length - 2 && this.cum[i + 1]! < this.alongNm) i++
    const len = this.cum[i + 1]! - this.cum[i]!
    const f = len > 0 ? Math.min(1, Math.max(0, (this.alongNm - this.cum[i]!) / len)) : 0
    const p = interpolate(this.route[i]!, this.route[i + 1]!, f)
    return { lat: p.lat + this.offsetNm / 60, lon: p.lon }
  }

  snapshot(): Snapshot {
    const p = this.position()
    return {
      t: this.t,
      title: this.title,
      aircraftOk: this.aircraftOk,
      onGround: this.onGround,
      lat: p.lat,
      lon: p.lon,
      altFt: this.altFt,
      vsFpm: this.vsFpm,
      mach: this.mach,
      gsKt: this.gsKt,
      weightKg: this.weightKg,
      fcuSelectedFt: this.fcuSelectedFt,
      apTargetFt: this.apTargetFt,
      control: this.control,
      atc: this.atc
    }
  }

  execute(c: Command): void {
    this.commands.push(c)
    if (c.type === 'notify') return // for the person, not the aircraft
    if (c.type === 'atc-request') {
      if (this.atc?.connected) {
        this.atc.request = { altFt: c.altFt, status: 'asking', note: '' }
        this.atcAskedAt = this.t
      }
      return
    }
    if (c.type === 'atc-cancel') {
      if (this.atc) this.atc.request = null
      this.atcAskedAt = null
      return
    }
    if (c.type === 'fcu-click') {
      if (this.control !== 'knob' || !this.knobResponds) return
      this.fcuSelectedFt += c.dir * (this.knobInverted ? -1 : 1) * this.knobStepFt
      return
    }
    if (c.type === 'set-altitude') {
      if (this.control !== 'direct' || !this.knobResponds) return
      this.fcuSelectedFt = c.ft + this.directError
      return
    }
    const works = c.mode === 'managed' ? this.pushWorks : this.pullWorks
    if (!works) return
    this.apTargetFt = this.fcuSelectedFt
    this.climbing = this.fcuSelectedFt > this.altFt + 50
    this.descending = this.fcuSelectedFt < this.altFt - 50
  }

  advance(ms: number): void {
    const dt = (ms / 1000) * this.rate
    this.t += ms
    const asked = this.atc?.request
    if (this.atc && asked?.status === 'asking' && this.atcAskedAt !== null && this.atcReply !== 'silent' && this.t - this.atcAskedAt >= this.atcDelayMs) {
      const status = this.atcReply === 'grant' ? 'granted' : this.atcReply === 'refuse' ? 'refused' : 'unavailable'
      this.atc.request = { ...asked, status, note: this.atcReply }
      this.atcAskedAt = null
    }
    this.alongNm = Math.min(this.alongNm + (this.gsKt * dt) / 3600, this.totalNm)
    if (this.climbing && this.canClimb) {
      this.vsFpm = this.climbRateFpm
      this.altFt = Math.min(this.apTargetFt, this.altFt + (this.vsFpm * dt) / 60)
      if (this.altFt >= this.apTargetFt - 0.5) {
        this.altFt = this.apTargetFt
        this.climbing = false
        this.vsFpm = 0
      }
    } else if (this.descending && this.canDescend) {
      this.vsFpm = -this.descentRateFpm
      this.altFt = Math.max(this.apTargetFt, this.altFt + (this.vsFpm * dt) / 60)
      if (this.altFt <= this.apTargetFt + 0.5) {
        this.altFt = this.apTargetFt
        this.descending = false
        this.vsFpm = 0
      }
    } else {
      this.vsFpm = this.climbing ? 20 : this.descending ? -20 : 0
    }
  }
}
