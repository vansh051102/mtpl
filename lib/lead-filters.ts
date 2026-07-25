import { Prisma } from '@prisma/client'
import { ValidationError } from './errors'
import { zonedStartOfDay, addDays } from './timezone'

export const CLOSING_HORIZON_DAYS: Record<string, number> = {
  next_2_days: 2,
  next_3_days: 3,
  '1_week': 7,
  '1_month': 30,
}

export const ADVANCED_LEAD_SORT_FIELDS = [
  'quotationValue',
  'orderValue',
  'supplierMargin',
  'totalCalls',
  'totalMessages',
] as const

/** Raw query-param values for the Phase C advanced filter set — shared by the
 *  leads list route and the export route so both apply identical filtering. */
export interface AdvancedLeadFilterParams {
  quotationValueMin?: string | null
  quotationValueMax?: string | null
  orderValueMin?: string | null
  orderValueMax?: string | null
  marginMin?: string | null
  marginMax?: string | null
  quotationNumber?: string | null
  closingHorizon?: string | null
  closingFrom?: string | null
  closingTo?: string | null
  territory?: string | null
  serviceArea?: string | null
  pinCode?: string | null
  callsCountMin?: string | null
  callsCountMax?: string | null
  messagesCountMin?: string | null
  inactivityDays?: string | null
  productCategory?: string | null
  customerSegment?: string | null
}

export function parseAdvancedLeadFilters(searchParams: URLSearchParams): AdvancedLeadFilterParams {
  return {
    quotationValueMin: searchParams.get('quotationValueMin'),
    quotationValueMax: searchParams.get('quotationValueMax'),
    orderValueMin: searchParams.get('orderValueMin'),
    orderValueMax: searchParams.get('orderValueMax'),
    marginMin: searchParams.get('marginMin'),
    marginMax: searchParams.get('marginMax'),
    quotationNumber: searchParams.get('quotationNumber'),
    closingHorizon: searchParams.get('closingHorizon'),
    closingFrom: searchParams.get('closingFrom'),
    closingTo: searchParams.get('closingTo'),
    territory: searchParams.get('territory'),
    serviceArea: searchParams.get('serviceArea'),
    pinCode: searchParams.get('pinCode'),
    callsCountMin: searchParams.get('callsCountMin'),
    callsCountMax: searchParams.get('callsCountMax'),
    messagesCountMin: searchParams.get('messagesCountMin'),
    inactivityDays: searchParams.get('inactivityDays'),
    productCategory: searchParams.get('productCategory'),
    customerSegment: searchParams.get('customerSegment'),
  }
}

function parsePositiveNumber(value: string | null | undefined, label: string): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`Invalid ${label}: ${value}`)
  return n
}

function parseNonNegativeInt(value: string | null | undefined, label: string): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (!/^\d+$/.test(value)) throw new ValidationError(`Invalid ${label}: ${value}`)
  return Number(value)
}

/**
 * Builds the Prisma where-fragment for the Phase C advanced filters. `now`/
 * `timezone` drive the closingHorizon date window — pass the org's
 * Settings.timezone so "next 2 days" resolves in the org's wall-clock, not UTC.
 */
export function buildAdvancedLeadWhere(
  params: AdvancedLeadFilterParams,
  timezone: string,
  now: Date = new Date()
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {}

  const quotationValueMin = parsePositiveNumber(params.quotationValueMin, 'quotationValueMin')
  const quotationValueMax = parsePositiveNumber(params.quotationValueMax, 'quotationValueMax')
  if (quotationValueMin !== undefined || quotationValueMax !== undefined) {
    where.quotationValue = {
      ...(quotationValueMin !== undefined && { gte: quotationValueMin }),
      ...(quotationValueMax !== undefined && { lte: quotationValueMax }),
    }
  }

  const orderValueMin = parsePositiveNumber(params.orderValueMin, 'orderValueMin')
  const orderValueMax = parsePositiveNumber(params.orderValueMax, 'orderValueMax')
  if (orderValueMin !== undefined || orderValueMax !== undefined) {
    where.orderValue = {
      ...(orderValueMin !== undefined && { gte: orderValueMin }),
      ...(orderValueMax !== undefined && { lte: orderValueMax }),
    }
  }

  const marginMin = parsePositiveNumber(params.marginMin, 'marginMin')
  const marginMax = parsePositiveNumber(params.marginMax, 'marginMax')
  if (marginMin !== undefined || marginMax !== undefined) {
    where.supplierMargin = {
      ...(marginMin !== undefined && { gte: marginMin }),
      ...(marginMax !== undefined && { lte: marginMax }),
    }
  }

  if (params.quotationNumber) {
    where.quotationNumber = { contains: params.quotationNumber, mode: 'insensitive' }
  }

  if (params.territory) where.territory = params.territory
  if (params.serviceArea) where.serviceArea = params.serviceArea
  if (params.pinCode) where.pinCode = params.pinCode

  if (params.productCategory) {
    where.productCategory = { contains: params.productCategory, mode: 'insensitive' }
  }
  if (params.customerSegment) where.customerSegment = params.customerSegment

  const callsCountMin = parseNonNegativeInt(params.callsCountMin, 'callsCountMin')
  const callsCountMax = parseNonNegativeInt(params.callsCountMax, 'callsCountMax')
  if (callsCountMin !== undefined || callsCountMax !== undefined) {
    where.totalCalls = {
      ...(callsCountMin !== undefined && { gte: callsCountMin }),
      ...(callsCountMax !== undefined && { lte: callsCountMax }),
    }
  }

  const messagesCountMin = parseNonNegativeInt(params.messagesCountMin, 'messagesCountMin')
  if (messagesCountMin !== undefined) where.totalMessages = { gte: messagesCountMin }

  const inactivityDays = parseNonNegativeInt(params.inactivityDays, 'inactivityDays')
  if (inactivityDays !== undefined) {
    where.lastActivityAt = { lte: addDays(now, -inactivityDays) }
  }

  if (params.closingHorizon) {
    if (params.closingHorizon === 'custom') {
      if ((params.closingFrom && isNaN(Date.parse(params.closingFrom))) || (params.closingTo && isNaN(Date.parse(params.closingTo)))) {
        throw new ValidationError('Invalid closingFrom/closingTo date')
      }
      where.targetClosingDate = {
        ...(params.closingFrom && { gte: new Date(params.closingFrom) }),
        ...(params.closingTo && { lte: new Date(params.closingTo) }),
      }
    } else {
      const days = CLOSING_HORIZON_DAYS[params.closingHorizon]
      if (days === undefined) {
        throw new ValidationError(
          `Invalid closingHorizon: ${params.closingHorizon}. Allowed: ${Object.keys(CLOSING_HORIZON_DAYS).join(', ')}, custom`
        )
      }
      const start = zonedStartOfDay(now, timezone)
      where.targetClosingDate = { gte: start, lte: addDays(start, days) }
    }
  }

  return where
}
