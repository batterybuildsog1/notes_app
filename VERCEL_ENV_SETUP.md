# Vercel Environment Variables

Add these to Vercel Dashboard → Settings → Environment Variables:

## Required (Already Set)
- `DATABASE_URL` - Neon PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Auth secret key
- `BETTER_AUTH_URL` - https://notes.sunhomes.io
- `NEXT_PUBLIC_APP_URL` - https://notes.sunhomes.io

## New - Service Account Auth
- `SERVICE_API_KEYS` - `3b6276d9ef46f1741c3951ae4044410651ea01da2068c813602ed48e85c918da:notes-pm`
- `SERVICE_USER_ID` - `3d866169-c8db-4d46-beef-dd6fc4daa930` (Alan's user ID)

## New - Enrichment APIs
- `OPENAI_API_KEY` - Your OpenAI API key (for embeddings)
- `XAI_API_KEY` - Your xAI/Grok API key (for tag suggestions)

## How to Add

1. Go to https://vercel.com/alan-sunhomesios-projects/notes
2. Settings → Environment Variables
3. Add each variable above
4. Redeploy: `vercel --prod` or push a commit

## After Setup

Test the health endpoint:
```bash
curl https://notes.sunhomes.io/api/health
```

Test service auth:
```bash
curl -H "X-API-Key: 3b6276d9ef46f1741c3951ae4044410651ea01da2068c813602ed48e85c918da" \
  https://notes.sunhomes.io/api/notes/stats
```
