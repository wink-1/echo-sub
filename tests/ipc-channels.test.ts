import { describe, it, expect } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/types'

describe('IPC Channels', () => {
  it('should have all expected channels', () => {
    expect(IPC_CHANNELS.START_CAPTURE).toBe('start-capture')
    expect(IPC_CHANNELS.STOP_CAPTURE).toBe('stop-capture')
    expect(IPC_CHANNELS.TRANSLATION_UPDATE).toBe('translation-update')
    expect(IPC_CHANNELS.TRANSLATION_CORRECTION).toBe('translation-correction')
    expect(IPC_CHANNELS.UPDATE_SETTINGS).toBe('update-settings')
    expect(IPC_CHANNELS.GET_SETTINGS).toBe('get-settings')
    expect(IPC_CHANNELS.BACKEND_STATUS).toBe('backend-status')
  })
})
