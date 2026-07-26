import { prisma } from './db'

export interface DepartmentComparisonEntry {
  department: string
  score: number
  deltaPct: number
}

const COMPARED_DEPARTMENTS = ['Sales', 'Marketing', 'Purchase']

/** Latest snapshot vs. the one before it per department — computeDepartmentHealth()
 * already writes one row per cron run, so this is a plain diff, no new table. */
export async function getDepartmentComparison(orgId: string): Promise<DepartmentComparisonEntry[]> {
  const results = await Promise.all(
    COMPARED_DEPARTMENTS.map(async (department) => {
      const [latest, prior] = await prisma.departmentHealthSnapshot.findMany({
        where: { orgId, department },
        orderBy: { calculatedAt: 'desc' },
        take: 2,
      })
      if (!latest) return { department, score: 0, deltaPct: 0 }
      const score = Number(latest.score)
      const deltaPct = prior ? Math.round(score - Number(prior.score)) : 0
      return { department, score, deltaPct }
    })
  )
  return results
}
