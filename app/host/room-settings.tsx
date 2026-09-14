'use client'

import { useState } from 'react'
import type { RuleSettings } from '@/lib/rules'
import {
  SETTING_SPECS,
  type EditableSetting,
  type SettingSpec,
} from '@/lib/rooms/settings-schema'

/**
 * The house rules, changeable mid-game by the host.
 *
 * Each tap applies immediately. There is no save button because a car is a bad
 * place to remember to press one, and a half-applied rule set nobody committed
 * is worse than no settings screen at all.
 *
 * Changes affect later picks only. The copy says so, because the first thing
 * anyone will wonder is whether tightening a rule just invalidated the song
 * they got away with ten minutes ago.
 */
export function RoomSettings({
  roomId,
  settings,
  onApplied,
}: {
  roomId: string
  settings: RuleSettings
  /** Re-read the room, so the change lands in the state everyone renders from. */
  onApplied?: () => void
}): React.JSX.Element {
  // The value we asked for, held until the room state catches up, so tapping a
  // choice does not visibly bounce back before the response lands.
  const [pending, setPending] = useState<Partial<Record<EditableSetting, string | number>>>({})
  const [error, setError] = useState<string | null>(null)

  const change = async (key: EditableSetting, value: string | number): Promise<void> => {
    setPending((current) => ({ ...current, [key]: value }))
    setError(null)

    try {
      const response = await fetch(`/api/rooms/${roomId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })

      if (!response.ok) {
        revert(key)
        const detail: unknown = await response.json().catch(() => null)
        setError(
          typeof detail === 'object' && detail !== null && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : 'That rule did not change.',
        )
        return
      }

      // Leave the optimistic value in place: it now matches the server, so
      // clearing it here would flash the old value until the refresh lands.
      onApplied?.()
    } catch {
      revert(key)
      setError('No signal. That rule did not change.')
    }
  }

  const revert = (key: EditableSetting): void => {
    setPending((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  return (
    <div className="px-4">
      <p className="text-paint-dim text-sm leading-snug">
        Changes apply to the next pick onwards. Nothing already in the chain is re-judged.
      </p>

      {error !== null ? (
        <p className="text-brake mt-3 text-base" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 space-y-6">
        {SETTING_SPECS.map((spec) => (
          <li key={spec.key}>
            <SettingRow
              spec={spec}
              current={pending[spec.key] ?? settings[spec.key]}
              onChoose={(value) => {
                void change(spec.key, value)
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function SettingRow({
  spec,
  current,
  onChoose,
}: {
  spec: SettingSpec
  current: string | number
  onChoose: (value: string | number) => void
}): React.JSX.Element {
  const labelId = `setting-${spec.key}`

  return (
    <div>
      <p id={labelId} className="text-paint text-lg leading-tight font-medium">
        {spec.title}
      </p>
      <p className="text-paint-dim mt-0.5 text-sm leading-snug">{spec.hint}</p>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="mt-2 flex flex-wrap gap-2"
      >
        {spec.choices.map((choice) => {
          const selected = choice.value === current
          return (
            <button
              key={String(choice.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (!selected) onChoose(choice.value)
              }}
              className={[
                // 44px minimum, because this is used one-handed in a moving car.
                'min-h-[44px] rounded-lg border px-3 py-2 text-base',
                selected
                  ? 'border-sodium bg-sodium text-dusk font-medium'
                  : 'border-dusk-line text-paint-dim',
              ].join(' ')}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
