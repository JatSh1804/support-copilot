import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ChatPage() {
  const supabase = await createClient();
  
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/admin/login");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">AI Agent</h1>
        <div className="text-sm text-muted-foreground">
          Interactive Customer Support Assistant
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 h-[600px]">
        {/* Internal Analysis Panel */}
        <div className="bg-card rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">Internal Analysis</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Topic Tags</label>
              <div className="mt-1 p-3 bg-muted rounded text-sm">
                Classification will appear here...
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Sentiment</label>
              <div className="mt-1 p-3 bg-muted rounded text-sm">
                Sentiment analysis will appear here...
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Priority</label>
              <div className="mt-1 p-3 bg-muted rounded text-sm">
                Priority assessment will appear here...
              </div>
            </div>
          </div>
        </div>

        {/* Response Panel */}
        <div className="bg-card rounded-lg border p-6">
          <h2 className="text-xl font-semibold mb-4">AI Response</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Generated Response</label>
              <div className="mt-1 p-3 bg-muted rounded text-sm min-h-[200px]">
                AI-generated response will appear here...
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Sources</label>
              <div className="mt-1 p-3 bg-muted rounded text-sm">
                Documentation sources will be cited here...
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Input Section */}
      <div className="bg-card rounded-lg border p-6">
        <h2 className="text-xl font-semibold mb-4">Test Customer Query</h2>
        <div className="space-y-4">
          <textarea
            placeholder="Enter a customer question or ticket to see how the AI would classify and respond..."
            className="w-full p-3 border rounded-lg resize-none"
            rows={4}
          />
          <button className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            Analyze & Respond
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          🚧 AI classification and RAG pipeline coming soon...
        </p>
      </div>
    </div>
  );
}