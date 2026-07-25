'use client'

import { useState } from 'react'
import { Phone, MessageSquare, BellRing } from 'lucide-react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { CALL_OUTCOMES, MESSAGE_CHANNELS } from '@/lib/lead-stages'

export interface LeadActivity {
  id: string
  type: string
  title: string
  description: string | null
  status: string
  scheduledFor?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export type ActivityKind = 'call' | 'message' | 'reminder'

const inputClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

const KIND_META: Record<
  ActivityKind,
  { label: string; verb: string; icon: typeof Phone; empty: string }
> = {
  call: { label: 'Call', verb: 'Log a Call', icon: Phone, empty: 'No calls logged yet.' },
  message: {
    label: 'Message',
    verb: 'Log a Message',
    icon: MessageSquare,
    empty: 'No messages logged yet.',
  },
  reminder: {
    label: 'Reminder',
    verb: 'Log a Reminder',
    icon: BellRing,
    empty: 'No reminders set yet.',
  },
}

// One tab body for Call Logs / Messages / Reminders: a compact quick-log form
// plus the chronological list of that activity kind for the lead.
export function LeadActivityTab({
  leadId,
  kind,
  activities,
  onChanged,
  canCreate = true,
}: {
  leadId: string
  kind: ActivityKind
  activities: LeadActivity[]
  onChanged: () => void
  canCreate?: boolean
}) {
  const { toast } = useToast()
  const meta = KIND_META[kind]
  const Icon = meta.icon

  const [outcome, setOutcome] = useState('Connected')
  const [channel, setChannel] = useState<string>(MESSAGE_CHANNELS[0])
  const [duration, setDuration] = useState('')
  const [when, setWhen] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (kind === 'reminder' && !when) {
      setError('Pick a date/time for the reminder.')
      return
    }

    const metadata: Record<string, unknown> = {}
    let title = meta.label
    if (kind === 'call') {
      metadata.outcome = outcome
      if (duration) metadata.duration = Number(duration)
      title = `Call: ${outcome}`
    } else if (kind === 'message') {
      metadata.channel = channel
      title = `Message via ${channel}`
    } else {
      title = notes.trim() ? `Reminder: ${notes.trim().slice(0, 60)}` : 'Reminder'
    }

    const payload: Record<string, unknown> = {
      type: kind,
      title,
      description: notes.trim() || undefined,
      duration: kind === 'call' && duration ? Number(duration) : undefined,
      scheduledFor: kind === 'reminder' ? new Date(when).toISOString() : undefined,
      status: kind === 'reminder' ? 'pending' : 'completed',
      metadata: Object.keys(metadata).length ? metadata : undefined,
    }

    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/leads/${leadId}/activities`, payload)
      setNotes('')
      setDuration('')
      setWhen('')
      toast(`${meta.label} logged`)
      onChanged()
    } catch (err) {
      setError(toFormErrors(err, `Failed to log ${meta.label.toLowerCase()}`).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 text-primary" />
            {meta.verb}
          </div>

          <div className="flex flex-wrap gap-2">
            {kind === 'call' && (
              <>
                <select
                  aria-label="Call outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className={inputClass}
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="Duration (min)"
                  aria-label="Call duration in minutes"
                  className={`${inputClass} w-36`}
                />
              </>
            )}
            {kind === 'message' && (
              <select
                aria-label="Message channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className={inputClass}
              >
                {MESSAGE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {kind === 'reminder' && (
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                aria-label="Reminder date and time"
                className={inputClass}
              />
            )}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={
              kind === 'call'
                ? 'What was discussed? (optional)'
                : kind === 'message'
                ? 'Message content / summary (optional)'
                : 'What to follow up on…'
            }
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {meta.verb}
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground">{meta.empty}</p>
        )}
        {activities.map((a) => {
          const outcomeTag = (a.metadata?.outcome as string | undefined) ?? undefined
          const channelTag = (a.metadata?.channel as string | undefined) ?? undefined
          return (
            <div
              key={a.id}
              className="flex items-start justify-between rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  {(a.metadata as Record<string, unknown>)?.sop === 'QUOTE_SENT_FOLLOW_UP' && (
                    <Badge variant="outline" className="text-[10px]">SOP</Badge>
                  )}
                  {outcomeTag && (
                    <Badge variant={outcomeTag === 'Connected' ? 'success' : 'default'}>
                      {outcomeTag}
                    </Badge>
                  )}
                  {channelTag && <Badge variant="primary">{channelTag}</Badge>}
                  {kind === 'reminder' && a.status === 'pending' && (
                    <Badge variant="warning">scheduled</Badge>
                  )}
                </div>
                {a.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                )}
                {kind === 'reminder' && a.scheduledFor && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {formatDate(new Date(a.scheduledFor))}
                  </p>
                )}
              </div>
              <span className="whitespace-nowrap pl-3 text-xs text-muted-foreground">
                {formatDate(new Date(a.createdAt))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
