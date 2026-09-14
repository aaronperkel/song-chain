import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/lib/rules'
import {
  ARTIST_COOLDOWN_MAX,
  EDITABLE_SETTINGS,
  SETTING_SPECS,
  SettingsPatchSchema,
  TURN_TIMER_MAX_SECONDS,
} from './settings-schema'

/**
 * This schema is the only thing standing between a crafted request and a room
 * whose rules the engine cannot evaluate, and the only thing keeping the
 * settings screen's buttons in step with what the server will accept.
 */
describe('SettingsPatchSchema', () => {
  it('accepts a single setting, since that is what one tap sends', () => {
    const parsed = SettingsPatchSchema.safeParse({ stopwords: 'allow' })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toEqual({ stopwords: 'allow' })
  })

  it('accepts several at once', () => {
    const parsed = SettingsPatchSchema.safeParse({
      matchScope: 'titleAndArtist',
      wordReuse: 'burnOnce',
      turnTimer: 60,
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects an empty patch rather than broadcasting a no-op to every phone', () => {
    expect(SettingsPatchSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a value outside the union', () => {
    expect(SettingsPatchSchema.safeParse({ wordReuse: 'whatever' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ matchScope: 'artist' }).success).toBe(false)
  })

  it('rejects allowRepeatSongs, which the rules engine pins off', () => {
    // Not editable, so a patch naming it is dropped rather than honoured. If
    // it were ever passed through it would violate the engine's own type.
    const parsed = SettingsPatchSchema.safeParse({
      stopwords: 'allow',
      allowRepeatSongs: true,
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toEqual({ stopwords: 'allow' })
  })

  it('rejects a negative or fractional cooldown', () => {
    expect(SettingsPatchSchema.safeParse({ artistCooldown: -1 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ artistCooldown: 1.5 }).success).toBe(false)
  })

  it('bounds the cooldown, so a room cannot be made unplayable', () => {
    expect(SettingsPatchSchema.safeParse({ artistCooldown: ARTIST_COOLDOWN_MAX }).success).toBe(
      true,
    )
    expect(
      SettingsPatchSchema.safeParse({ artistCooldown: ARTIST_COOLDOWN_MAX + 1 }).success,
    ).toBe(false)
  })

  it('bounds the turn timer and allows 0 for off', () => {
    expect(SettingsPatchSchema.safeParse({ turnTimer: 0 }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ turnTimer: TURN_TIMER_MAX_SECONDS }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ turnTimer: TURN_TIMER_MAX_SECONDS + 1 }).success).toBe(
      false,
    )
    expect(SettingsPatchSchema.safeParse({ turnTimer: -30 }).success).toBe(false)
  })
})

describe('the settings screen and the schema agree', () => {
  it('offers a control for every editable setting, and no others', () => {
    expect(SETTING_SPECS.map((spec) => spec.key)).toEqual([...EDITABLE_SETTINGS])
  })

  it('does not offer allowRepeatSongs, which cannot be changed', () => {
    expect(SETTING_SPECS.some((spec) => String(spec.key) === 'allowRepeatSongs')).toBe(false)
  })

  it('every choice the screen offers is one the server accepts', () => {
    // The failure this prevents is a button that silently does nothing.
    for (const spec of SETTING_SPECS) {
      for (const choice of spec.choices) {
        const parsed = SettingsPatchSchema.safeParse({ [spec.key]: choice.value })
        expect(parsed.success, `${spec.key}=${String(choice.value)}`).toBe(true)
      }
    }
  })

  it('offers the current default for every setting, so nothing starts unselectable', () => {
    // Without this a room would open on a value no button is highlighting,
    // and the screen would look broken before anyone touched it.
    for (const spec of SETTING_SPECS) {
      const current = DEFAULT_SETTINGS[spec.key]
      expect(
        spec.choices.some((choice) => choice.value === current),
        `${spec.key} default ${String(current)} has no button`,
      ).toBe(true)
    }
  })

  it('gives every choice a distinct value and a label', () => {
    for (const spec of SETTING_SPECS) {
      const values = spec.choices.map((choice) => String(choice.value))
      expect(new Set(values).size, spec.key).toBe(values.length)
      for (const choice of spec.choices) {
        expect(choice.label.length, `${spec.key} label`).toBeGreaterThan(0)
      }
    }
  })
})
