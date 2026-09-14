import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, withDefaults } from './settings'

describe('settings', () => {
  it('defaults match the house rules in the brief', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      matchScope: 'title',
      artistCooldown: 1,
      stopwords: 'ignore',
      looseForms: 'on',
      numerals: 'strict',
      wordReuse: 'free',
      allowRepeatSongs: false,
      turnTimer: 0,
    })
  })

  it('fills gaps in a partial settings row', () => {
    expect(withDefaults({ wordReuse: 'burnOnce' })).toEqual({
      ...DEFAULT_SETTINGS,
      wordReuse: 'burnOnce',
    })
    expect(withDefaults()).toEqual(DEFAULT_SETTINGS)
  })

  it('never lets repeat songs be enabled', () => {
    expect(withDefaults({ allowRepeatSongs: false }).allowRepeatSongs).toBe(false)
  })
})
