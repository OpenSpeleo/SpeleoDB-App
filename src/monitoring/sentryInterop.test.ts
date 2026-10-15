import { expect, it, vi } from 'vitest'
import * as native from '@sentry/capacitor'
import * as react from '@sentry/react'

it('sends native-bridge captures through the shared React client', async () => {
  const send = vi.fn(async () => ({}))
  native.init({
    dsn: 'https://public@example.invalid/1',
    enableNative: false,
    transport: () => ({ send, flush: async () => true }),
  }, react.init)

  try {
    await vi.waitFor(() => expect(react.getClient()).toBeDefined())
    native.captureException(new Error('bridge test'))
    await react.flush()

    expect(native.getClient()).toBe(react.getClient())
    expect(send).toHaveBeenCalledOnce()
  } finally {
    await react.close()
  }
})
