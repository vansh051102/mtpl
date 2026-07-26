import { redirect } from 'next/navigation'

// "Customers" nav item (MTPL OS nav freeze) — no dedicated customer-relationship
// page exists yet distinct from Contacts, so this points at the closest real
// feature rather than a dead end. Revisit once Customer Health (plan §9) lands.
export default function CustomersPage() {
  redirect('/contacts')
}
