import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BeyondAtcLink, judgeReply, labelToFeet, parseActions, parseMessage } from '../src/beyondatc.ts'
import { FakeBeyondAtc } from '../src/fake-beyondatc.ts'

async function waitFor(cond: () => boolean, ms = 1500): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function makeLink(fake: FakeBeyondAtc) {
  const log: string[] = []
  let created = 0
  const link = new BeyondAtcLink({
    url: 'ws://test',
    log: (level, text) => log.push(`${level} ${text}`),
    createSocket: (url) => {
      created++
      return fake.createSocket(url)
    },
    menuWaitMs: 150,
    levelsWaitMs: 150,
    grantWaitMs: 150,
    reconnectMs: 30
  })
  return { link, log, created: () => created }
}

async function connected(fake: FakeBeyondAtc) {
  const made = makeLink(fake)
  made.link.enable(true)
  await waitFor(() => made.link.state.connected)
  await new Promise((r) => setTimeout(r, 20)) // the first Actions list arrives just after opening
  return made
}

describe('BeyondATC messages', () => {
  it('splits Prefix: payload and tells the log sources apart', () => {
    assert.deepEqual(parseMessage('ATC: roger, new cruise altitude FL360\r\n'), { kind: 'log', source: 'atc', text: 'roger, new cruise altitude FL360' })
    assert.deepEqual(parseMessage('ATCTraffic: Swiss 3PH, contact radar'), { kind: 'log', source: 'atcTraffic', text: 'Swiss 3PH, contact radar' })
    assert.deepEqual(parseMessage('Player: request FL360'), { kind: 'log', source: 'player', text: 'request FL360' })
    assert.deepEqual(parseMessage('CPDLC_ATC: CLIMB TO FL360'), { kind: 'log', source: 'cpdlcAtc', text: 'CLIMB TO FL360' })
    assert.deepEqual(parseMessage('AutoRespond: true'), { kind: 'autoRespond', value: true })
    assert.deepEqual(parseMessage('AutoTune: false'), { kind: 'autoTune', value: false })
    assert.deepEqual(parseMessage('Pong:'), { kind: 'other', prefix: 'Pong' })
    assert.deepEqual(parseMessage('Settings: {"a":1}'), { kind: 'other', prefix: 'Settings' })
    assert.equal(parseMessage(''), null)
  })

  it('reads an Actions list, with the old comma form as a fallback', () => {
    assert.deepEqual(parseActions('[Cancel Altitude Change¬FL320¬FL340¬Say Again¬]'), ['Cancel Altitude Change', 'FL320', 'FL340', 'Say Again'])
    assert.deepEqual(parseActions('[Request Altitude Change, Request Direct]'), ['Request Altitude Change', 'Request Direct'])
    assert.deepEqual(parseActions('[]'), [])
    assert.deepEqual(parseMessage('Actions: [A¬B¬]'), { kind: 'actions', items: ['A', 'B'] })
  })

  it('reads levels in flight levels, metres and feet', () => {
    assert.equal(labelToFeet('FL360'), 36000)
    assert.equal(labelToFeet('fl 360'), 36000)
    assert.equal(labelToFeet('11,300m'), 37073)
    assert.equal(labelToFeet('12,200 m'), 40026)
    assert.equal(labelToFeet('36,000 ft'), 36000)
    assert.equal(labelToFeet('Say Again'), null)
    assert.equal(labelToFeet('Cancel Altitude Change'), null)
  })

  it("tells a clearance from a refusal from small talk, for the level that was asked for", () => {
    assert.equal(judgeReply('roger, new cruise altitude FL360', 36000), 'granted')
    assert.equal(judgeReply('Swiss 3PH, climb and maintain FL360', 36000), 'granted')
    assert.equal(judgeReply('roger, new cruise altitude 12,200m', 40100), 'granted', 'FL401 is 12,200 m')
    assert.equal(judgeReply('unable FL360, maintain present level', 36000), 'refused')
    assert.equal(judgeReply('negative, traffic at FL360', 36000), 'refused')
    assert.equal(judgeReply('descend and maintain FL340', 36000), null, 'a different level is not our clearance')
    assert.equal(judgeReply('contact Munich Radar on 132.100', 36000), null)
  })
})

describe('BeyondATC link', () => {
  it('asks for a level and reports the clearance', async () => {
    const fake = new FakeBeyondAtc()
    const { link } = await connected(fake)
    assert.equal(link.autoRespond, true)

    link.request(36000)
    assert.equal(link.state.request?.status, 'asking')
    await waitFor(() => link.state.request?.status === 'granted')
    assert.deepEqual(fake.received, ['set_action: Request Altitude Change', 'set_action: FL360'])
    assert.equal(link.state.request?.altFt, 36000)
    assert.match(link.state.request!.note, /new cruise altitude FL360/)
    link.enable(false)
  })

  it('reports a refusal', async () => {
    const fake = new FakeBeyondAtc()
    fake.reply = 'refuse'
    const { link } = await connected(fake)
    link.request(36000)
    await waitFor(() => link.state.request?.status === 'refused')
    assert.match(link.state.request!.note, /unable/)
    link.enable(false)
  })

  it('is refused when ATC does not offer the level, and closes the menu', async () => {
    const fake = new FakeBeyondAtc({ levels: ['FL320', 'FL340'] })
    const { link } = await connected(fake)
    link.request(36000)
    await waitFor(() => link.state.request?.status === 'refused')
    assert.match(link.state.request!.note, /does not offer FL360/)
    await waitFor(() => fake.received.includes('set_action: Cancel Altitude Change'))
    link.enable(false)
  })

  it('is unavailable when the request is not on offer', async () => {
    const fake = new FakeBeyondAtc()
    fake.offered = false
    const { link } = await connected(fake)
    link.request(36000)
    await waitFor(() => link.state.request?.status === 'unavailable')
    assert.match(link.state.request!.note, /not on offer/)
    assert.deepEqual(fake.received, [], 'nothing was sent')
    link.enable(false)
  })

  it('treats silence from ATC as a refusal', async () => {
    const fake = new FakeBeyondAtc()
    fake.reply = 'silent'
    const { link } = await connected(fake)
    link.request(36000)
    await waitFor(() => link.state.request?.status === 'refused')
    assert.match(link.state.request!.note, /no answer/)
    link.enable(false)
  })

  it('chooses a metric level for a level in feet', async () => {
    const fake = new FakeBeyondAtc({ levels: ['11,900m', '12,200m'] })
    const { link } = await connected(fake)
    link.request(40100)
    await waitFor(() => link.state.request?.status === 'granted')
    assert.ok(fake.received.includes('set_action: 12,200m'))
    link.enable(false)
  })

  it('is unavailable when it is not connected', () => {
    const fake = new FakeBeyondAtc()
    const { link } = makeLink(fake)
    link.request(36000)
    assert.equal(link.state.request?.status, 'unavailable')
    assert.match(link.state.request!.note, /not connected/)
  })

  it('contacts nothing until it is switched on, and stops when it is switched off', async () => {
    const fake = new FakeBeyondAtc()
    const { link, created } = makeLink(fake)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(created(), 0)
    link.enable(true)
    await waitFor(() => link.state.connected)
    assert.equal(created(), 1)
    link.enable(false)
    assert.equal(link.state.connected, false)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(created(), 1, 'no reconnecting once it is off')
  })

  it('reconnects after the connection drops', async () => {
    const fake = new FakeBeyondAtc()
    const { link } = await connected(fake)
    fake.drop()
    await waitFor(() => !link.state.connected)
    await waitFor(() => link.state.connected)
    link.enable(false)
  })

  it('reports a dropped connection as the request being unavailable', async () => {
    const fake = new FakeBeyondAtc()
    fake.reply = 'silent'
    const { link } = await connected(fake)
    link.request(36000)
    await waitFor(() => fake.received.includes('set_action: FL360'))
    fake.drop()
    await waitFor(() => link.state.request?.status === 'unavailable')
    assert.match(link.state.request!.note, /lost the connection/)
    link.enable(false)
  })

  // On the first real flight the program never saw a list of what was on offer (its WebSocket client
  // delivered blanks; see src/ws-client.ts). A link that waits for that list never asks, so it asks without one.
  describe('when no list of what is on offer has been seen', () => {
    it('asks without waiting for a list, and reports the clearance', async () => {
      const fake = new FakeBeyondAtc({ quiet: true })
      const { link } = await connected(fake)
      assert.equal(link.autoRespond, null, 'it never said')
      link.request(36000)
      assert.equal(link.state.request?.status, 'asking')
      await waitFor(() => link.state.request?.status === 'granted')
      assert.deepEqual(fake.received, ['set_action: Request Altitude Change', 'set_action: FL360'])
      link.enable(false)
    })

    it('reports a refusal and a silence the same way', async () => {
      for (const [reply, pattern] of [['refuse', /unable/], ['silent', /no answer/]] as const) {
        const fake = new FakeBeyondAtc({ quiet: true })
        fake.reply = reply
        const { link } = await connected(fake)
        link.request(36000)
        await waitFor(() => link.state.request?.status === 'refused')
        assert.match(link.state.request!.note, pattern)
        link.enable(false)
      }
    })

    it('is unavailable when BeyondATC ignores the request (nobody tuned, or not in cruise), and cancels so the controller is not left asking', async () => {
      const fake = new FakeBeyondAtc({ quiet: true })
      fake.offered = false
      const { link } = await connected(fake)
      link.request(36000)
      await waitFor(() => link.state.request?.status === 'unavailable')
      assert.match(link.state.request!.note, /level menu did not appear/)
      assert.deepEqual(fake.received, ['set_action: Request Altitude Change', 'set_action: Cancel Altitude Change'], 'it asked once, then cancelled')
      link.enable(false)
    })

    it('asks again from the start next time, not from the old menu', async () => {
      const fake = new FakeBeyondAtc({ quiet: true })
      fake.reply = 'silent'
      const { link } = await connected(fake)
      link.request(36000)
      await waitFor(() => link.state.request?.status === 'refused')
      link.request(36000)
      await waitFor(() => fake.received.filter((f) => f === 'set_action: FL360').length === 2)
      assert.deepEqual(
        fake.received.filter((f) => !/^set_action: Cancel/.test(f)),
        ['set_action: Request Altitude Change', 'set_action: FL360', 'set_action: Request Altitude Change', 'set_action: FL360']
      )
      link.enable(false)
    })

    it('cancels the request when ATC never answers the level, so the controller is not left waiting', async () => {
      const fake = new FakeBeyondAtc({ quiet: true })
      fake.reply = 'silent'
      const { link } = await connected(fake)
      link.request(36000)
      await waitFor(() => link.state.request?.status === 'refused')
      assert.deepEqual(fake.received, ['set_action: Request Altitude Change', 'set_action: FL360', 'set_action: Cancel Altitude Change'])
      link.enable(false)
    })

    it('still waits when BeyondATC has listed what is on offer and the request is not on the list', async () => {
      const fake = new FakeBeyondAtc()
      fake.offered = false // it sends "Actions: []"
      const { link } = await connected(fake)
      link.request(36000)
      await new Promise((r) => setTimeout(r, 60))
      assert.deepEqual(fake.received, [], 'nothing is sent while it is not on offer')
      assert.equal(link.state.request?.status, 'asking')
      assert.match(link.state.request!.note, /on offer/)
      link.enable(false)
    })
  })

  it('forgets a request when it is cancelled', async () => {
    const fake = new FakeBeyondAtc()
    fake.offered = false
    const { link } = await connected(fake)
    link.request(36000)
    link.cancel()
    assert.equal(link.state.request, null)
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(link.state.request, null, 'the timeout of the cancelled request does not bring it back')
    link.enable(false)
  })
})
