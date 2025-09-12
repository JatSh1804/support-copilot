-- ================================================
-- UPDATE TRIGGER FOR CLASSIFICATION QUEUE
-- ================================================
-- Update the trigger to add jobs to classification queue after embeddings

-- Update the queue trigger to handle the full workflow
CREATE OR REPLACE FUNCTION queue_ticket_for_processing()
RETURNS TRIGGER AS $$
BEGIN
    -- Add to embeddings queue with job format matching edge function
    PERFORM pgmq.send(
        'embeddings_queue',
        jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'subject', NEW.subject,
            'description', NEW.description,
            'content', NEW.subject || E'\n\n' || NEW.description,
            'created_at', NEW.created_at,
            -- Additional fields for edge function processing
            'id', NEW.id,
            'schema', 'public',
            'table', 'tickets',
            'contentFunction', 'get_ticket_content',
            'embeddingColumn', 'content_embedding'
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a function to queue classification after embeddings are done
CREATE OR REPLACE FUNCTION queue_classification_after_embeddings()
RETURNS TRIGGER AS $$
BEGIN
    -- Only queue for classification if embeddings were successfully generated
    IF NEW.content_type = 'combined' AND NEW.embedding IS NOT NULL THEN
        -- Add to classification queue
        PERFORM pgmq.send(
            'classification_queue',
            jsonb_build_object(
                'ticket_id', NEW.ticket_id,
                'ticket_number', (SELECT ticket_number FROM tickets WHERE id = NEW.ticket_id),
                'embedding_id', NEW.id,
                'content', (SELECT subject || E'\n\n' || description FROM tickets WHERE id = NEW.ticket_id),
                'created_at', NEW.created_at,
                -- Additional fields for edge function processing
                'id', NEW.ticket_id,
                'schema', 'public',
                'table', 'tickets',
                'contentFunction', 'get_ticket_content',
                'embeddingColumn', 'content_embedding'
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for classification queue
CREATE TRIGGER trigger_queue_classification
    AFTER INSERT ON ticket_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION queue_classification_after_embeddings();

-- Test the workflow by creating a ticket
-- This should automatically:
-- 1. Add to embeddings_queue
-- 2. Process embeddings (when cron runs)
-- 3. Add to classification_queue (via trigger)
-- 4. Process classification (when cron runs)