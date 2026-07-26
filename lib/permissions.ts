// ============================================================================
// PERMISSION CONSTANTS
// ============================================================================

export const PERMISSIONS = {
  // Leads
  LEADS_CREATE: 'leads:create',
  LEADS_READ: 'leads:read',
  LEADS_EDIT: 'leads:edit',
  LEADS_DELETE: 'leads:delete',
  LEADS_ASSIGN: 'leads:assign',
  LEADS_EXPORT: 'leads:export',
  LEADS_IMPORT: 'leads:import',

  // Contacts
  CONTACTS_CREATE: 'contacts:create',
  CONTACTS_READ: 'contacts:read',
  CONTACTS_EDIT: 'contacts:edit',

  // Activities
  ACTIVITIES_CREATE: 'activities:create',
  ACTIVITIES_READ: 'activities:read',
  ACTIVITIES_EDIT: 'activities:edit',
  ACTIVITIES_DELETE: 'activities:delete',

  // Quotes
  QUOTES_CREATE: 'quotes:create',
  QUOTES_READ: 'quotes:read',
  QUOTES_EDIT: 'quotes:edit',
  QUOTES_SEND: 'quotes:send',

  // Purchase Requests
  PURCHASE_REQUESTS_CREATE: 'purchase_requests:create',
  PURCHASE_REQUESTS_READ: 'purchase_requests:read',
  PURCHASE_REQUESTS_EDIT: 'purchase_requests:edit',

  // Checklists
  CHECKLISTS_CREATE: 'checklists:create',
  CHECKLISTS_READ: 'checklists:read',
  CHECKLISTS_EDIT: 'checklists:edit',

  // Analytics
  ANALYTICS_READ: 'analytics:read',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_EDIT: 'settings:edit',

  // Users
  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_EDIT: 'users:edit',
  USERS_DELETE: 'users:delete',

  // Roles
  ROLES_CREATE: 'roles:create',
  ROLES_READ: 'roles:read',
  ROLES_EDIT: 'roles:edit',

  // Teams (admin-managed groups scoping lead/contact assignment)
  TEAMS_MANAGE: 'teams:manage',

  // Master Data
  MASTER_DATA_CREATE: 'master_data:create',
  MASTER_DATA_READ: 'master_data:read',
  MASTER_DATA_EDIT: 'master_data:edit',

  // Reports
  REPORTS_READ: 'reports:read',

  // ERP (Trading: customers, orders, inventory ledger, invoices, Tally sync)
  ERP_CUSTOMERS_READ: 'erp_customers:read',
  ERP_CUSTOMERS_EDIT: 'erp_customers:edit',
  ERP_ORDERS_READ: 'erp_orders:read',
  ERP_ORDERS_EDIT: 'erp_orders:edit',
  ERP_INVENTORY_READ: 'erp_inventory:read',
  ERP_INVENTORY_EDIT: 'erp_inventory:edit',
  ERP_INVOICES_READ: 'erp_invoices:read',
  ERP_INVOICES_EDIT: 'erp_invoices:edit',
  ERP_TALLY_SYNC: 'erp_tally:sync',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** All known permission strings — use for admin UI matrix + role validation */
export const ALL_PERMISSION_VALUES: string[] = Object.values(PERMISSIONS)

/** Grouped for admin permission matrix UI */
export const PERMISSION_GROUPS: Record<string, string[]> = {
  leads: ['read', 'create', 'edit', 'delete', 'assign', 'import', 'export'],
  contacts: ['read', 'create', 'edit'],
  activities: ['read', 'create', 'edit', 'delete'],
  quotes: ['read', 'create', 'edit', 'send'],
  purchase_requests: ['read', 'create', 'edit'],
  checklists: ['read', 'create', 'edit'],
  analytics: ['read'],
  settings: ['read', 'edit'],
  users: ['read', 'create', 'edit', 'delete'],
  roles: ['read', 'create', 'edit'],
  teams: ['manage'],
  master_data: ['read', 'create', 'edit'],
  reports: ['read'],
}

/** Human-readable label + description per resource — used by the admin role matrix UI */
export const RESOURCE_LABELS: Record<string, { label: string; description: string }> = {
  leads: { label: 'Leads', description: 'Incoming sales leads and their pipeline stage' },
  contacts: { label: 'Contacts', description: 'People and companies linked to leads' },
  activities: { label: 'Activities', description: 'Calls, notes, and follow-ups logged against leads' },
  quotes: { label: 'Quotes', description: 'Price quotations sent to customers' },
  purchase_requests: { label: 'Purchase Requests', description: 'Internal requests to buy materials or stock' },
  checklists: { label: 'Checklists', description: 'SOP checklists attached to leads or orders' },
  analytics: { label: 'Analytics', description: 'Dashboards and pipeline reporting' },
  settings: { label: 'Settings', description: 'Workspace configuration and integrations' },
  users: { label: 'Users', description: 'Team member accounts' },
  roles: { label: 'Roles', description: 'Role definitions and permissions (this screen)' },
  teams: { label: 'Teams', description: 'Groups scoping which Sales Executives a Lead Gen user can assign to' },
  master_data: { label: 'Master Data', description: 'Shared reference data like products and vendors' },
  reports: { label: 'Reports', description: 'Exported business reports' },
}

/** Short label per action verb, shown as a matrix column header */
export const ACTION_LABELS: Record<string, string> = {
  read: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  assign: 'Assign',
  import: 'Import',
  export: 'Export',
  send: 'Send',
  manage: 'Manage',
}

export function isKnownPermission(perm: string): boolean {
  return perm === '*' || ALL_PERMISSION_VALUES.includes(perm)
}

// ============================================================================
// ROLE → PERMISSION MAPPING (DEFAULTS)
// ============================================================================

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],

  marketing_manager: [
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_EDIT,
    PERMISSIONS.LEADS_IMPORT,
    PERMISSIONS.CONTACTS_CREATE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_EDIT,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_READ,
    PERMISSIONS.ACTIVITIES_EDIT,
    PERMISSIONS.ACTIVITIES_DELETE,
    PERMISSIONS.ANALYTICS_READ,
  ],

  marketing_executive: [
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_EDIT,
    PERMISSIONS.LEADS_IMPORT,
    PERMISSIONS.CONTACTS_CREATE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_EDIT,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_READ,
  ],

  sales_manager: [
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_EDIT,
    PERMISSIONS.LEADS_ASSIGN,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_READ,
    PERMISSIONS.ACTIVITIES_EDIT,
    PERMISSIONS.ACTIVITIES_DELETE,
    PERMISSIONS.QUOTES_READ,
    PERMISSIONS.ANALYTICS_READ,
    // ERP: sales managers own the CRM→ERP conversion + order/customer surface
    PERMISSIONS.ERP_CUSTOMERS_READ,
    PERMISSIONS.ERP_CUSTOMERS_EDIT,
    PERMISSIONS.ERP_ORDERS_READ,
    PERMISSIONS.ERP_ORDERS_EDIT,
    PERMISSIONS.ERP_INVENTORY_READ,
    PERMISSIONS.ERP_INVOICES_READ,
  ],

  sales_executive: [
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_EDIT,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_READ,
    PERMISSIONS.QUOTES_READ,
  ],

  purchase: [
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.QUOTES_CREATE,
    PERMISSIONS.QUOTES_READ,
    PERMISSIONS.QUOTES_EDIT,
    PERMISSIONS.QUOTES_SEND,
    PERMISSIONS.PURCHASE_REQUESTS_CREATE,
    PERMISSIONS.PURCHASE_REQUESTS_READ,
    PERMISSIONS.PURCHASE_REQUESTS_EDIT,
    PERMISSIONS.CHECKLISTS_CREATE,
    PERMISSIONS.CHECKLISTS_READ,
    PERMISSIONS.CHECKLISTS_EDIT,
    // ERP: purchase team runs goods receipts (stock IN) and the Tally push
    PERMISSIONS.ERP_INVENTORY_READ,
    PERMISSIONS.ERP_INVENTORY_EDIT,
    PERMISSIONS.ERP_TALLY_SYNC,
  ],

  sales_purchase: [
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_EDIT,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_READ,
    PERMISSIONS.QUOTES_CREATE,
    PERMISSIONS.QUOTES_READ,
    PERMISSIONS.QUOTES_EDIT,
    PERMISSIONS.QUOTES_SEND,
    PERMISSIONS.PURCHASE_REQUESTS_CREATE,
    PERMISSIONS.PURCHASE_REQUESTS_READ,
    PERMISSIONS.PURCHASE_REQUESTS_EDIT,
    PERMISSIONS.CHECKLISTS_CREATE,
    PERMISSIONS.CHECKLISTS_READ,
    PERMISSIONS.CHECKLISTS_EDIT,
  ],
}
