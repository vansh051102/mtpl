'use client'

import { useState } from 'react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { ACTIVITY_TYPES } from '@/lib/validation'

interface Activity {
  id: string
  type: string
  title: string
  description: string | null
  status: string
  createdAt: string
}

type ActivityType = (typeof ACTIVITY_TYPES)[number]

const CALL_OUTCOMES = ['connected', 'no answer', 'busy', 'wrong number', 'callback requested'] as const

const inputClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

export function LeadActivities({
  leadId,
  activities,
  onChanged,
  showCreateForm = true,
}: {
  leadId: string
  activities: Activity[]
  onChanged: () => void
  showCreateForm?: boolean
}) {
  const { toast } = useToast()
  const [type, setType] = useState<ActivityType>('call')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Type-specific fields
  const [duration, setDuration] = useState('') // call, meeting (minutes)
  const [outcome, setOutcome] = useState('') // call
  const [emailTo, setEmailTo] = useState('') // email
  const [attendees, setAttendees] = useState('') // meeting
  const [scheduledFor, setScheduledFor] = useState('') // meeting, task

  function resetForm() {
    setTitle('')
    setDescription('')
    setDuration('')
    setOutcome('')
    setEmailTo('')
    setAttendees('')
    setScheduledFor('')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    // Assemble type-specific metadata; only include what applies.
    const metadata: Record<string, unknown> = {}
    if (type === 'call' && outcome) metadata.outcome = outcome
    if (type === 'email' && emailTo) metadata.emailTo = emailTo
    if (type === 'meeting' && attendees)
      metadata.attendees = attendees.split(',').map((s) => s.trim()).filter(Boolean)

    const isScheduled = (type === 'meeting' || type === 'task') && scheduledFor
    const payload: Record<string, unknown> = {
      type,
      title,
      description: description || undefined,
      duration: duration ? Number(duration) : undefined,
      scheduledFor: isScheduled ? new Date(scheduledFor).toISOString() : undefined,
      status: isScheduled ? 'pending' : 'completed',
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }

    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      await api.post(`/leads/${leadId}/activities`, payload)
      resetForm()
      toast('Activity logged')
      onChanged()
    } catch (err) {
      const parsed = toFormErrors(err, 'Failed to log activity')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {showCreateForm && <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="activity-type" className="sr-only">
            Activity type
          </label>
          <select
            id="activity-type"
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
            className={inputClass}
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label htmlFor="activity-title" className="sr-only">
            Activity title
          </label>
          <input
            id="activity-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What happened?"
            className={`${inputClass} min-w-[200px] flex-1`}
          />
        </div>
        {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}

        {/* Type-specific fields */}
        {type === 'call' && (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="call-duration" className="sr-only">
              Call duration in minutes
            </label>
            <input
              id="call-duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Duration (min)"
              className={`${inputClass} w-36`}
            />
            <label htmlFor="call-outcome" className="sr-only">
              Call outcome
            </label>
            <select
              id="call-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className={inputClass}
            >
              <option value="">Outcome…</option>
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )}

        {type === 'email' && (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="email-to" className="sr-only">
              Email recipient
            </label>
            <input
              id="email-to"
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="Sent to (email)"
              className={`${inputClass} min-w-[220px]`}
            />
          </div>
        )}

        {type === 'meeting' && (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="meeting-attendees" className="sr-only">
              Meeting attendees
            </label>
            <input
              id="meeting-attendees"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="Attendees (comma-separated)"
              className={`${inputClass} min-w-[220px] flex-1`}
            />
            <label htmlFor="meeting-when" className="sr-only">
              Meeting date and time
            </label>
            <input
              id="meeting-when"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className={inputClass}
            />
            <label htmlFor="meeting-duration" className="sr-only">
              Meeting duration in minutes
            </label>
            <input
              id="meeting-duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Duration (min)"
              className={`${inputClass} w-36`}
            />
          </div>
        )}

        {type === 'task' && (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="task-due" className="sr-only">
              Task due date
            </label>
            <input
              id="task-due"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className={inputClass}
            />
          </div>
        )}

        {(type === 'note' || description) && (
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        )}

        {fieldErrors.scheduledFor && (
          <p className="text-xs text-destructive">{fieldErrors.scheduledFor}</p>
        )}

        <div>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !title.trim()}
            className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Log activity
          </Button>
        </div>
        </form>
      }

      <div className="flex flex-col gap-2">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground">No activities logged yet.</p>
        )}
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start justify-between rounded-md border border-border p-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="default">{activity.type}</Badge>
                <span className="text-sm font-medium">{activity.title}</span>
                {activity.status === 'pending' && <Badge variant="warning">scheduled</Badge>}
              </div>
              {activity.description && (
                <p className="mt-1 text-sm text-muted-foreground">{activity.description}</p>
              )}
            </div>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDate(new Date(activity.createdAt))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
