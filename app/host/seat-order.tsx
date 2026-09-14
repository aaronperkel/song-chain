'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import type { Seat } from '@/lib/rooms/seats'

/** Matches the check on `seats.name`; see lib/rooms/seats.ts. */
const MAX_NAME_LENGTH = 24

/** Which "add a player" form is open, if any. */
type Adding = 'me' | 'no-phone'

/**
 * Turn order, as a list the host drags.
 *
 * A flat list rather than a diagram of the car: seating charts are fiddly on
 * a phone, and what actually matters is the order, which a list states
 * plainly. Pointer *and* keyboard sensors, so the order is reachable without
 * dragging at all.
 *
 * It is also where the two people who cannot join by scanning a QR code get
 * in: the host, whose phone is busy hosting, and the driver, whose phone is
 * not in their hands.
 */
export function SeatOrder({
  roomId,
  seats,
  currentSeatId,
  youSeatId,
  onChanged,
}: {
  roomId: string
  seats: readonly Seat[]
  currentSeatId: string | null
  /** The seat this phone holds, if the host is playing as well as hosting. */
  youSeatId: string | null
  /**
   * Called after any change lands. Seats arrive over realtime by themselves;
   * this exists because taking a seat also changes who *this* phone is, which
   * only a re-read of the room can tell it.
   */
  onChanged: () => void
}): React.JSX.Element {
  const [order, setOrder] = useState<Seat[]>([...seats])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [name, setName] = useState('')

  // Follow the server unless the host is mid-drag.
  const shown = busy ? order : [...seats]

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A car moves; a touch should not become a drag by accident.
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const act = async (body: unknown, optimistic?: Seat[]): Promise<void> => {
    if (optimistic !== undefined) setOrder(optimistic)
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/rooms/${roomId}/seats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail: unknown = await response.json()
        setError(
          typeof detail === 'object' && detail !== null && 'message' in detail
            ? String((detail as { message: unknown }).message)
            : 'Could not change the order.',
        )
        return
      }
      onChanged()
    } catch {
      setError('No signal. The order was not saved.')
    } finally {
      setBusy(false)
    }
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over === null || active.id === over.id) return

    const from = shown.findIndex((seat) => seat.id === active.id)
    const to = shown.findIndex((seat) => seat.id === over.id)
    if (from < 0 || to < 0) return

    const moved = arrayMove(shown, from, to)
    void act({ action: 'reorder', seatIds: moved.map((seat) => seat.id) }, moved)
  }

  const addPlayer = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    void act({ action: 'add', name: trimmed, hasPhone: adding === 'me' })
    setName('')
    setAdding(null)
  }

  return (
    <div className="px-4">
      {shown.length === 0 ? (
        <p className="text-paint-dim text-base">
          Nobody has joined yet. Read out the code and they will appear here.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={shown.map((seat) => seat.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol>
              {shown.map((seat, index) => (
                <SeatRow
                  key={seat.id}
                  seat={seat}
                  index={index}
                  isCurrent={seat.id === currentSeatId}
                  isYou={seat.id === youSeatId}
                  onRemove={() => {
                    void act({ action: 'remove', seatId: seat.id })
                  }}
                  onTogglePhone={() => {
                    void act({ action: 'set-phone', seatId: seat.id, hasPhone: !seat.hasPhone })
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {adding === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
            Hosting is not the same as sitting the game out. The host is
            usually a passenger with both hands free, and this phone can
            search as well as any other.
          */}
          {youSeatId === null ? (
            <button
              type="button"
              onClick={() => {
                setAdding('me')
              }}
              className="border-dusk-line text-paint font-display min-h-[44px] rounded-lg border px-4 py-2 text-lg uppercase"
            >
              Play too
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setAdding('no-phone')
            }}
            className="border-dusk-line text-paint font-display min-h-[44px] rounded-lg border px-4 py-2 text-lg uppercase"
          >
            Add a driver
          </button>

          {shown.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                void act({ action: 'shuffle' })
              }}
              className="border-dusk-line text-paint font-display min-h-[44px] rounded-lg border px-4 py-2 text-lg uppercase"
            >
              Shuffle
            </button>
          ) : null}
        </div>
      ) : (
        <form onSubmit={addPlayer} className="mt-3">
          <label htmlFor="new-seat-name" className="text-paint-dim block pb-1 text-sm">
            {adding === 'me'
              ? 'Your name. You will take turns from this phone.'
              : 'Playing without a phone — the driver, or anyone whose phone is away. When their turn comes, whoever is quickest types what they say.'}
          </label>
          <div className="flex gap-2">
            <input
              id="new-seat-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              autoFocus
              placeholder={adding === 'me' ? 'Your name' : 'Their name'}
              className="border-dusk-line bg-dusk-raised text-paint min-h-[44px] min-w-0 flex-1 rounded-lg border px-3 py-2 text-lg"
            />
            <button
              type="submit"
              disabled={name.trim().length === 0}
              className="bg-sodium text-dusk font-display min-h-[44px] rounded-lg px-4 py-2 text-lg uppercase disabled:opacity-40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(null)
                setName('')
              }}
              className="text-paint-dim min-h-[44px] px-2 text-base"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error !== null ? (
        <p className="text-brake mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SeatRow({
  seat,
  index,
  isCurrent,
  isYou,
  onRemove,
  onTogglePhone,
}: {
  seat: Seat
  index: number
  isCurrent: boolean
  isYou: boolean
  onRemove: () => void
  onTogglePhone: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seat.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'border-dusk-line border-b py-1 last:border-0',
        isDragging ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span className="font-display text-paint-dim w-6 shrink-0 text-xl">{index + 1}</span>

        <span className="min-w-0 flex-1">
          <span className={`block truncate text-lg ${isCurrent ? 'text-sodium' : 'text-paint'}`}>
            {seat.name}
            {isYou ? <span className="text-paint-dim text-sm"> (you)</span> : null}
          </span>
          <span className="block text-xs">
            {isCurrent ? <span className="text-sodium">picking now</span> : null}
            {isCurrent && !seat.hasPhone ? <span className="text-paint-dim"> · </span> : null}
            {!seat.hasPhone ? (
              <span className="text-paint-dim">no phone — anyone picks for them</span>
            ) : null}
          </span>
        </span>

        {/* The drag handle is its own target, so removing someone is never a slip. */}
        <button
          type="button"
          className="text-paint-dim min-h-[44px] cursor-grab touch-none px-2 text-2xl leading-none"
          aria-label={`Move ${seat.name} in the order`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      </div>

      {/*
        On their own line rather than crowded against the drag handle: three
        small targets in a row, in a moving car, next to a destructive one is
        how somebody gets removed by accident.
      */}
      <div className="flex gap-1 pl-9">
        <button
          type="button"
          onClick={onTogglePhone}
          className="text-paint-dim min-h-[44px] px-2 text-sm"
          aria-label={
            seat.hasPhone
              ? `Let anyone pick for ${seat.name}`
              : `${seat.name} picks on their own phone again`
          }
        >
          {seat.hasPhone ? 'No phone' : 'Has a phone'}
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="text-paint-dim min-h-[44px] px-2 text-sm"
          aria-label={`Remove ${seat.name}`}
        >
          Remove
        </button>
      </div>
    </li>
  )
}
