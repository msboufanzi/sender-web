"use client"

import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Send, RefreshCw, CheckCircle, AlertCircle, Check } from "lucide-react"
import { toast } from "@/lib/utils"
import { API_URL } from "@/lib/constants"
import type { CampaignSettings, SmtpConfig, CampaignStatus } from "@/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface EmailAccount {
  id: string
  type: "gmail" | "smtp"
  name: string
  email: string
  isConnected: boolean
}

interface CampaignTabProps {
  campaignSettings: CampaignSettings
  setCampaignSettings: (settings: CampaignSettings) => void
  contactsUploaded: boolean
  smtpConfig: SmtpConfig
  campaignStatus: CampaignStatus
  pollCampaignStatus: () => Promise<void>
  setCampaignStatus: (status: CampaignStatus) => void
}

export default function CampaignTab({
  campaignSettings,
  setCampaignSettings,
  contactsUploaded,
  smtpConfig,
  campaignStatus,
  pollCampaignStatus,
  setCampaignStatus,
}: CampaignTabProps) {
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false)
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  // Fetch accounts on component mount
  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const response = await fetch(`${API_URL}/smtp/accounts`)
      const data = await response.json()

      // Filter to only show connected accounts
      const connectedAccounts = (data.accounts || []).filter((acc: EmailAccount) => acc.isConnected)
      setAccounts(connectedAccounts)

      // Update campaign settings with selected accounts
      if (campaignSettings.selectedAccounts) {
        // Filter to only include accounts that still exist
        const validSelectedAccounts = campaignSettings.selectedAccounts.filter((id) =>
          connectedAccounts.some((acc: EmailAccount) => acc.id === id),
        )
        setSelectedAccountIds(validSelectedAccounts)
      }
    } catch (error) {
      console.error("Error fetching accounts:", error)
    }
  }

  // Poll campaign status
  useEffect(() => {
    let intervalId: NodeJS.Timeout

    if (campaignStatus.isRunning) {
      intervalId = setInterval(async () => {
        try {
          const response = await fetch(`${API_URL}/campaign-status`)
          const data = await response.json()

          setCampaignStatus({
            isRunning: data.isRunning,
            remaining: data.remaining,
            status: data.status,
            completed: data.completed,
            errors: data.errors || [],
          })

          // Show completion dialog when campaign finishes
          if (data.completed && !isCompletionDialogOpen) {
            setIsCompletionDialogOpen(true)
          }

          if (!data.isRunning) {
            clearInterval(intervalId)
          }
        } catch (error) {
          console.error("Error polling campaign status:", error)
        }
      }, 2000)
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [campaignStatus.isRunning])

  const handleAccountSelection = (accountId: string) => {
    setSelectedAccountIds((prev) => {
      if (prev.includes(accountId)) {
        return prev.filter((id) => id !== accountId)
      } else {
        return [...prev, accountId]
      }
    })
  }

  // Update campaign settings when selected accounts change
  useEffect(() => {
    setCampaignSettings({
      ...campaignSettings,
      selectedAccounts: selectedAccountIds,
    })
  }, [selectedAccountIds])

  // Start email campaign
  const startCampaign = async () => {
    if (!contactsUploaded) {
      toast({
        title: "Error",
        description: "Please upload contacts first",
        variant: "destructive",
      })
      return
    }

    if (selectedAccountIds.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one email account",
        variant: "destructive",
      })
      return
    }

    if (campaignSettings.subject === "") {
      toast({
        title: "Error",
        description: "Email subject is required",
        variant: "destructive",
      })
      return
    }

    try {
      const response = await fetch(`${API_URL}/send-emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...campaignSettings,
          selectedAccounts: selectedAccountIds,
        }),
      })

      if (response.ok) {
        setCampaignStatus({
          isRunning: true,
          remaining: 0,
          status: "running",
          completed: false,
          errors: [],
        })

        // Start polling for status
        pollCampaignStatus()

        toast({
          title: "Success",
          description: "Email campaign started successfully",
        })
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to start campaign")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      })
    }
  }

  // Reset campaign to start a new one
  const resetCampaign = async () => {
    try {
      const response = await fetch(`${API_URL}/reset-campaign`, {
        method: "POST",
      })

      if (response.ok) {
        setCampaignStatus({
          isRunning: false,
          remaining: 0,
          status: "idle",
          completed: false,
          errors: [],
        })

        setIsCompletionDialogOpen(false)

        toast({
          title: "Success",
          description: "Campaign reset successfully",
        })
      }
    } catch (error) {
      console.error("Error resetting campaign:", error)
    }
  }

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Email Accounts</CardTitle>
          <CardDescription>
            Select which email accounts to use for sending. Emails will be distributed across selected accounts in a
            round-robin fashion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No accounts available</AlertTitle>
              <AlertDescription>
                Please add and connect at least one email account in the SMTP Configuration tab.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Use</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div className="flex items-center h-4 w-4">
                          <button
                            className={`h-4 w-4 rounded border ${
                              selectedAccountIds.includes(account.id) ? "bg-primary border-primary" : "border-gray-300"
                            } flex items-center justify-center`}
                            onClick={() => handleAccountSelection(account.id)}
                            disabled={!account.isConnected}
                          >
                            {selectedAccountIds.includes(account.id) && <Check className="h-3 w-3 text-white" />}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{account.name}</span>
                          <span className="text-sm text-gray-500">{account.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">{account.type}</span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            account.isConnected ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {account.isConnected ? "Connected" : "Disconnected"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {selectedAccountIds.length > 0 && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-700">
                <strong>Round-Robin Mode:</strong> Emails will be sent using {selectedAccountIds.length} account
                {selectedAccountIds.length > 1 ? "s" : ""} in rotation. If an account fails, the system will retry with
                the next account.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Settings</CardTitle>
          <CardDescription>Configure your email campaign settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="subject">Email Subject</Label>
              <Input
                id="subject"
                value={campaignSettings.subject}
                onChange={(e) => setCampaignSettings({ ...campaignSettings, subject: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="pause_between_messages">Pause Between Messages (seconds)</Label>
                <Input
                  id="pause_between_messages"
                  type="number"
                  value={campaignSettings.pause_between_messages}
                  onChange={(e) =>
                    setCampaignSettings({ ...campaignSettings, pause_between_messages: Number(e.target.value) })
                  }
                />
              </div>
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="pause_between_blocks">Pause Between Blocks (seconds)</Label>
                <Input
                  id="pause_between_blocks"
                  type="number"
                  value={campaignSettings.pause_between_blocks}
                  onChange={(e) =>
                    setCampaignSettings({ ...campaignSettings, pause_between_blocks: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="messages_per_block">Messages Per Block</Label>
                <Input
                  id="messages_per_block"
                  type="number"
                  value={campaignSettings.messages_per_block}
                  onChange={(e) =>
                    setCampaignSettings({ ...campaignSettings, messages_per_block: Number(e.target.value) })
                  }
                />
              </div>
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="max_connections">Max Connections</Label>
                <Input
                  id="max_connections"
                  type="number"
                  value={campaignSettings.max_connections}
                  onChange={(e) =>
                    setCampaignSettings({ ...campaignSettings, max_connections: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="retries">Retries</Label>
              <Input
                id="retries"
                type="number"
                value={campaignSettings.retries}
                onChange={(e) => setCampaignSettings({ ...campaignSettings, retries: Number(e.target.value) })}
              />
              <p className="text-sm text-gray-500 mt-1">
                Number of times to retry sending a failed email using different accounts.
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={startCampaign}
            disabled={campaignStatus.isRunning || selectedAccountIds.length === 0}
            className="w-full"
          >
            {campaignStatus.isRunning ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Sending Emails ({campaignStatus.remaining} remaining)
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Start Email Campaign
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Campaign Completion Dialog */}
      <Dialog open={isCompletionDialogOpen} onOpenChange={setIsCompletionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <CheckCircle className="mr-2 h-5 w-5 text-green-500" />
              Campaign Completed
            </DialogTitle>
            <DialogDescription>Your email campaign has been completed successfully.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p>All emails have been sent. You can now start a new campaign or make changes to your settings.</p>
            {campaignStatus.errors && campaignStatus.errors.length > 0 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="font-medium text-red-800">There were some errors:</p>
                <ul className="list-disc list-inside mt-2 text-sm text-red-700">
                  {campaignStatus.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={resetCampaign}>Start New Campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

