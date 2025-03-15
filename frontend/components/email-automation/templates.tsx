"use client"

import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Plus, Trash, Save, Star } from "lucide-react"
import { toast } from "@/lib/utils"
import { API_URL } from "@/lib/constants"
import type { Template } from "@/types"

interface TemplatesTabProps {
  templates: Template[]
  setTemplates: (templates: Template[]) => void
}

export default function TemplatesTab({ templates, setTemplates }: TemplatesTabProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [newTemplate, setNewTemplate] = useState<Partial<Template>>({
    name: "",
    subject: "",
    content: "",
    isDefault: false,
  })

  // Load templates on component mount
  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      const response = await fetch(`${API_URL}/get-templates`)
      if (response.ok) {
        const data = await response.json()
        if (data.templates && data.templates.length > 0) {
          setTemplates(data.templates)
        }
      }
    } catch (error) {
      console.error("Error fetching templates:", error)
    }
  }

  // Handle saving email templates
  const handleSaveTemplates = async () => {
    setIsLoading(true)
    try {
      // Ensure at least one template exists and is default
      if (templates.length === 0) {
        toast({
          title: "Error",
          description: "At least one template is required",
          variant: "destructive",
        })
        return
      }

      if (!templates.some((t) => t.isDefault)) {
        toast({
          title: "Error",
          description: "One template must be set as default",
          variant: "destructive",
        })
        return
      }

      const response = await fetch(`${API_URL}/save-templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ templates }),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Email templates saved successfully",
        })
      } else {
        throw new Error("Failed to save templates")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save email templates",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateTemplate = (index: number, field: keyof Template, value: any) => {
    const updatedTemplates = [...templates]
    updatedTemplates[index] = {
      ...updatedTemplates[index],
      [field]: value,
    }

    // If this template is being set as default, unset others
    if (field === "isDefault" && value === true) {
      updatedTemplates.forEach((t, i) => {
        if (i !== index) {
          t.isDefault = false
        }
      })
    }

    setTemplates(updatedTemplates)
  }

  const handleDeleteTemplate = (index: number) => {
    const templateToDelete = templates[index]

    // Don't allow deleting the only template
    if (templates.length <= 1) {
      toast({
        title: "Error",
        description: "Cannot delete the only template",
        variant: "destructive",
      })
      return
    }

    // Don't allow deleting the default template
    if (templateToDelete.isDefault) {
      toast({
        title: "Error",
        description: "Cannot delete the default template. Set another template as default first.",
        variant: "destructive",
      })
      return
    }

    const updatedTemplates = [...templates]
    updatedTemplates.splice(index, 1)
    setTemplates(updatedTemplates)
  }

  const handleAddTemplate = () => {
    if (!newTemplate.name || !newTemplate.subject || !newTemplate.content) {
      toast({
        title: "Error",
        description: "Name, subject and content are required",
        variant: "destructive",
      })
      return
    }

    const templateId = `template_${Date.now()}`

    // If this is the first template, make it default
    const isDefault = templates.length === 0 ? true : newTemplate.isDefault

    // If this template is default, unset others
    const updatedTemplates = [...templates]
    if (isDefault) {
      updatedTemplates.forEach((t) => (t.isDefault = false))
    }

    setTemplates([
      ...updatedTemplates,
      {
        id: templateId,
        name: newTemplate.name,
        subject: newTemplate.subject,
        content: newTemplate.content,
        isDefault,
      },
    ])

    // Reset form
    setNewTemplate({
      name: "",
      subject: "",
      content: "",
      isDefault: false,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Templates</CardTitle>
        <CardDescription>
          Create and manage your email templates. Use [NAME] as a placeholder for the recipient's name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid w-full items-center gap-4">
          {templates.map((template, index) => (
            <div key={template.id} className="space-y-2">
              {index > 0 && <Separator className="my-4" />}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`template_${index}_name`} className="text-base font-medium">
                    Template Name
                  </Label>
                  {template.isDefault && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                      <Star className="h-3 w-3 mr-1" />
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={template.isDefault}
                      onCheckedChange={(checked) => handleUpdateTemplate(index, "isDefault", checked)}
                      disabled={template.isDefault && templates.length === 1}
                    />
                    <Label>Set as Default</Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteTemplate(index)}
                    disabled={templates.length <= 1 || template.isDefault}
                  >
                    <Trash className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>

              <Input
                id={`template_${index}_name`}
                value={template.name}
                onChange={(e) => handleUpdateTemplate(index, "name", e.target.value)}
                placeholder="Template name"
              />

              <Label htmlFor={`template_${index}_subject`}>Email Subject</Label>
              <Input
                id={`template_${index}_subject`}
                value={template.subject}
                onChange={(e) => handleUpdateTemplate(index, "subject", e.target.value)}
                placeholder="Email subject line"
              />

              <Label htmlFor={`template_${index}_content`}>Email Content</Label>
              <Textarea
                id={`template_${index}_content`}
                rows={6}
                value={template.content}
                onChange={(e) => handleUpdateTemplate(index, "content", e.target.value)}
                placeholder="Enter your template content here. Use [NAME] for recipient's name."
              />
            </div>
          ))}

          <div className="border-t pt-4 mt-2">
            <Label className="mb-4 block text-lg font-medium">Add New Template</Label>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label htmlFor="new_template_name">Template Name</Label>
                  <Input
                    id="new_template_name"
                    placeholder="e.g., Welcome Email"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={newTemplate.isDefault}
                    onCheckedChange={(checked) => setNewTemplate({ ...newTemplate, isDefault: checked })}
                  />
                  <Label>Set as Default</Label>
                </div>
              </div>

              <div>
                <Label htmlFor="new_template_subject">Email Subject</Label>
                <Input
                  id="new_template_subject"
                  placeholder="Subject line"
                  value={newTemplate.subject}
                  onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="new_template_content">Email Content</Label>
                <Textarea
                  id="new_template_content"
                  placeholder="Enter template content. Use [NAME] for recipient's name."
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                  rows={6}
                />
              </div>

              <Button
                onClick={handleAddTemplate}
                disabled={!newTemplate.name || !newTemplate.subject || !newTemplate.content}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Template
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSaveTemplates}
          disabled={isLoading || templates.length === 0 || !templates.some((t) => t.isDefault)}
          className="w-full"
        >
          <Save className="mr-2 h-4 w-4" />
          Save Templates
        </Button>
      </CardFooter>
    </Card>
  )
}

