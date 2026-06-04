'use client'

import { useState } from 'react'

export function NewsletterBand() {
  const [submitted, setSubmitted] = useState(false)
  const [email, setEmail] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    // Front-end only — open mailto as fallback, show thanks state
    window.location.href = `mailto:getcreative@portsidepottery.com?subject=Newsletter%20Signup&body=Please%20add%20me%20to%20your%20newsletter%3A%20${encodeURIComponent(email)}`
    setSubmitted(true)
  }

  return (
    <section className="pp-newsletter-band" aria-label="Newsletter signup">
      <h2>Stay in the loop</h2>
      <p>New classes, studio news, and clay inspiration — straight to your inbox.</p>
      {submitted ? (
        <p className="pp-newsletter-thanks">Thanks! We&apos;ll be in touch soon.</p>
      ) : (
        <form className="pp-newsletter-form" onSubmit={handleSubmit} aria-label="Email signup form">
          <label htmlFor="newsletter-email" style={{ display: 'none' }}>Email address</label>
          <input
            id="newsletter-email"
            type="email"
            placeholder="Your email address"
            className="pp-newsletter-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <button type="submit" className="pp-newsletter-btn">Sign up</button>
        </form>
      )}
    </section>
  )
}
