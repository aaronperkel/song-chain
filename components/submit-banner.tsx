'use client'

import type { useSubmit } from '@/lib/player/use-submit'

/**
 * What just happened to your pick.
 *
 * Shared by the host's screen and a passenger's, because the host plays too
 * and a pick from either phone can be accepted, rejected, or left hanging by
 * a tunnel. One component means one answer to "did that go through".
 */
export function SubmitBanner({
  state,
  onDismiss,
  onOverride,
}: {
  state: ReturnType<typeof useSubmit>['state']
  onDismiss: () => void
  /** Host-only. Absent for players, who cannot override a rejection. */
  onOverride?: () => void
}): React.JSX.Element | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'sending':
      return (
        <Banner tone="quiet">
          <span>Adding {state.title}</span>
        </Banner>
      )
    case 'queued-offline':
      return (
        <Banner tone="warn">
          <strong className="block text-lg">No signal</strong>
          <span>
            {state.title} is waiting to send. It will go through by itself — keep this screen open.
          </span>
        </Banner>
      )
    case 'done':
      return (
        <Banner tone="good" onDismiss={onDismiss}>
          <strong className="block text-lg">Added {state.entry.track.title}</strong>
          {state.warning !== null ? <span>{state.warning}</span> : null}
        </Banner>
      )
    case 'rejected':
      return (
        <Banner tone="bad" onDismiss={onDismiss}>
          <strong className="block text-lg">{state.title} does not link</strong>
          {state.explanation.blockers?.map((blocker) => (
            <span key={blocker.kind} className="block">
              {blocker.why}
            </span>
          ))}
          {state.explanation.blockers === undefined
            ? state.explanation.sharedWords
                .filter((word) => !word.accepted)
                .map((word) => (
                  <span key={word.word} className="block">
                    {word.why}
                  </span>
                ))
            : null}
          {state.explanation.sharedWords.length === 0 &&
          state.explanation.blockers === undefined ? (
            <span>It shares no word with the last song.</span>
          ) : null}
          {onOverride !== undefined ? (
            <button
              type="button"
              onClick={onOverride}
              // 44px minimum: used one-handed, in a car, to settle an argument.
              className="border-paint text-paint mt-3 min-h-[44px] rounded-lg border px-4 py-2 text-base"
            >
              Allow it anyway
            </button>
          ) : null}
        </Banner>
      )
    case 'error':
      return (
        <Banner tone="bad" onDismiss={onDismiss}>
          <span>{state.message}</span>
        </Banner>
      )
  }
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'quiet' | 'good' | 'bad' | 'warn'
  children: React.ReactNode
  onDismiss?: () => void
}): React.JSX.Element {
  const border = {
    quiet: 'border-dusk-line',
    good: 'border-verge',
    bad: 'border-brake',
    warn: 'border-sodium',
  }[tone]

  return (
    <div
      className={`bg-dusk-raised mx-4 mb-4 flex items-start gap-3 rounded-lg border ${border} px-4 py-3`}
      role="status"
    >
      <div className="text-paint-dim flex-1 text-sm leading-snug">{children}</div>
      {onDismiss !== undefined ? (
        <button type="button" onClick={onDismiss} className="text-paint-dim -my-2 px-2 text-base">
          Close
        </button>
      ) : null}
    </div>
  )
}
