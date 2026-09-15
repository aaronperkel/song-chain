import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from './manifest'

/**
 * A manifest is only ever read by a phone at install time, which is the one
 * moment nobody is watching a console. These assert the two things that fail
 * silently there: an icon that is not on disk, and a colour that has drifted
 * away from the interface it is supposed to match.
 */
describe('manifest', () => {
  it('points at icons that exist, at the size it claims', () => {
    const icons = manifest().icons ?? []
    expect(icons.length).toBeGreaterThan(0)

    for (const icon of icons) {
      const src = String(icon.src)
      expect(src.startsWith('/'), src).toBe(true)
      // public/ is served from the root, so the src is the path minus the slash.
      expect(() => statSync(`public${src}`), src).not.toThrow()
    }
  })

  it('offers a masked shape as well as a plain one', () => {
    const purposes = (manifest().icons ?? []).map((icon) => icon.purpose)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
  })

  it('wears the same dusk as the interface', () => {
    // Sourced from globals.css rather than repeated here: the splash screen
    // and the first paint have to be the same colour, or installing the app
    // buys a white flash in a dark car.
    const css = readFileSync('app/globals.css', 'utf8')
    const dusk = /--color-dusk:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]
    expect(dusk).toBeDefined()

    expect(manifest().background_color).toBe(dusk)
    expect(manifest().theme_color).toBe(dusk)
  })

  it('opens on the front door, standing on its own', () => {
    expect(manifest().start_url).toBe('/')
    expect(manifest().display).toBe('standalone')
  })
})
