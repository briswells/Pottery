import Link from 'next/link'

export function Header({ studioName, logoUrl }: { studioName: string; logoUrl: string | null }) {
  return (
    <header className="pp-header pp-container">
      <Link href="/" className="pp-logo">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={studioName}
            style={{ height: 44, width: 'auto' }}
            loading="lazy"
          />
        ) : (
          studioName
        )}
      </Link>
      <nav className="pp-nav">
        <Link href="/classes">Classes</Link>
        <Link href="/membership">Membership</Link>
        <Link href="/staff">Meet the Staff</Link>
      </nav>
    </header>
  )
}
