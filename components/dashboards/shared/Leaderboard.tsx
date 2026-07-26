import Link from 'next/link'

export interface LeaderboardRow {
  id: string
  name: string
  value: number
  suffix?: string
}

interface LeaderboardProps {
  title: string
  rows: LeaderboardRow[]
  hrefFor: (id: string) => string
}

export function Leaderboard({ title, rows, hrefFor }: LeaderboardProps) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {rows.map((row, i) => (
          <li key={row.id}>
            <Link href={hrefFor(row.id)} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted">
              <span className="text-foreground">
                {i + 1}. {row.name}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {row.value}
                {row.suffix ?? ''}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
