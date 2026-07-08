// Task 5 rewrites this
export async function POST() {
  return Response.json({ error: 'Firings are temporarily unavailable' }, { status: 503 })
}
