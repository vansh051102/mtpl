'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { toFormErrors } from '@/lib/form-errors'

const MODULES: { key: string; title: string; description: string }[] = [
  {
    key: 'leads',
    title: 'Leads management',
    description: 'Controls the lead pipeline, lead detail workspace, and lead-based selling pages.',
  },
  {
    key: 'lead_message_logs',
    title: 'Lead message logs',
    description: 'Shows the Log Message action on leads and the Messages tab in the activity drawer.',
  },
  {
    key: 'contacts',
    title: 'Contacts',
    description: 'Enables the shared contact directory for WhatsApp and email workflows.',
  },
  {
    key: 'lead_generation_campaigns',
    title: 'Lead generation campaigns',
    description: 'Enables marketing campaign workflows separate from the core leads pipeline.',
  },
  {
    key: 'customer_folders',
    title: 'Customer folders',
    description: 'Creates a canonical customer document repository for leads and quotations.',
  },
  {
    key: 'auto_create_folders',
    title: 'Auto-create folders from lead documents',
    description: 'When enabled, uploading a lead document can create the customer folder automatically.',
  },
  {
    key: 'quotations',
    title: 'Quotations management',
    description: 'Controls quotations list/detail pages and quotation document storage.',
  },
  {
    key: 'lead_gen_won_lost_views',
    title: 'Recently Won/Lost views for Lead Gen',
    description: 'Shows the "Recently Won" and "Recently Lost" smart-view filter chips to marketing roles on the Leads page.',
  },
]

export default function ModuleAccessPage() {
  const { toast } = useToast()
  const [access, setAccess] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .get<{ moduleAccess: Record<string, boolean> }>('/settings')
      .then((res) => setAccess(res.data?.moduleAccess ?? {}))
      .catch((err) => toast(toFormErrors(err, 'Failed to load').message, 'error'))
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api.put('/settings', { moduleAccess: access })
      toast('Module access saved')
    } catch (err) {
      toast(toFormErrors(err, 'Save failed').message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ moduleAccess: access }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'veck-module-access.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File) {
    try {
      const data = JSON.parse(await file.text()) as { moduleAccess?: Record<string, boolean> }
      if (data.moduleAccess) {
        setAccess(data.moduleAccess)
        await api.put('/settings', { moduleAccess: data.moduleAccess })
        toast('Imported')
      }
    } catch {
      toast('Invalid JSON', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Module Access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn workspace modules on or off per tenant.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportJson}>
            Export JSON
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
          <Button onClick={save} disabled={saving}>
            Save Changes
          </Button>
        </div>
      </div>

      <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card">
        {MODULES.map((m) => (
          <li key={m.key} className="flex items-start justify-between gap-4 px-4 py-4">
            <div>
              <p className="font-medium">{m.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={access[m.key] ?? false}
                onChange={(e) => setAccess({ ...access, [m.key]: e.target.checked })}
              />
              {access[m.key] ? 'On' : 'Off'}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
