'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ModalContentSkeleton } from '@/components/ui/skeleton-variants'

type DayWindow = { start: string; end: string } | null
type WorkingHours = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayWindow>

interface BusinessCalendar {
  id: string
  branch: string | null
  timezone: string
  workingHours: WorkingHours
  holidays: string[]
  isDefault: boolean
}

const DAYS: { key: keyof WorkingHours; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { start: '09:30', end: '18:30' },
  tue: { start: '09:30', end: '18:30' },
  wed: { start: '09:30', end: '18:30' },
  thu: { start: '09:30', end: '18:30' },
  fri: { start: '09:30', end: '18:30' },
  sat: null,
  sun: null,
}

const cellClass =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary'

// Admin editor for operating hours — working hours per weekday, plus a
// holiday date list. Backs the working-hours-aware SLA math in
// lib/sla-engine.ts:addBusinessMinutes. One calendar with branch=null is the
// org default (Settings.defaultCalendarId); additional calendars are
// per-branch overrides referenced from an SLA rule.
export function OperatingHoursModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [holidayDraft, setHolidayDraft] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  function load() {
    api
      .get<BusinessCalendar[]>('/admin/business-calendars')
      .then((res) => setCalendars(res.data ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load calendars'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function updateCalendar(id: string, patch: Partial<BusinessCalendar>) {
    setCalendars((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    try {
      await api.put(`/admin/business-calendars/${id}`, patch)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update calendar')
      load()
    }
  }

  async function deleteCalendar(id: string) {
    setCalendars((prev) => prev.filter((c) => c.id !== id))
    try {
      await api.delete(`/admin/business-calendars/${id}`)
      toast('Calendar deleted')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete calendar')
      load()
    }
  }

  async function createCalendar() {
    setCreating(true)
    setError(null)
    try {
      const res = await api.post<BusinessCalendar>('/admin/business-calendars', {
        branch: null,
        timezone: 'Asia/Kolkata',
        workingHours: DEFAULT_WORKING_HOURS,
        holidays: [],
        isDefault: calendars.length === 0,
      })
      if (res.data) setCalendars((prev) => [...prev, res.data as BusinessCalendar])
      toast('Calendar added')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add calendar')
    } finally {
      setCreating(false)
    }
  }

  function setDayWindow(calendar: BusinessCalendar, day: keyof WorkingHours, window: DayWindow) {
    updateCalendar(calendar.id, { workingHours: { ...calendar.workingHours, [day]: window } })
  }

  function addHoliday(calendar: BusinessCalendar) {
    const date = holidayDraft[calendar.id]?.trim()
    if (!date) return
    updateCalendar(calendar.id, { holidays: [...calendar.holidays, date] })
    setHolidayDraft((prev) => ({ ...prev, [calendar.id]: '' }))
  }

  function removeHoliday(calendar: BusinessCalendar, date: string) {
    updateCalendar(calendar.id, { holidays: calendar.holidays.filter((d) => d !== date) })
  }

  return (
    <Modal title="Operating Hours" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Working hours, weekends, and holidays used to compute business-hours-aware SLA
          deadlines. Non-working time never counts toward an SLA target.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <ModalContentSkeleton variant="list" />
        ) : (
          <div className="flex flex-col gap-4">
            {calendars.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No calendar configured — SLA timers run 24/7 until you add one.
              </p>
            )}

            {calendars.map((calendar) => (
              <div key={calendar.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    aria-label="Branch"
                    value={calendar.branch ?? ''}
                    placeholder="Org default"
                    onChange={(e) =>
                      setCalendars((prev) =>
                        prev.map((c) => (c.id === calendar.id ? { ...c, branch: e.target.value } : c))
                      )
                    }
                    onBlur={(e) => updateCalendar(calendar.id, { branch: e.target.value.trim() || null })}
                    className={`${cellClass} max-w-xs`}
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={calendar.isDefault}
                      onChange={(e) => updateCalendar(calendar.id, { isDefault: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Org default
                  </label>
                  <button
                    type="button"
                    onClick={() => deleteCalendar(calendar.id)}
                    aria-label="Delete calendar"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-7 gap-1">
                  {DAYS.map(({ key, label }) => {
                    const window = calendar.workingHours[key]
                    return (
                      <div key={key} className="rounded-md border border-border p-1.5 text-center">
                        <label className="flex items-center justify-center gap-1 text-[11px] font-medium">
                          <input
                            type="checkbox"
                            checked={window !== null}
                            onChange={(e) =>
                              setDayWindow(
                                calendar,
                                key,
                                e.target.checked ? { start: '09:30', end: '18:30' } : null
                              )
                            }
                            className="h-3 w-3"
                          />
                          {label}
                        </label>
                        {window && (
                          <div className="mt-1 flex flex-col gap-1">
                            <input
                              aria-label={`${label} start`}
                              type="time"
                              value={window.start}
                              onChange={(e) => setDayWindow(calendar, key, { ...window, start: e.target.value })}
                              className="h-7 w-full rounded border border-border text-[10px]"
                            />
                            <input
                              aria-label={`${label} end`}
                              type="time"
                              value={window.end}
                              onChange={(e) => setDayWindow(calendar, key, { ...window, end: e.target.value })}
                              className="h-7 w-full rounded border border-border text-[10px]"
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-3">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Holidays
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {calendar.holidays.map((date) => (
                      <span
                        key={date}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                      >
                        {date}
                        <button
                          type="button"
                          aria-label={`Remove ${date}`}
                          onClick={() => removeHoliday(calendar, date)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      aria-label="Add holiday date"
                      type="date"
                      value={holidayDraft[calendar.id] ?? ''}
                      onChange={(e) =>
                        setHolidayDraft((prev) => ({ ...prev, [calendar.id]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && addHoliday(calendar)}
                      className="h-7 rounded border border-border px-2 text-xs"
                    />
                    <Button size="sm" variant="outline" onClick={() => addHoliday(calendar)}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={createCalendar} disabled={creating}>
                <Plus className="h-4 w-4" />
                {creating ? 'Adding…' : 'Add operating hours'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
