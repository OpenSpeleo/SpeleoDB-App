import type { ReactNode } from 'react'

import { SpeleoDBStoreProvider } from './SpeleoDBStoreProvider'
import { SpeleoDBStartupUi } from './SpeleoDBStartupUi'

interface SpeleoDBProviderProps {
  children: ReactNode
}

export function SpeleoDBProvider({ children }: SpeleoDBProviderProps) {
  return (
    <SpeleoDBStoreProvider>
      <SpeleoDBStartupUi />
      {children}
    </SpeleoDBStoreProvider>
  )
}
