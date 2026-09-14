import { HostLab } from './host-lab'

export const metadata = { title: 'host lab — song chain' }

export default async function HostLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<React.JSX.Element> {
  const params = await searchParams
  const first = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null)

  return (
    <main>
      <HostLab authOutcome={first(params.auth)} authDetail={first(params.detail)} />
    </main>
  )
}
