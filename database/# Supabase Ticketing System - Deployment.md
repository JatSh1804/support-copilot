# Supabase Ticketing System - Deployment Guide

### Add to Supabase Edge Function Secrets
```bash
# Navigate to your project
cd your-project

# Set Chatbase credentials
supabase secrets set CHATBASE_API_KEY=your-chatbase-api-key
supabase secrets set CHATBASE_CHATBOT_ID=your-chatbot-id
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## Step 2: Set Up Database Schema

### Execute SQL in Supabase SQL Editor

1. Go to **SQL Editor** in Supabase Dashboard
2. Create a new query
3. Copy and paste the SQL from the artifact (Section 1)
4. Run the query

**Important**: Update the `edge_function_url` in the trigger function with your actual Edge Function URL:
```sql
edge_function_url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/analyze-ticket';
```

---

## Step 3: Enable pg_net Extension

In Supabase SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
```

This enables HTTP requests from database triggers.

---

## Step 4: Deploy Edge Function

### Create Edge Function Structure
```bash
# Initialize Supabase in your project (if not already done)
supabase init

# Create the edge function
supabase functions new analyze-ticket
```

### Add the Code
Copy the Edge Function code from the artifact (Section 2) into:
```
supabase/functions/analyze-ticket/index.ts
```

### Deploy the Function
```bash
# Deploy to Supabase
supabase functions deploy analyze-ticket --project-ref your-project-ref

# Note the deployed URL - you'll need it for the trigger
```

---

## Step 5: Update Database Trigger with Edge Function URL

After deploying, update the trigger function:

```sql
CREATE OR REPLACE FUNCTION notify_ticket_creation()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  request_id INT;
BEGIN
  -- Update with your actual Edge Function URL
  edge_function_url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/analyze-ticket';
  
  SELECT net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := jsonb_build_object(
      'ticketId', NEW.id,
      'userId', NEW.user_id,
      'subject', NEW.subject,
      'description', NEW.description
    )
  ) INTO request_id;
  
  NEW.status := 'analyzing';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Step 6: Set Database Configuration for Service Role Key

You need to set the `app.service_role_key` config so the trigger can use it:

```sql
-- This should be run by a superuser/admin
ALTER DATABASE postgres SET app.service_role_key TO 'your-service-role-key';

-- Reload configuration
SELECT pg_reload_conf();
```

**Alternative approach**: Instead of storing in config, you can hardcode it in the trigger (less secure but simpler):

```sql
headers := jsonb_build_object(
  'Content-Type', 'application/json',
  'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE'
)
```

---

## Step 7: Configure Chatbase Agent

### In Chatbase Dashboard:

1. **Create a new chatbot**
2. **Add your documentation sources**:
   - Upload PDFs
   - Add website URLs
   - Add text documents

3. **Configure System Prompt**:
```
You are a support ticket analyzer. When given a ticket, analyze it and return ONLY valid JSON with this structure:

{
  "priority": "low|medium|high|critical",
  "sentiment": "positive|neutral|negative|frustrated", 
  "category": "technical|billing|feature-request|bug|account|other",
  "suggestedResponse": "helpful response based on documentation",
  "confidence": 0.85,
  "relatedDocs": ["doc1", "doc2"]
}

Priority Guidelines:
- critical: System down, data loss, security breach
- high: Major feature broken, significant business impact
- medium: Feature not working as expected, workaround available
- low: Minor issues, feature requests, questions

Be concise and return ONLY the JSON object.
```

4. **Get API credentials**:
   - Go to Settings → API Keys
   - Create a new API key
   - Copy the Chatbot ID

---

## Step 8: Add Next.js API Routes and Components

### Install Supabase Auth Helpers
```bash
npm install @supabase/auth-helpers-nextjs @supabase/supabase-js
```

### Create the API route
Create `app/api/tickets/route.ts` and add the code from Section 3 of the artifact.

### Create the React component
Create `app/components/TicketForm.tsx` and add the code from Section 4 of the artifact.

---

## Step 9: Test the System

### Test Ticket Creation
```bash
# Using curl
curl -X POST https://your-project.supabase.co/rest/v1/tickets \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Cannot login to account",
    "description": "I have been trying to login for the past hour but keep getting an error message saying invalid credentials. I have tried resetting my password multiple times."
  }'
```

### Monitor Logs
```bash
# Watch Edge Function logs
supabase functions logs analyze-ticket --project-ref your-project-ref

# Watch database logs in Supabase Dashboard
# Go to Logs → Database Logs
```

---

## Step 10: Set Up Real-time Subscriptions (Optional)

For real-time updates in your UI:

```typescript
// In your component
useEffect(() => {
  const channel = supabase
    .channel('ticket-updates')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        console.log('Ticket updated:', payload.new)
        // Update your UI
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [userId])
```

---

## Troubleshooting

### Trigger Not Firing
1. Check `pg_net` extension is enabled
2. Verify Edge Function URL is correct
3. Check database logs for errors

### Edge Function Errors
```bash
# View detailed logs
supabase functions logs analyze-ticket --project-ref your-project-ref
```

### Chatbase API Issues
- Verify API key is correct
- Check Chatbot ID is correct
- Ensure your Chatbase agent is properly trained

### Authorization Errors
- Verify service role key is set correctly
- Check RLS policies on tickets table
- Ensure user is authenticated

---

## Performance Optimization

### Add Indexes
```sql
CREATE INDEX idx_tickets_conversation_id ON tickets(conversation_id);
CREATE INDEX idx_tickets_category ON tickets(category);
```

### Enable Database Caching
```sql
-- Cache frequently accessed ticket data
CREATE MATERIALIZED VIEW ticket_stats AS
SELECT 
  category,
  priority,
  COUNT(*) as count,
  AVG(ai_confidence) as avg_confidence
FROM tickets
GROUP BY category, priority;

-- Refresh periodically
REFRESH MATERIALIZED VIEW ticket_stats;
```

---

## Security Checklist

- [ ] Service role key stored securely (not in code)
- [ ] RLS policies enabled on tickets table
- [ ] Edge Function authorization verified
- [ ] API rate limiting implemented
- [ ] User input sanitized
- [ ] CORS configured properly
- [ ] Secrets not exposed in client-side code

---

## Next Steps

1. **Add email notifications** for high-priority tickets
2. **Create admin dashboard** to view all tickets
3. **Implement ticket assignment** to support agents
4. **Add file uploads** for ticket attachments
5. **Create analytics dashboard** for ticket insights
6. **Set up monitoring** with Sentry or similar