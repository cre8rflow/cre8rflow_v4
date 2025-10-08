# Supabase Setup for V3 Integration

This guide helps you set up the Supabase database for V3's Twelvelabs integration features.

## Quick Setup

### 1. Database Schema
Copy and paste the contents of `create_media_twelvelabs_table.sql` into your Supabase SQL Editor:

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Navigate to your project: `ziciiawlkxgmwrfajimhy`
3. Go to **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire contents of `create_media_twelvelabs_table.sql`
6. Paste and run the query

This will create:
- `media_twelvelabs` table for storing indexing status
- Proper indexes for performance
- RLS (Row Level Security) policies
- Automatic `updated_at` timestamp triggers

### 2. Verify Setup
After running the SQL, test the connection:

```bash
# From the project root
curl http://localhost:3000/api/health-v3
```

Expected response:
```json
{
  "status": "healthy",
  "v3Integration": {
    "supabaseConfigured": true,
    "supabaseConnectivity": true,
    "supabaseMessage": "Connected successfully"
  }
}
```

## Environment Variables (Already Configured)

The following environment variables have been set in `.env.local`:

```bash
SUPABASE_URL="https://ziciiawlkxgmwrfajimhy.supabase.co"
SUPABASE_SERVICE_KEY="[your-service-role-key]"
```

## Table Schema

The `media_twelvelabs` table stores:

- `media_id` - UUID of media file in local system
- `project_id` - UUID of the project
- `twelve_labs_video_id` - Video ID from Twelvelabs
- `twelve_labs_task_id` - Task ID for indexing progress
- `indexing_status` - Status: pending, processing, completed, failed
- `indexing_progress` - Percentage completion (0-100)
- `error_message` - Error details if failed
- `metadata` - Additional Twelvelabs response data

## Security

- **RLS Enabled**: Row Level Security protects data access
- **Service Role**: Server-side operations use service role key
- **Policies**: Users can only access their own project data

## Troubleshooting

### Connection Issues
- Check that your Supabase project is active
- Verify environment variables are correctly set
- Check the health endpoint: `/api/health-v3`

### Table Missing Error
If you see "table not created yet", run the SQL schema from `create_media_twelvelabs_table.sql`

### Permission Errors
Ensure RLS policies are correctly set up by re-running the SQL schema