export type Role = 'admin' | 'editor' | 'viewer'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: Role
}

export type StaffStatus = 'Active' | 'On leave' | 'Left'

export interface Staff {
  id: string
  name: string
  designation: string
  country: string
  status: StaffStatus
  basic: number
  food: number
  allowance: number
  join_date: string | null
  left_date: string | null
  phone: string
  passport_no: string
  passport_exp: string | null
  wp_no: string
  wp_exp: string | null
  visa_exp: string | null
  medical_exp: string | null
  insurance_exp: string | null
  notes: string
  sort_order: number
}

export interface Bill {
  id: string
  name: string
  category: string
  amount: number | null
  due_day: number
  provider: string
  account: string
  active: boolean
}

export interface Payment {
  id: string
  month: string
  bill_id: string | null
  description: string
  category: string
  amount: number
  date: string
  method: string
  ref: string
}

export interface PayLine {
  staffId: string
  name: string
  designation: string
  country: string
  basic: number
  food: number
  allowance: number
  extra: number
  deduction: number
}

export interface PayrollMonth {
  month: string
  salaries: number
  food: number
  allowances: number
  staff_count: number | null
  lines: PayLine[] | null
  pay_status: 'draft' | 'paid'
  paid_date: string | null
  source: string
}

export interface EstimateItem {
  id: string
  month: string
  description: string
  category: string
  amount: number
}

export const CATEGORIES = [
  'Rent', 'Utilities', 'Internet & phone', 'Permits & fees', 'Insurance',
  'Vehicles & transport', 'Materials & tools', 'Office supplies', 'Repairs & maintenance', 'Other',
] as const

export const METHODS = ['Bank transfer', 'Cash', 'Card', 'Cheque'] as const

export const DOCS: [keyof Staff, string][] = [
  ['passport_exp', 'Passport'], ['wp_exp', 'Work permit'], ['visa_exp', 'Work visa'],
  ['medical_exp', 'Medical'], ['insurance_exp', 'Insurance'],
]
