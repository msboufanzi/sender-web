export interface SmtpConfig {
  use_gmail_oauth: boolean
  gmail_user: string
  smtp_host: string
  port: number
  username: string
  password: string
  use_ssl: boolean
}

export interface CampaignSettings {
  subject: string
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

export interface EmailTemplates {
  [language: string]: string
}

