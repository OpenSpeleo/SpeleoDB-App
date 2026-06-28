import { execFileSync } from 'node:child_process'

const preferredName = process.argv[2]?.trim()
const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
  encoding: 'utf8',
})
const devicesByRuntime = JSON.parse(raw).devices
const devices = Object.entries(devicesByRuntime)
  .filter(([runtime]) => runtime.includes('iOS'))
  .flatMap(([, runtimeDevices]) => runtimeDevices)
  .filter((device) => device.isAvailable && device.name.startsWith('iPhone'))

const selected = preferredName
  ? devices.find((device) => device.name === preferredName)
  : devices[0]

if (!selected) {
  const requirement = preferredName
    ? `named ${JSON.stringify(preferredName)}`
    : 'for an available iPhone'
  throw new Error(`No iOS simulator found ${requirement}`)
}

process.stdout.write(selected.udid)
