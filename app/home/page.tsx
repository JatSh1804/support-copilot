"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    category: "",
    description: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Simulate ticket submission
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setFormData({
        name: "",
        email: "",
        subject: "",
        category: "",
        description: ""
      });
    }, 2000);
  };

  const handleInputChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({...formData, [field]: e.target.value});
  };

  const handleSelectChange = (value: string) => {
    setFormData({...formData, category: value});
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-green-600">Ticket Submitted!</CardTitle>
            <CardDescription>
              Your support request has been received and is being processed by our AI system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <p className="text-sm text-green-700 dark:text-green-300">
                🤖 Our AI will classify your ticket and route it to the appropriate team member.
              </p>
            </div>
            <Button 
              onClick={() => setSuccess(false)}
              className="w-full"
            >
              Submit Another Ticket
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Atlan Support</h1>
          <Link 
            href="/admin/login" 
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Staff Login →
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4">Get Help with Atlan</h2>
          <p className="text-xl text-muted-foreground mb-8">
            Submit a support ticket and our AI-powered system will route it to the right team
          </p>
        </div>

        {/* Ticket Form */}
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Submit a Support Ticket</CardTitle>
            <CardDescription>
              Describe your issue and we'll get back to you as soon as possible
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={handleInputChange("name")}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange("email")}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={formData.subject}
                  onChange={handleInputChange("subject")}
                  placeholder="Brief description of your issue"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={formData.category} onValueChange={handleSelectChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="how-to">How-to Question</SelectItem>
                    <SelectItem value="product">Product Issue</SelectItem>
                    <SelectItem value="connector">Connector Problem</SelectItem>
                    <SelectItem value="lineage">Data Lineage</SelectItem>
                    <SelectItem value="api">API/SDK</SelectItem>
                    <SelectItem value="sso">SSO/Authentication</SelectItem>
                    <SelectItem value="glossary">Glossary Management</SelectItem>
                    <SelectItem value="best-practices">Best Practices</SelectItem>
                    <SelectItem value="sensitive-data">Sensitive Data</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={handleInputChange("description")}
                  placeholder="Please provide detailed information about your issue..."
                  rows={6}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Submitting..." : "Submit Ticket"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Info Section */}
        <div className="mt-12 grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="text-3xl mb-2">🤖</div>
            <h3 className="font-semibold mb-2">AI-Powered Triage</h3>
            <p className="text-sm text-muted-foreground">
              Our AI automatically classifies and routes your ticket to the right team
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">⚡</div>
            <h3 className="font-semibold mb-2">Fast Responses</h3>
            <p className="text-sm text-muted-foreground">
              Get instant answers for common questions using our knowledge base
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">👥</div>
            <h3 className="font-semibold mb-2">Expert Support</h3>
            <p className="text-sm text-muted-foreground">
              Complex issues are routed to specialized team members
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}