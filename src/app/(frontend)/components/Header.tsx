import Link from 'next/link'

export function Header({ studioName }: { studioName: string }) {
  return (
    <header className="pp-header pp-container">
      <Link href="/" className="pp-logo">{studioName}</Link>
      <nav className="pp-nav">
        <Link href="/classes">Classes</Link>
        <Link href="/membership">Membership</Link>
        <Link href="/staff">Meet the Staff</Link>
      </nav>
    </header>
  )
}
