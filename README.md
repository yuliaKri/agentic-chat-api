# Yulia chat API

This Cloudflare Worker keeps the DeepSeek API key on the server and exposes the
chat endpoint used by the portfolio's existing React chat widget.

## Local development

1. Run `npm install` in this directory.
2. Copy `.dev.vars.example` to `.dev.vars` and add the DeepSeek and Pushover credentials.
3. Run `npm run dev` (the endpoint starts at `http://127.0.0.1:8787`).
4. Run `npm start` from the parent `Julia-s-page` directory.

## Deployment

1. Set `ALLOWED_ORIGIN` in `wrangler.toml` to the portfolio's public origin.
2. Add the three Worker secrets:
   - `npx wrangler secret put DEEPSEEK_API_KEY`
   - `npx wrangler secret put PUSHOVER_USER`
   - `npx wrangler secret put PUSHOVER_TOKEN`
3. Run `npm run deploy`.
4. Set `CHAT_API_URL` in the portfolio production environment to the deployed
   Worker URL, then rebuild and deploy the portfolio.
