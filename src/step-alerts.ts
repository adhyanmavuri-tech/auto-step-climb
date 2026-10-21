import type { EngineStatus, StepState, StepStatus } from './engine.ts'

/** Something the person should be told as it happens: a notification, as well as the line in the log. */
export interface StepAlert {
  title: string
  text: string
}

const flOf = (ft: number): string => `FL${Math.round(ft / 100)}`

/** Skips that are history, not news: the aircraft was already past the step when the app looked, or you did it yourself. */
const QUIET_SKIP = /^(passed|already at or|skipped by you|stopped by you)/

/**
 * Turns what the engine does to the steps of the plan into notes for the person: a step starts, is complete, fails, is
 * held back for weight, is skipped, or (while the app only watches) was not flown. The tray icon changes colour for
 * some of this, but nobody watches it during a flight; a note is how someone at the keyboard finds out.
 *
 * It only compares what the engine says now with what it said before, so it needs nothing from the engine's inside.
 * An aircraft the app does not control has its own notes (from BeyondATC's answers), so nothing is said for it here.
 */
export class StepAlerts {
  private told = new Map<string, StepStatus>()
  private planKey = ''
  private heldFor = ''

  /** Call after every reading the engine has seen. Returns what is new since the last call, each thing once. */
  update(status: EngineStatus): StepAlert[] {
    const key = status.steps.map((x) => x.step.id).join('|')
    if (key !== this.planKey || status.askOnly) {
      // A new plan, or an aircraft with notes of its own: what is already in the list is not news.
      this.planKey = key
      this.told = new Map(status.steps.map((x) => [x.step.id, x.status]))
      this.heldFor = ''
      return []
    }
    const out: StepAlert[] = []
    for (const st of status.steps) {
      if (this.told.get(st.step.id) === st.status) continue
      this.told.set(st.step.id, st.status)
      const alert = this.alertFor(st)
      if (alert) out.push(alert)
    }
    const pending = status.steps.find((x) => x.status === 'pending')
    if (status.heldForWeight && pending) {
      if (this.heldFor !== pending.step.id) {
        this.heldFor = pending.step.id
        out.push({ title: 'Step held: the aircraft is too heavy', text: status.message })
      }
    } else {
      this.heldFor = ''
    }
    return out
  }

  private alertFor(st: StepState): StepAlert | null {
    const { step } = st
    const noun = step.toAltFt < step.fromAltFt ? 'descent' : 'climb'
    const level = flOf(step.toAltFt)
    switch (st.status) {
      case 'active':
        return { title: `Step ${noun} started`, text: `${step.label}: setting the FCU to ${level} and starting the ${noun}.` }
      case 'done':
        return { title: `Step ${noun} complete`, text: `${step.label}: the aircraft is at ${level}.` }
      case 'failed':
        if (/stopped by you/.test(st.note)) return null
        return { title: `Step ${noun} failed`, text: `${step.label}: ${st.note}. Check your aircraft.` }
      case 'dry-run':
        return { title: 'Watching only: the step was not flown', text: `${step.label}: the app would have flown it, but Live control is off. Turn it on in Settings to let it.` }
      case 'skipped':
        if (QUIET_SKIP.test(st.note)) return null
        return { title: `Step ${noun} skipped`, text: `${step.label}: ${st.note}.` }
      default:
        return null
    }
  }
}
