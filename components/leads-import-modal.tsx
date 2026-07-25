'use client'

import { useState } from 'react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { parseCsvWithHeader } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'

// Accepted header aliases (lowercased) -> canonical field
const HEADER_MAP: Record<string, string> = {
  company: 'companyName',
  'company name': 'companyName',
  companyname: 'companyName',
  'customer name': 'companyName',
  'lead name': 'companyName',
  'client name': 'companyName',
  'first name': 'firstName',
  firstname: 'firstName',
  'contact first name': 'firstName',
  'last name': 'lastName',
  lastname: 'lastName',
  'contact last name': 'lastName',
  email: 'email',
  'email address': 'email',
  phone: 'phone',
  'contact number': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  'phone number': 'phone',
  contact: 'phone',
  priority: 'priority',
  source: 'source',
  notes: 'notes',
  requirement: 'notes',
  'requirement / description': 'notes',
  description: 'notes',
  gst: 'gstNumber',
  'gst number': 'gstNumber',
  gstnumber: 'gstNumber',
  gstin: 'gstNumber',
  city: 'city',
  tag: 'tag',
  tags: 'tag',
  'assigned to': 'assignedToEmail',
  assignedto: 'assignedToEmail',
  'assigned to email': 'assignedToEmail',
  'quote amount': 'quotationValue',
  'quotation value': 'quotationValue',
  'target price': 'quotationValue',
  'order amount': 'orderValue',
  'order value': 'orderValue',
  territory: 'territory',
  'delivery location': 'territory',
  location: 'territory',
  // Was previously (wrongly) routed into territory — pinCode is a distinct
  // Lead column with its own strict-format validation.
  pincode: 'pinCode',
  'pin code': 'pinCode',
  'service area': 'serviceArea',
  servicearea: 'serviceArea',
  'quotation number': 'quotationNumber',
  'quote number': 'quotationNumber',
  'quote no': 'quotationNumber',
  margin: 'supplierMargin',
  'supplier margin': 'supplierMargin',
  'margin %': 'supplierMargin',
  segment: 'customerSegment',
  'customer segment': 'customerSegment',
}

interface ImportResult {
  created: number
  updated: number
  failed: number
  errors: { row: number; message: string }[]
  errorCsv: string | null
}

const DUPLICATE_STRATEGIES = [
  { value: 'skip', label: 'Skip duplicates' },
  { value: 'overwrite', label: 'Overwrite existing lead' },
  { value: 'repeat_enquiry', label: 'Log as repeat enquiry' },
] as const

export function LeadsImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [unmappedColumns, setUnmappedColumns] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [duplicateStrategy, setDuplicateStrategy] = useState<(typeof DUPLICATE_STRATEGIES)[number]['value']>('skip')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)

  function applyMapping(parsed: Record<string, string>[]) {
    if (parsed.length === 0) {
      setError('No data rows found. The first line must be a header row.')
      setRows([])
      setUnmappedColumns([])
      return
    }
    const columns = Object.keys(parsed[0] ?? {})
    setUnmappedColumns(columns.filter((c) => !HEADER_MAP[c]))
    const mapped = parsed.map((raw) => {
      const row: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw)) {
        const field = HEADER_MAP[key]
        if (field && value) row[field] = value
      }
      return row
    })
    setRows(mapped)
  }

  async function handleFile(file: File) {
    setError(null)
    setResult(null)
    setFileName(file.name)

    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.worksheets[0]
      if (!sheet) {
        setError('No sheet found in the workbook.')
        return
      }
      const values: string[][] = []
      sheet.eachRow((row) => {
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.value == null ? '' : String(cell.value))
        })
        values.push(cells)
      })
      const [headerRow, ...dataRows] = values
      if (!headerRow) {
        setError('No data rows found. The first row must be a header row.')
        return
      }
      const headers = headerRow.map((h) => h.trim().toLowerCase())
      const parsed = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
      applyMapping(parsed)
      return
    }

    const text = await file.text()
    applyMapping(parseCsvWithHeader(text))
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    try {
      const res = await api.post<ImportResult>('/leads/import', { rows, duplicateStrategy })
      setResult(res.data ?? null)
      if (res.data && res.data.failed === 0) {
        toast(`${res.data.created} lead(s) imported`)
        onImported()
        onClose()
      } else {
        onImported()
      }
    } catch (err) {
      setError(toFormErrors(err, 'Import failed').message)
    } finally {
      setImporting(false)
    }
  }

  function downloadErrorCsv() {
    if (!result?.errorCsv) return
    const blob = new Blob([result.errorCsv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-errors.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal title="Import leads from CSV" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Required columns: <code>Company</code>, <code>First Name</code>, <code>Last Name</code>,{' '}
          <code>Email</code>, <code>Phone</code>. Optional: <code>Priority</code>,{' '}
          <code>Source</code>, <code>Tag</code>, <code>GST</code>, <code>City</code>,{' '}
          <code>Assigned To</code> (email), <code>Requirement / Description</code>. Max 500 rows
          per import.
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="csv-file" className="text-sm font-medium">
            CSV or Excel file
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv,.xlsx"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="text-sm"
          />
        </div>

        {rows.length > 0 && !result && (
          <>
            <p className="text-sm">
              <span className="font-medium">{rows.length}</span> row(s) parsed from{' '}
              <span className="font-medium">{fileName}</span>.
            </p>
            {unmappedColumns.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Columns not recognized and skipped: {unmappedColumns.join(', ')}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dup-strategy" className="text-sm font-medium">
                If a contact already exists
              </label>
              <select
                id="dup-strategy"
                value={duplicateStrategy}
                onChange={(e) => setDuplicateStrategy(e.target.value as typeof duplicateStrategy)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              >
                {DUPLICATE_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p>
              Imported <span className="font-medium">{result.created}</span>
              {result.updated > 0 && <>, updated <span className="font-medium">{result.updated}</span></>}, failed{' '}
              <span className="font-medium">{result.failed}</span>.
            </p>
            {result.errors.slice(0, 10).map((e) => (
              <p key={e.row} className="text-destructive">
                Row {e.row}: {e.message}
              </p>
            ))}
            {result.errorCsv && (
              <button
                type="button"
                onClick={downloadErrorCsv}
                className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Download failed rows as CSV
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" disabled={rows.length === 0 || importing} onClick={handleImport}>
            {importing ? 'Importing…' : `Import ${rows.length || ''} lead(s)`}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
