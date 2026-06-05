// Serves the Apple Pay domain-association file (content from Square, set via env).
// Returns 404 until APPLE_PAY_DOMAIN_ASSOCIATION is configured, so it's inert locally.
export function GET() {
  const body = process.env.APPLE_PAY_DOMAIN_ASSOCIATION
  if (!body) return new Response('Not found', { status: 404 })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}
