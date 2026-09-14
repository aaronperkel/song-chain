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

/**
 * Turn order, as a list the host drags.
 *
 * A flat list rather than a diagram of the car: seating charts are fiddly on
 * a phone, and what actually matters is the order, which a list states
 * plainly. Pointer *and* keyboard sensors, so the order is reachable without
 * dragging at all.
 */
export function SeatOrder({
  roomId,
  seats,
  currentSeatId,
}: {
  roomId: string
  seats: readonly Seat[]
  currentSeatId: string | null
}): React.JSX.Element {
  const [order, setOrder] = useState<Seat[]>([...seats])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      }
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

  if (shown.length === 0) {
    return (
      <p className="text-paint-dim px-4 text-base">
        Nobody has joined yet. Read out the code and they will appear here.
      </p>
    )
  }

  return (
    <div className="px-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((seat) => seat.id)} strategy={verticalListSortingStrategy}>
          <ol>
            {shown.map((seat, index) => (
              <SeatRow
                key={seat.id}
                seat={seat}
                index={index}
                isCurrent={seat.id === currentSeatId}
                onRemove={() => {
                  void act({ action: 'remove', seatId: seat.id })
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void act({ action: 'shuffle' })
          }}
          className="border-dusk-line text-paint font-display rounded-lg border px-4 py-2 text-lg uppercase"
        >
          Shuffle
        </button>
      </div>

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
  onRemove,
}: {
  seat: Seat
  index: number
  isCurrent: boolean
  onRemove: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seat.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'border-dusk-line flex items-center gap-3 border-b py-1 last:border-0',
        isDragging ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="font-display text-paint-dim w-6 shrink-0 text-xl">{index + 1}</span>

      <span className="min-w-0 flex-1">
        <span className={`block truncate text-lg ${isCurrent ? 'text-sodium' : 'text-paint'}`}>
          {seat.name}
        </span>
        {isCurrent ? <span className="text-sodium block text-xs">picking now</span> : null}
      </span>

      <button
        type="button"
        onClick={onRemove}
        className="text-paint-dim px-2 text-sm"
        aria-label={`Remove ${seat.name}`}
      >
        Remove
      </button>

      {/* The drag handle is its own target, so removing someone is never a slip. */}
      <button
        type="button"
        className="text-paint-dim cursor-grab touch-none px-2 text-2xl leading-none"
        aria-label={`Move ${seat.name} in the order`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
    </li>
  )
}
