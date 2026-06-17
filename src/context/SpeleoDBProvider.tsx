import type { ReactNode } from 'react'

import { SpeleoDBStoreProvider } from './SpeleoDBStoreProvider'
import { SpeleoDBStartupGate } from './SpeleoDBStartupGate'

interface SpeleoDBProviderProps {
  children: ReactNode
}

export function SpeleoDBProvider({ children }: SpeleoDBProviderProps) {
  return (
    <SpeleoDBStoreProvider>
      <SpeleoDBStartupGate />
      {children}
    </SpeleoDBStoreProvider>
  )
}
