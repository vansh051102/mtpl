'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { toFormErrors } from '@/lib/form-errors'

interface TeamMember {
  id: string
  fullName: string
  role: string
}

interface Team {
  id: string
  name: string
  members: TeamMember[]
}

interface OrgUser {
  id: string
  fullName: string
  role: string
  status: string
}

const SALES_ROLES = ['sales_executive', 'sales_manager', 'sales_purchase']

function roleLabel(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function TeamsPage() {
  const { toast } = useToast()
  const [teams, setTeams] = useState<Team[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [name, setName] = useState('')
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    Promise.all([api.get<Team[]>('/teams'), api.get<OrgUser[]>('/users')])
      .then(([teamsRes, usersRes]) => {
        setTeams(teamsRes.data ?? [])
        setUsers((usersRes.data ?? []).filter((u) => u.status === 'active'))
      })
      .catch((err) => toast(toFormErrors(err, 'Failed to load teams').message, 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openNew() {
    setName('')
    setMemberIds(new Set())
    setEditing('new')
  }

  function openEdit(team: Team) {
    setName(team.name)
    setMemberIds(new Set(team.members.map((m) => m.id)))
    setEditing(team)
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = { name: name.trim(), memberIds: Array.from(memberIds) }
      if (editing === 'new') {
        await api.post('/teams', payload)
        toast('Team created')
      } else if (editing) {
        await api.put(`/teams/${editing.id}`, payload)
        toast('Team updated')
      }
      setEditing(null)
      load()
    } catch (err) {
      toast(toFormErrors(err, 'Save failed').message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(team: Team) {
    if (!window.confirm(`Delete team "${team.name}"? Members keep their accounts but lose this team assignment.`)) {
      return
    }
    setDeletingId(team.id)
    try {
      await api.delete(`/teams/${team.id}`)
      toast('Team deleted')
      load()
    } catch (err) {
      toast(toFormErrors(err, 'Delete failed').message, 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Teams</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Group Sales Executives under a Team so Lead Gen users can only assign leads within their own Team.
          </p>
        </div>
        <Button onClick={openNew}>New Team</Button>
      </div>

      {loading ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No teams yet. Create one to scope lead assignment.</p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-card">
          {teams.map((team) => (
            <li key={team.id} className="flex items-start justify-between gap-4 px-4 py-4">
              <div>
                <p className="font-medium">{team.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {team.members.length === 0
                    ? 'No members'
                    : team.members.map((m) => `${m.fullName} (${roleLabel(m.role)})`).join(', ')}
                </p>
              </div>
              <div className="flex flex-none gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(team)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={deletingId === team.id}
                  onClick={() => remove(team)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'New team' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Team name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <div>
              <p className="mb-2 text-sm font-medium">Members</p>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {users.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">No active users found.</p>
                ) : (
                  users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={memberIds.has(u.id)}
                        onChange={() => toggleMember(u.id)}
                        className="h-4 w-4 rounded border-border"
                      />
                      {u.fullName}
                      <span className="text-xs text-muted-foreground">
                        {roleLabel(u.role)}
                        {SALES_ROLES.includes(u.role) ? '' : ' — not a sales role'}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !name.trim()} className={saving ? 'opacity-60' : ''}>
                Save team
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
