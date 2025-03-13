"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertCircle, Mail, SendHorizonal, Loader2, RefreshCw, Plus, Trash2 } from "lucide-react"
import type { SmtpConfig } from "@/types"
import { API_URL } from "@/lib/constants"
import { toast } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// Extend the Window interface to include onOAuthCallback
declare global {
  interface Window {
    onOAuthCallback?: (success: boolean, email?: string, errorMsg?: string) => void
  }
}

interface EmailAccount {
  id: string
  type: "gmail" | "smtp"
  name: string
  email: string
  host?: string
  port?: number
  username?: string
  password?: string
  use_ssl?: boolean
  isConnected: boolean
}

interface SmtpTabProps {
  smtpConfig: SmtpConfig
  setSmtpConfig: (config: SmtpConfig) => void
}

export default function SmtpTab({ smtpConfig, setSmtpConfig }: SmtpTabProps) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"accounts" | "add-gmail" | "add-smtp">("accounts")
  const [showOAuthDialog, setShowOAuthDialog] = useState(false)
  const [oauthUrl, setOauthUrl] = useState("")
  const oauthWindowRef = useRef<Window | null>(null)
  const [testEmailAddress, setTestEmailAddress] = useState("")
  const [showTestDialog, setShowTestDialog] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  // New SMTP account form state
  const [newSmtpAccount, setNewSmtpAccount] = useState({
    name: "",
    email: "",
    host: "",
    port: 587,
    username: "",
    password: "",
    use_ssl: false,
  })

  // Fetch accounts on component mount
  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const response = await fetch(`${API_URL}/smtp/accounts`)
      const data = await response.json()
      setAccounts(data.accounts || [])

      // If we have accounts, update the smtpConfig with the first connected account
      if (data.accounts && data.accounts.length > 0) {
        const connectedAccount = data.accounts.find((acc: EmailAccount) => acc.isConnected)
        if (connectedAccount) {
          if (connectedAccount.type === "gmail") {
            setSmtpConfig({
              ...smtpConfig,
              use_gmail_oauth: true,
              gmail_user: connectedAccount.email,
            })
          } else {
            setSmtpConfig({
              ...smtpConfig,
              use_gmail_oauth: false,
              smtp_host: connectedAccount.host || "",
              port: connectedAccount.port || 587,
              username: connectedAccount.username || "",
              password: connectedAccount.password || "",
              use_ssl: connectedAccount.use_ssl || false,
            })
          }
          setSelectedAccountId(connectedAccount.id)
        }
      }
    } catch (error) {
      console.error("Error fetching accounts:", error)
      toast({
        title: "Error",
        description: "Failed to fetch email accounts",
        variant: "destructive",
      })
    }
  }

  // OAuth callback handler
  useEffect(() => {
    window.onOAuthCallback = (success: boolean, email?: string, errorMsg?: string) => {
      if (success && email) {
        handleOAuthSuccess(email)
      } else {
        handleOAuthError(errorMsg || "Authentication failed")
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "oauth_callback") {
        if (event.data.success) {
          handleOAuthSuccess(event.data.email)
        } else {
          handleOAuthError(event.data.message || "Failed to connect to Gmail")
        }
      }
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      window.onOAuthCallback = undefined
    }
  }, [])

  const handleOAuthSuccess = async (email: string) => {
    await fetchAccounts()
    setActiveTab("accounts")

    toast({
      title: "Success",
      description: `Connected to Gmail as ${email}`,
    })

    setShowOAuthDialog(false)
    setIsConnecting(false)
  }

  const handleOAuthError = (errorMessage: string) => {
    setOauthError(errorMessage)

    toast({
      title: "Error",
      description: errorMessage,
      variant: "destructive",
    })

    setShowOAuthDialog(false)
    setIsConnecting(false)
  }

  const handleConnectGmail = async () => {
    setIsConnecting(true)
    setOauthError(null)

    try {
      const response = await fetch(`${API_URL}/get-oauth-url`)

      if (!response.ok) {
        throw new Error((await response.json()).error || "Failed to get OAuth URL")
      }

      const data = await response.json()

      if (data.url) {
        setOauthUrl(data.url)
        setShowOAuthDialog(true)

        const width = 600
        const height = 700
        const left = window.screenX + (window.outerWidth - width) / 2
        const top = window.screenY + (window.outerHeight - height) / 2

        oauthWindowRef.current = window.open(
          data.url,
          "OAuthPopup",
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`,
        )

        if (!oauthWindowRef.current || oauthWindowRef.current.closed) {
          throw new Error("Popup was blocked. Please allow popups for this site.")
        }

        const checkPopupClosed = setInterval(() => {
          if (oauthWindowRef.current?.closed) {
            clearInterval(checkPopupClosed)
            setShowOAuthDialog(false)
            setIsConnecting(false)
          }
        }, 1000)
      }
    } catch (error) {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      })
      setIsConnecting(false)
    }
  }

  const handleRemoveAccount = async (accountId: string) => {
    try {
      const response = await fetch(`${API_URL}/smtp/accounts/${accountId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to remove account")
      }

      setAccounts(accounts.filter((acc) => acc.id !== accountId))

      if (selectedAccountId === accountId) {
        setSelectedAccountId(null)
      }

      toast({
        title: "Success",
        description: "Account removed successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      })
    }
  }

  const handleTestConnection = async (accountId: string) => {
    setIsTesting(accountId)
    try {
      const response = await fetch(`${API_URL}/smtp/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountId }),
      })

      if (!response.ok) {
        throw new Error((await response.json()).error || "Failed connection")
      }

      setAccounts(accounts.map((acc) => (acc.id === accountId ? { ...acc, isConnected: true } : acc)))

      toast({
        title: "Success",
        description: "Connection  successful",
      })
    } catch (error) {
      setAccounts(accounts.map((acc) => (acc.id === accountId ? { ...acc, isConnected: false } : acc)))

      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      })
    } finally {
      setIsTesting(null)
    }
  }

  const handleAddSmtpAccount = async () => {
    if (
      !newSmtpAccount.name ||
      !newSmtpAccount.email ||
      !newSmtpAccount.host ||
      !newSmtpAccount.port ||
      !newSmtpAccount.username ||
      !newSmtpAccount.password
    ) {
      toast({
        title: "Error",
        description: "All fields are required",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`${API_URL}/smtp/accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newSmtpAccount),
      })

      if (!response.ok) {
        throw new Error((await response.json()).error || "Failed to add SMTP account")
      }

      setNewSmtpAccount({
        name: "",
        email: "",
        host: "",
        port: 587,
        username: "",
        password: "",
        use_ssl: false,
      })

      await fetchAccounts()
      setActiveTab("accounts")

      toast({
        title: "Success",
        description: "SMTP account added successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId)
    const account = accounts.find((acc) => acc.id === accountId)

    if (account) {
      if (account.type === "gmail") {
        setSmtpConfig({
          ...smtpConfig,
          use_gmail_oauth: true,
          gmail_user: account.email,
        })
      } else {
        setSmtpConfig({
          ...smtpConfig,
          use_gmail_oauth: false,
          smtp_host: account.host || "",
          port: account.port || 587,
          username: account.username || "",
          password: account.password || "",
          use_ssl: account.use_ssl || false,
        })
      }
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Email Accounts</CardTitle>
          <CardDescription>Configure your email accounts for sending emails.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="accounts">Email Accounts</TabsTrigger>
              <TabsTrigger value="add-gmail">Add Gmail</TabsTrigger>
              <TabsTrigger value="add-smtp">Add SMTP Server</TabsTrigger>
            </TabsList>

            <TabsContent value="accounts">
              {accounts.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>No accounts configured</AlertTitle>
                  <AlertDescription>Add a Gmail account or SMTP server to get started.</AlertDescription>
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
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell>
                            <input
                              type="radio"
                              name="selectedAccount"
                              checked={selectedAccountId === account.id}
                              onChange={() => handleSelectAccount(account.id)}
                              className="h-4 w-4 rounded-full border-gray-300 text-primary focus:ring-primary"
                            />
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
                          <TableCell className="text-right">
                            <div className="flex justify-end space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleTestConnection(account.id)}
                                disabled={isTesting === account.id}
                              >
                                {isTesting === account.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Verify Status"
                                )}
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handleRemoveAccount(account.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="add-gmail">
              <div className="border rounded-md p-4 bg-gray-50">
                <h3 className="text-lg font-medium mb-2">Connect with Gmail</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Connect your Gmail account to send emails using Google's servers.
                </p>

                <Button onClick={handleConnectGmail} disabled={isConnecting} className="w-full">
                  {isConnecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Connect with Gmail
                    </>
                  )}
                </Button>

                {oauthError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-700">{oauthError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConnectGmail()}
                      disabled={isRetrying}
                      className="mt-2"
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      Retry Connection
                    </Button>
                  </div>
                )}
              </div>

              <Alert className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Note</AlertTitle>
                <AlertDescription>
                  Gmail OAuth is the recommended method for sending emails as it's more secure and doesn't require
                  storing your password.
                </AlertDescription>
              </Alert>
            </TabsContent>

            <TabsContent value="add-smtp">
              <div className="grid gap-4">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="name">Account Name</Label>
                  <Input
                    id="name"
                    value={newSmtpAccount.name}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, name: e.target.value })}
                    placeholder="e.g., Work Email"
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    value={newSmtpAccount.email}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, email: e.target.value })}
                    placeholder="your.email@example.com"
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="host">SMTP Host</Label>
                  <Input
                    id="host"
                    value={newSmtpAccount.host}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, host: e.target.value })}
                    placeholder="e.g., smtp.gmail.com"
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={newSmtpAccount.port}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, port: Number(e.target.value) })}
                    placeholder="e.g., 587"
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={newSmtpAccount.username}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, username: e.target.value })}
                    placeholder="your.email@example.com"
                  />
                </div>

                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newSmtpAccount.password}
                    onChange={(e) => setNewSmtpAccount({ ...newSmtpAccount, password: e.target.value })}
                    placeholder="Your password or app password"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="use_ssl"
                    checked={newSmtpAccount.use_ssl}
                    onCheckedChange={(checked) => setNewSmtpAccount({ ...newSmtpAccount, use_ssl: checked })}
                  />
                  <Label htmlFor="use_ssl">Use SSL</Label>
                </div>

                <Button onClick={handleAddSmtpAccount} disabled={isSaving} className="mt-2">
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add SMTP Account
                    </>
                  )}
                </Button>
              </div>

              <Alert className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Note</AlertTitle>
                <AlertDescription>
                  For Gmail, you may need to use an{" "}
                  <a
                    href="https://support.google.com/accounts/answer/185833"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    app password
                  </a>{" "}
                  instead of your regular password if not using OAuth.
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => setActiveTab("accounts")}>
            Back to Accounts
          </Button>
          {selectedAccountId && (
            <Button variant="outline" onClick={() => setShowTestDialog(true)}>
              <SendHorizonal className="mr-2 h-4 w-4" />
              Test Selected Account
            </Button>
          )}
        </CardFooter>
      </Card>

      {/* OAuth Dialog */}
      <Dialog open={showOAuthDialog} onOpenChange={setShowOAuthDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect with Gmail</DialogTitle>
            <DialogDescription>
              A popup window has been opened to connect your Gmail account. Please complete the authentication process
              in the popup.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <DialogFooter className="sm:justify-start">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowOAuthDialog(false)
                setIsConnecting(false)
                if (oauthWindowRef.current && !oauthWindowRef.current.closed) {
                  oauthWindowRef.current.close()
                }
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Email Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Enter an email address to send a test email and verify your configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="test-email">Recipient Email</Label>
              <Input
                id="test-email"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowTestDialog(false)}
              disabled={isTesting !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!testEmailAddress || !selectedAccountId) return

                setIsTesting(selectedAccountId)
                try {
                  const response = await fetch(`${API_URL}/test-email`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      test_email: testEmailAddress,
                      accountId: selectedAccountId,
                    }),
                  })

                  if (!response.ok) {
                    const errorData = await response.json()
                    throw new Error(errorData.error || "Failed to send test email")
                  }

                  const data = await response.json()
                  toast({
                    title: "Success",
                    description: "Test email sent successfully",
                  })
                } catch (error) {
                  toast({
                    title: "Error",
                    description: String(error),
                    variant: "destructive",
                  })
                } finally {
                  setIsTesting(null)
                  setShowTestDialog(false)
                }
              }}
              disabled={isTesting !== null || !testEmailAddress || !selectedAccountId}
            >
              {isTesting !== null ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <SendHorizonal className="mr-2 h-4 w-4" />
                  Send Test
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

