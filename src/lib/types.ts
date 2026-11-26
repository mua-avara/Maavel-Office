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
  /** Added with the Nov 2026 upgrade; missing until that SQL is run. */
  visa_no?: string
  annual_leave_days?: number
  emergency_contact?: string
  project_id?: string | null
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
  /** Where to send the money (added Nov 2026; missing until that SQL is run). */
  pay_name?: string
  pay_account?: string
  pay_bank?: string
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
  project_id?: string | null
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
  /** Site the person worked on when the sheet was built. */
  projectId?: string | null
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

export interface CompanyDoc {
  id: string
  name: string
  category: string
  number: string
  issuer: string
  issue_date: string | null
  expiry_date: string | null
  renewal_cost: number | null
  notes: string
}

export type Priority = 'High' | 'Normal' | 'Low'

export interface Task {
  id: string
  title: string
  due_date: string | null
  owner: string
  priority: Priority
  done: boolean
  done_date: string | null
  notes: string
  created_at?: string
}

export type OwnerType = 'staff' | 'company_doc' | 'project' | 'asset'

export interface FileRow {
  id: string
  owner_type: OwnerType
  owner_id: string
  kind: string
  name: string
  path: string
  mime: string
  size: number
  uploaded_by: string | null
  created_at: string
}

export const STAFF_FILE_KINDS = ['Profile photo', 'Passport photo', 'Passport copy', 'E-visa', 'Medical', 'Insurance', 'Contract', 'Other'] as const
export const COMPANY_FILE_KINDS = ['Certificate / licence', 'Receipt', 'Letter', 'Other'] as const
export const PROJECT_FILE_KINDS = ['Contract', 'Drawing', 'Quotation', 'Invoice', 'Photo', 'Other'] as const

export const LEAVE_TYPES = ['Annual', 'Sick', 'Emergency', 'Unpaid', 'Other'] as const
export type LeaveType = typeof LEAVE_TYPES[number]

export interface Leave {
  id: string
  staff_id: string
  type: LeaveType
  start_date: string
  end_date: string
  days: number
  notes: string
}

export type ProjectStatus = 'Active' | 'On hold' | 'Completed'

export interface Project {
  id: string
  name: string
  client: string
  location: string
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  contract_value: number | null
  budget: number | null
  notes: string
}

export type AssetKind = 'vehicle' | 'machinery'
export type AssetStatus = 'In use' | 'Idle' | 'Under repair' | 'Sold'

export interface Asset {
  id: string
  kind: AssetKind
  type: string
  name: string
  reg_no: string
  make: string
  model: string
  year: number | null
  colour: string
  chassis_no: string
  engine_no: string
  serial_no: string
  registered_owner: string
  status: AssetStatus
  project_id: string | null
  purchase_date: string | null
  purchase_price: number | null
  annual_fee_due: string | null
  annual_fee: number | null
  insurance_exp: string | null
  insurance_provider: string
  policy_no: string
  roadworthy_exp: string | null
  notes: string
}

export const VEHICLE_TYPES = ['Car', 'Pickup', 'Van', 'Lorry', 'Tipper', 'Motorcycle', 'Forklift', 'Dhoni', 'Launch', 'Speedboat', 'Barge', 'Other'] as const
export const VESSEL_TYPES = ['Dhoni', 'Launch', 'Speedboat', 'Barge']
export const MACHINE_TYPES = ['Excavator', 'Crane', 'Concrete mixer', 'Generator', 'Compressor', 'Roller', 'Welding machine', 'Scaffolding set', 'Other'] as const
export const ASSET_STATUSES: AssetStatus[] = ['In use', 'Idle', 'Under repair', 'Sold']
export const ASSET_FILE_KINDS = ['Photo', 'Registration', 'Insurance', 'Road worthiness', 'Annual fee receipt', 'Other'] as const

export const DOC_CATEGORIES = [
  'Registration & licence', 'Tax (MIRA)', 'Lease & rent agreement', 'Insurance', 'Vehicle & vessel',
  'Contract', 'Bank', 'Expat quota', 'Other',
] as const

export const CATEGORIES = [
  'Rent', 'Utilities', 'Internet & phone', 'Permits & fees', 'Insurance',
  'Vehicles & transport', 'Materials & tools', 'Office supplies', 'Repairs & maintenance', 'Other',
] as const

export const METHODS = ['Bank transfer', 'Cash', 'Card', 'Cheque'] as const

export const DOCS: [keyof Staff, string][] = [
  ['passport_exp', 'Passport'], ['visa_exp', 'E-visa'],
  ['medical_exp', 'Medical'], ['insurance_exp', 'Insurance'],
]
