export interface SmtpConfig {
  use_gmail_oauth: boolean
  gmail_user: string
  smtp_host: string
  port: number
  username: string
  password: string
  use_ssl: boolean
}

export interface Template {
  id: string
  name: string
  subject: string
  content: string
  isDefault: boolean
}

export interface Contact {
  email: string
  name: string
  templateId: string
}

export interface CampaignSettings {
  pause_between_messages: number
  pause_between_blocks: number
  messages_per_block: number
  max_connections: number
  retries: number
  selectedAccounts: string[]
}

export interface CampaignStatus {
  isRunning: boolean
  remaining: number
  status: string
  completed: boolean
  errors?: string[]
}


