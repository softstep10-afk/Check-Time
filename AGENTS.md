# Working rules for AI coders on this repo

**Read `CLAUDE.md` first and follow it fully — it is the canonical working agreement**
(the loop, self-verification, Supabase MCP usage, RLS discipline, "done = three checkmarks",
branch/deploy rules). This file only adds the framework warning below.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version (Next.js 16.2.3) has breaking changes — APIs, conventions, and file structure may all
differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before
writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
